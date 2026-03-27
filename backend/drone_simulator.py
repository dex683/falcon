"""
Drone Simulator
----------------
Simulates a drone capturing and sending images to the server.
Uses sample images from ./sample_images/ if available, otherwise
generates synthetic aerial-view images on the fly.
"""

import base64
import io
import math
import os
import random
import time
import threading

from PIL import Image, ImageDraw, ImageFilter
import numpy as np


# ─── Configuration ──────────────────────────────────────────────────
SAMPLE_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "sample_images")
DEFAULT_INTERVAL = 2.0  # seconds between frames
IMAGE_SIZE = (640, 480)

# Simulated flight path — starting coordinates (approx. somewhere interesting)
START_LAT = 12.9716
START_LNG = 77.5946
ALTITUDE_RANGE = (30, 120)  # meters


class DroneSimulator:
    """
    Simulates a drone sending frames to the server via SocketIO.
    Can be started/stopped from the frontend.
    """

    def __init__(self, socketio, detector=None):
        self.socketio = socketio
        self.detector = detector
        self.running = False
        self.thread = None
        self.interval = DEFAULT_INTERVAL
        self.frames_sent = 0
        self.start_time = None

        # Flight state
        self.lat = START_LAT
        self.lng = START_LNG
        self.altitude = random.uniform(*ALTITUDE_RANGE)
        self.heading = random.uniform(0, 360)
        self.battery = 100.0
        self.speed = 0.0  # m/s

        # Load sample images if available
        self.sample_images = self._load_sample_images()

    def _load_sample_images(self) -> list:
        """Load sample images from the sample_images directory."""
        images = []
        if os.path.exists(SAMPLE_IMAGES_DIR):
            for filename in sorted(os.listdir(SAMPLE_IMAGES_DIR)):
                if filename.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp")):
                    filepath = os.path.join(SAMPLE_IMAGES_DIR, filename)
                    try:
                        with open(filepath, "rb") as f:
                            img_data = f.read()
                        images.append({"filename": filename, "data": img_data})
                    except Exception as e:
                        print(f"[Drone] Warning: Could not load {filename}: {e}")
        if images:
            print(f"[Drone] Loaded {len(images)} sample images from {SAMPLE_IMAGES_DIR}")
        else:
            print("[Drone] No sample images found — will generate synthetic frames")
        return images

    def _generate_synthetic_image(self) -> bytes:
        """Generate a synthetic aerial-view image that looks like infrastructure."""
        width, height = IMAGE_SIZE
        img = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(img)
        pixels = np.random.randint(60, 140, (height, width, 3), dtype=np.uint8)
        img = Image.fromarray(pixels)
        draw = ImageDraw.Draw(img)

        # Base terrain color variations
        terrain_colors = [
            (120, 130, 110),  # grass/ground
            (160, 155, 140),  # concrete
            (100, 100, 105),  # asphalt
            (140, 120, 100),  # dirt
        ]
        base_color = random.choice(terrain_colors)

        # Fill base with slight noise
        for y in range(0, height, 4):
            for x in range(0, width, 4):
                r = base_color[0] + random.randint(-15, 15)
                g = base_color[1] + random.randint(-15, 15)
                b = base_color[2] + random.randint(-15, 15)
                draw.rectangle([x, y, x + 3, y + 3], fill=(r, g, b))

        # Draw building-like rectangles
        num_buildings = random.randint(2, 6)
        for _ in range(num_buildings):
            bw = random.randint(40, 180)
            bh = random.randint(40, 150)
            bx = random.randint(0, width - bw)
            by = random.randint(0, height - bh)
            shade = random.randint(130, 200)
            building_color = (shade, shade - 10, shade - 20)
            draw.rectangle([bx, by, bx + bw, by + bh], fill=building_color,
                           outline=(shade - 40, shade - 50, shade - 60), width=2)

            # Roof details (lines, patterns)
            if random.random() > 0.5:
                for lx in range(bx + 10, bx + bw - 10, 20):
                    draw.line([(lx, by), (lx, by + bh)],
                              fill=(shade - 30, shade - 35, shade - 40), width=1)

        # Draw road-like lines
        if random.random() > 0.3:
            road_y = random.randint(int(height * 0.3), int(height * 0.7))
            draw.rectangle([0, road_y, width, road_y + random.randint(20, 40)],
                           fill=(80, 80, 85))
            # Road markings
            for x in range(0, width, 30):
                draw.rectangle([x, road_y + 12, x + 15, road_y + 15],
                               fill=(220, 220, 100))

        # Add some "damage" visual cues (dark patches, discoloration)
        num_damage_hints = random.randint(1, 4)
        for _ in range(num_damage_hints):
            dx = random.randint(20, width - 60)
            dy = random.randint(20, height - 60)
            dw = random.randint(10, 50)
            dh = random.randint(10, 50)
            damage_shade = random.randint(40, 80)
            draw.ellipse([dx, dy, dx + dw, dy + dh],
                         fill=(damage_shade, damage_shade - 5, damage_shade + 10))

        # Apply slight blur for realism
        img = img.filter(ImageFilter.GaussianBlur(radius=0.8))

        # Encode to JPEG
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        return buffer.getvalue()

    def _get_next_frame(self) -> bytes:
        """Get the next image frame (sample or synthetic)."""
        if self.sample_images:
            idx = self.frames_sent % len(self.sample_images)
            return self.sample_images[idx]["data"]
        else:
            return self._generate_synthetic_image()

    def _update_telemetry(self):
        """Simulate drone movement and telemetry updates."""
        # Drift GPS position
        self.lat += random.uniform(-0.0002, 0.0002)
        self.lng += random.uniform(-0.0002, 0.0002)

        # Vary altitude
        self.altitude += random.uniform(-2, 2)
        self.altitude = max(ALTITUDE_RANGE[0], min(ALTITUDE_RANGE[1], self.altitude))

        # Heading drift
        self.heading = (self.heading + random.uniform(-10, 10)) % 360

        # Battery drain
        self.battery = max(0, self.battery - random.uniform(0.05, 0.15))

        # Speed
        self.speed = random.uniform(2, 8)

    def _get_telemetry(self) -> dict:
        """Return current drone telemetry data."""
        elapsed = time.time() - self.start_time if self.start_time else 0
        return {
            "drone_id": "SKEEM-DRONE-01",
            "lat": round(self.lat, 6),
            "lng": round(self.lng, 6),
            "altitude_m": round(self.altitude, 1),
            "heading_deg": round(self.heading, 1),
            "speed_ms": round(self.speed, 1),
            "battery_pct": round(self.battery, 1),
            "signal_strength": random.randint(75, 100),
            "gps_satellites": random.randint(8, 14),
            "flight_time_s": round(elapsed, 1),
            "frames_sent": self.frames_sent,
            "timestamp": time.time(),
        }

    def _simulation_loop(self):
        """Main simulation loop — runs in a background thread."""
        print(f"[Drone] Simulation started (interval={self.interval}s)")
        self.start_time = time.time()

        while self.running:
            try:
                # Get frame
                frame_data = self._get_next_frame()
                frame_b64 = base64.b64encode(frame_data).decode("utf-8")

                # Update telemetry
                self._update_telemetry()
                telemetry = self._get_telemetry()

                # Process through ML if detector available
                if self.detector:
                    result = self.detector.process_frame(frame_b64)
                    payload = {
                        "image": result["image"],
                        "detections": result["detections"],
                        "processing_time_ms": result["processing_time_ms"],
                        "frame_id": result["frame_id"],
                        "total_damage_count": result["total_damage_count"],
                        "summary": result["summary"],
                        "drone_metadata": telemetry,
                        "timestamp": time.time(),
                    }
                    self.socketio.emit("processed_frame", payload)
                else:
                    # No detector — emit raw frame
                    self.socketio.emit("drone_frame", {
                        "image": frame_b64,
                        "metadata": telemetry,
                    })

                # Also emit telemetry separately
                self.socketio.emit("drone_telemetry", telemetry)

                self.frames_sent += 1
                det_count = result["total_damage_count"] if self.detector else 0
                print(f"[Drone] Frame #{self.frames_sent} sent | "
                      f"Detections: {det_count} | "
                      f"Battery: {telemetry['battery_pct']}% | "
                      f"Alt: {telemetry['altitude_m']}m")

                # Emit simulation status
                self.socketio.emit("simulation_status", {
                    "running": True,
                    "frames_sent": self.frames_sent,
                    "battery": telemetry["battery_pct"],
                    "elapsed_s": telemetry["flight_time_s"],
                })

                # Check battery
                if self.battery <= 0:
                    print("[Drone] Battery depleted — returning to base")
                    self.running = False
                    self.socketio.emit("simulation_status", {
                        "running": False,
                        "frames_sent": self.frames_sent,
                        "reason": "battery_depleted",
                    })
                    break

                self.socketio.sleep(self.interval)

            except Exception as e:
                print(f"[Drone] Error in simulation loop: {e}")
                self.socketio.sleep(1)

        print(f"[Drone] Simulation stopped after {self.frames_sent} frames")

    def start(self, interval: float = None):
        """Start the drone simulation."""
        if self.running:
            return {"status": "already_running", "frames_sent": self.frames_sent}

        self.interval = interval or DEFAULT_INTERVAL
        self.running = True
        self.frames_sent = 0
        self.battery = 100.0
        self.lat = START_LAT
        self.lng = START_LNG

        self.thread = self.socketio.start_background_task(self._simulation_loop)

        return {"status": "started", "interval": self.interval}

    def stop(self):
        """Stop the drone simulation."""
        if not self.running:
            return {"status": "not_running"}

        self.running = False
        return {"status": "stopped", "frames_sent": self.frames_sent}

    def get_status(self) -> dict:
        """Get current simulation status."""
        return {
            "running": self.running,
            "frames_sent": self.frames_sent,
            "battery": round(self.battery, 1),
            "telemetry": self._get_telemetry() if self.running else None,
        }
