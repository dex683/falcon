"""
ML Damage Detection Processor
------------------------------
Simulated damage detector for the MVP. Generates realistic random detections
on drone images. Drop-in replaceable with a real model (YOLOv8, etc.)
by implementing the same `process_frame()` interface.
"""

import base64
import io
import random
import time
import uuid

from PIL import Image, ImageDraw, ImageFont

# ─── Damage Categories ──────────────────────────────────────────────
DAMAGE_TYPES = [
    {"label": "Crack",         "color": "#FF4444", "severity_range": (0.3, 0.9)},
    {"label": "Spalling",      "color": "#FF8800", "severity_range": (0.2, 0.8)},
    {"label": "Corrosion",     "color": "#FFCC00", "severity_range": (0.4, 0.95)},
    {"label": "Delamination",  "color": "#AA44FF", "severity_range": (0.3, 0.85)},
    {"label": "Water Damage",  "color": "#4488FF", "severity_range": (0.2, 0.7)},
    {"label": "Structural",    "color": "#FF2266", "severity_range": (0.6, 1.0)},
    {"label": "Surface Wear",  "color": "#44CC88", "severity_range": (0.1, 0.5)},
    {"label": "Displacement",  "color": "#FF6644", "severity_range": (0.5, 0.9)},
]

SEVERITY_LABELS = {
    (0.0, 0.3): "Low",
    (0.3, 0.6): "Medium",
    (0.6, 0.8): "High",
    (0.8, 1.0): "Critical",
}


def _get_severity_label(score: float) -> str:
    for (lo, hi), label in SEVERITY_LABELS.items():
        if lo <= score < hi:
            return label
    return "Critical"


class DamageDetector:
    """
    Simulated damage detector for MVP.
    Swap this class for a real model by keeping the same `process_frame()` signature.
    """

    def __init__(self, min_detections: int = 1, max_detections: int = 5):
        self.min_detections = min_detections
        self.max_detections = max_detections
        self.frame_count = 0

    def process_frame(self, image_b64: str) -> dict:
        """
        Process a base64-encoded image and return annotated image + detections.

        Args:
            image_b64: Base64-encoded image string (JPEG/PNG)

        Returns:
            dict with keys:
                - image: base64-encoded annotated image
                - detections: list of detection dicts
                - processing_time_ms: time taken in ms
                - frame_id: unique frame identifier
        """
        start_time = time.time()
        self.frame_count += 1

        # Decode the incoming image
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        width, height = image.size

        # Generate simulated detections
        num_detections = random.randint(self.min_detections, self.max_detections)
        detections = []

        for _ in range(num_detections):
            damage = random.choice(DAMAGE_TYPES)
            confidence = round(random.uniform(0.55, 0.98), 2)
            severity = round(random.uniform(*damage["severity_range"]), 2)

            # Random bounding box (ensuring reasonable size)
            box_w = random.randint(int(width * 0.05), int(width * 0.25))
            box_h = random.randint(int(height * 0.05), int(height * 0.25))
            x1 = random.randint(0, max(0, width - box_w))
            y1 = random.randint(0, max(0, height - box_h))
            x2 = x1 + box_w
            y2 = y1 + box_h

            detections.append({
                "id": str(uuid.uuid4())[:8],
                "label": damage["label"],
                "confidence": confidence,
                "severity": severity,
                "severity_label": _get_severity_label(severity),
                "color": damage["color"],
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "area_px": box_w * box_h,
            })

        # Annotate the image with bounding boxes
        annotated_image = self._annotate_image(image, detections)

        # Encode result
        buffer = io.BytesIO()
        annotated_image.save(buffer, format="JPEG", quality=85)
        annotated_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        processing_time = round((time.time() - start_time) * 1000, 1)

        return {
            "image": annotated_b64,
            "detections": detections,
            "processing_time_ms": processing_time,
            "frame_id": f"frame_{self.frame_count:06d}",
            "total_damage_count": len(detections),
            "summary": self._generate_summary(detections),
        }

    def _annotate_image(self, image: Image.Image, detections: list) -> Image.Image:
        """Draw bounding boxes and labels on the image."""
        annotated = image.copy()
        draw = ImageDraw.Draw(annotated)

        # Try to use a decent font, fall back to default
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
            font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
                font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 11)
            except (OSError, IOError):
                font = ImageFont.load_default()
                font_small = font

        for det in detections:
            bbox = det["bbox"]
            color = det["color"]
            label = det["label"]
            confidence = det["confidence"]
            severity_label = det["severity_label"]

            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]

            # Draw bounding box (thicker outline)
            for i in range(3):
                draw.rectangle([x1 - i, y1 - i, x2 + i, y2 + i], outline=color)

            # Draw label background
            label_text = f"{label} {confidence:.0%}"
            severity_text = f"[{severity_label}]"

            # Get text dimensions
            text_bbox = draw.textbbox((0, 0), label_text, font=font)
            text_w = text_bbox[2] - text_bbox[0]
            text_h = text_bbox[3] - text_bbox[1]

            sev_bbox = draw.textbbox((0, 0), severity_text, font=font_small)
            sev_w = sev_bbox[2] - sev_bbox[0]

            total_w = max(text_w, sev_w) + 12
            total_h = text_h + 20

            # Label background
            draw.rectangle(
                [x1, y1 - total_h - 4, x1 + total_w, y1],
                fill=color,
            )

            # Label text
            draw.text((x1 + 4, y1 - total_h - 2), label_text, fill="white", font=font)
            draw.text((x1 + 4, y1 - 16), severity_text, fill="white", font=font_small)

            # Corner markers
            marker_len = min(15, (x2 - x1) // 4)
            for corner_x, corner_y, dx, dy in [
                (x1, y1, 1, 1), (x2, y1, -1, 1),
                (x1, y2, 1, -1), (x2, y2, -1, -1)
            ]:
                draw.line([(corner_x, corner_y), (corner_x + dx * marker_len, corner_y)],
                          fill=color, width=3)
                draw.line([(corner_x, corner_y), (corner_x, corner_y + dy * marker_len)],
                          fill=color, width=3)

        return annotated

    def _generate_summary(self, detections: list) -> dict:
        """Generate a summary of all detections."""
        if not detections:
            return {"status": "clear", "message": "No damage detected"}

        damage_counts = {}
        max_severity = 0
        for det in detections:
            label = det["label"]
            damage_counts[label] = damage_counts.get(label, 0) + 1
            max_severity = max(max_severity, det["severity"])

        return {
            "status": "damage_detected",
            "total_detections": len(detections),
            "damage_types": damage_counts,
            "max_severity": max_severity,
            "max_severity_label": _get_severity_label(max_severity),
        }
