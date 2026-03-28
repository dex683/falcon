"""
Skeem - Autonomous Drone Damage Mapping Server
================================================
Flask-SocketIO server that receives drone images in real-time,
processes them through an ML damage detection pipeline, and
streams annotated results to the frontend via WebSockets.
"""

import eventlet
eventlet.monkey_patch()

import os
import time
from typing import Any
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import requests

# Load .env file if present (before reading env vars)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from ml_processor import DamageDetector
from drone_simulator import DroneSimulator
from queue_db import init_db, enqueue_frame, get_next_job, mark_job_completed
import json

# ─── App Setup ───────────────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = "skeem-drone-damage-mapping-2026"

CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=16 * 1024 * 1024,  # 16MB for large images
)

# ─── Detector Selection ─────────────────────────────────────────────

_GEMINI_ENV_ENABLED = os.environ.get("USE_GEMINI_FALLBACK", "0").strip().lower() in (
    "1", "true", "yes", "on"
)
_GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()


def _make_detector(use_gemini: bool):
    """Build and return a detector instance. Also returns (detector, name, success_flag)."""
    if use_gemini:
        if not _GEMINI_API_KEY:
            print("[Detector] ⚠️  GEMINI_API_KEY not set — falling back to Mock ML")
            return DamageDetector(min_detections=1, max_detections=5), "DamageDetector-Mock (fire|flood|destruction|good)", False
        try:
            from gemini_processor import GeminiDamageDetector
            d = GeminiDamageDetector()
            name = "GeminiDamageDetector"
            print("[Detector] ✅ Using Gemini Vision API for damage detection")
            return d, name, True
        except Exception as _e:
            print(f"[Detector] ⚠️  Gemini init failed ({_e}), falling back to Mock ML")
            return DamageDetector(min_detections=1, max_detections=5), "DamageDetector-Mock", False
    else:
        try:
            d = DamageDetector(min_detections=1, max_detections=5)
            name = "DamageDetector-MobileNetV2"
            print("[Detector] ✅ Using MobileNetV2 damage classifier (set USE_GEMINI_FALLBACK=1 for Gemini)")
            return d, name, True
        except Exception as _e:
            print(f"[Detector] ⚠️  Model load failed ({_e}), server cannot start without model")
            raise


# Global mutable detector state
_active_use_gemini: bool = _GEMINI_ENV_ENABLED
detector, _detector_name, _ = _make_detector(_active_use_gemini)

# ─── Services ────────────────────────────────────────────────────────
drone_sim = DroneSimulator(socketio, detector=detector)

# ─── Connection Tracking ─────────────────────────────────────────────
connected_clients = {}

# ─── Shared Simulation State ─────────────────────────────────────────
# This is the single source of truth replayed to every connecting client
# and broadcast to all clients whenever anything changes.
shared_state: dict[str, Any] = {
    "deployed_drones": [],   # list of DeployedDrone-like dicts
    "coverage_zones": [],    # list of CoverageCircle-like dicts
    "simulation_running": False,
    "frames": [],            # last 200 ML-processed frames
}


def broadcast_state():
    """Broadcast the full shared state to all connected clients."""
    socketio.emit("state_sync", shared_state)


# ═══════════════════════════════════════════════════════════════════════
# REST Endpoints
# ═══════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return jsonify({
        "service": "Skeem Drone Damage Mapping",
        "status": "online",
        "version": "1.0.0-mvp",
        "websocket": "ws://localhost:5001",
        "endpoints": {
            "health": "/api/status",
            "simulation": "/api/simulation/status",
        },
    })


@app.route("/api/status")
def api_status():
    return jsonify({
        "status": "healthy",
        "uptime": time.time(),
        "connected_clients": len(connected_clients),
        "simulation": drone_sim.get_status(),
        "ml_model": _detector_name,
        "categories": ["no_damage", "low", "medium", "high", "severe"],
        "severity_scale": "1–10",
        "frames_processed": detector.frame_count,
    })


@app.route("/api/settings", methods=["GET"])
def get_settings():
    """Return current runtime settings."""
    return jsonify({
        "use_gemini": _active_use_gemini,
        "gemini_available": bool(_GEMINI_API_KEY),
        "ml_model": _detector_name,
    })


@app.route("/api/settings", methods=["POST"])
def update_settings():
    """Hot-swap the active detector at runtime."""
    global detector, _detector_name, _active_use_gemini

    data = request.get_json(silent=True) or {}
    if "use_gemini" not in data:
        return jsonify({"error": "Missing 'use_gemini' field"}), 400

    want_gemini = bool(data["use_gemini"])
    if want_gemini == _active_use_gemini:
        # No change needed
        return jsonify({
            "use_gemini": _active_use_gemini,
            "gemini_available": bool(_GEMINI_API_KEY),
            "ml_model": _detector_name,
        })

    new_detector, new_name, ok = _make_detector(want_gemini)
    if ok or not want_gemini:
        detector = new_detector
        _detector_name = new_name
        _active_use_gemini = want_gemini if ok else False
        # Update simulator reference so new captures use the new detector
        drone_sim.detector = detector
        print(f"[Settings] Detector switched → {_detector_name}")
    else:
        # Gemini init failed; stay on current detector
        return jsonify({
            "error": "Gemini initialisation failed. Check GEMINI_API_KEY.",
            "use_gemini": _active_use_gemini,
            "gemini_available": bool(_GEMINI_API_KEY),
            "ml_model": _detector_name,
        }), 500

    payload = {
        "use_gemini": _active_use_gemini,
        "gemini_available": bool(_GEMINI_API_KEY),
        "ml_model": _detector_name,
    }
    socketio.emit("settings_changed", payload)
    return jsonify(payload)


@app.route("/api/geocode", methods=["GET"])
def geocode_zone():
    lat = request.args.get("lat")
    lng = request.args.get("lng")
    if not lat or not lng:
        return jsonify({"error": "Missing lat/lng"}), 400
        
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=14&addressdetails=1"
        headers = {"User-Agent": "SkeemDroneMapper/1.0"}
        resp = requests.get(url, headers=headers, timeout=5)
        data = resp.json() if resp.status_code == 200 else {}
        
        display_name = data.get("display_name", f"{lat}, {lng}")
        location_type = data.get("type", "unknown")
        addresstype = data.get("addresstype", location_type)
        
        density = 1000
        if addresstype in ["city", "town", "borough", "commercial", "retail"]:
            density = 8500
        elif addresstype in ["suburb", "neighbourhood", "residential", "quarter"]:
            density = 4500
        elif addresstype in ["village", "hamlet", "municipality"]:
            density = 800
        elif addresstype in ["county", "state", "region", "country", "farm", "forest", "water"]:
            density = 50
            
        return jsonify({
            "location_name": display_name,
            "population_density": density,
            "address_type": addresstype
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/simulation/status")
def simulation_status():
    return jsonify(drone_sim.get_status())


@app.route("/api/predict", methods=["POST"])
def predict_damage():
    """
    Single-image damage prediction endpoint.

    Accepts:
        JSON body with { "image": "<base64-encoded image>" }
        OR multipart form with an 'image' file field

    Returns:
        {
            "type": "fire" | "flood" | "destruction" | "good",
            "severity": 1–10,
            "severity_label": "...",
            "confidence": 0.0–1.0
        }
    """
    import base64

    image_b64 = None

    # Accept JSON body
    if request.is_json:
        image_b64 = request.json.get("image")
    # Accept multipart file upload
    elif "image" in request.files:
        file = request.files["image"]
        image_b64 = base64.b64encode(file.read()).decode("utf-8")

    if not image_b64:
        return jsonify({"error": "No image provided. Send JSON {image: base64} or multipart file."}), 400

    try:
        prediction = detector.predict(image_b64)
        return jsonify(prediction)
    except Exception as e:
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500


# ═══════════════════════════════════════════════════════════════════════
# WebSocket Event Handlers
# ═══════════════════════════════════════════════════════════════════════

@socketio.on("connect")
def handle_connect():
    client_id = request.sid
    connected_clients[client_id] = {
        "connected_at": time.time(),
        "type": "unknown",
    }
    print(f"[Server] Client connected: {client_id} "
          f"(total: {len(connected_clients)})")
    emit("connection_ack", {
        "client_id": client_id,
        "server_time": time.time(),
        "message": "Connected to Skeem Damage Mapping Server",
    })
    # Replay full shared state to the newly connected client only
    emit("state_sync", shared_state)


@socketio.on("disconnect")
def handle_disconnect():
    client_id = request.sid
    connected_clients.pop(client_id, None)
    print(f"[Server] Client disconnected: {client_id} "
          f"(total: {len(connected_clients)})")


@socketio.on("register")
def handle_register(data):
    """Register a client as 'frontend' or 'drone'."""
    client_id = request.sid
    client_type = data.get("type", "unknown")
    if client_id in connected_clients:
        connected_clients[client_id]["type"] = client_type
    print(f"[Server] Client {client_id} registered as: {client_type}")
    emit("registered", {"client_id": client_id, "type": client_type})


# ─── Drone Frame Processing ──────────────────────────────────────────

@socketio.on("drone_frame")
def handle_drone_frame(data):
    """
    Receive a raw drone image frame, run ML processing, and broadcast
    the annotated result to all connected frontend clients.
    """
    image_b64 = data.get("image")
    metadata = data.get("metadata", {})

    if not image_b64:
        emit("error", {"message": "No image data received"})
        return

    frame_id = metadata.get("image_id", f"frame_{int(time.time()*1000)}")
    
    try:
        enqueue_frame(frame_id, image_b64, metadata)
        print(f"[Queue] Frame {frame_id} queued for processing")
    except Exception as e:
        print(f"[Server] Error queuing frame: {e}")
        emit("error", {"message": f"Queuing error: {str(e)}"})


# ─── Background ML Worker ──────────────────────────────────────────

def ml_worker_loop():
    """Background daemon to poll the SQLite database for pending ML jobs."""
    print("[Worker] Started background ML polling thread")
    while True:
        try:
            job = get_next_job()
            if not job:
                socketio.sleep(0.5)
                continue
                
            frame_id = job["frame_id"]
            image_b64 = job["image_b64"]
            try:
                metadata = json.loads(job["metadata"])
            except Exception:
                metadata = {}

            # Run ML damage detection
            result = detector.process_frame(image_b64)

            payload = {
                "image": result["image"],
                "detections": result["detections"],
                "processing_time_ms": result["processing_time_ms"],
                "frame_id": frame_id,
                "total_damage_count": result["total_damage_count"],
                "summary": result["summary"],
                "drone_metadata": metadata,
                "timestamp": time.time(),
            }

            frame_summary = {
                "frame_id": frame_id,
                "summary": result["summary"],
                "drone_metadata": metadata,
                "timestamp": payload["timestamp"],
            }
            shared_state["frames"] = ([frame_summary] + shared_state["frames"])[:200]

            socketio.emit("processed_frame", payload)
            mark_job_completed(job["id"])

            print(f"[ML] {frame_id} processed: {result['total_damage_count']} detections in {result['processing_time_ms']}ms")
            socketio.sleep(0.01)
            
        except Exception as e:
            print(f"[Worker] Error processing job: {e}")
            socketio.sleep(1)


# ─── Multi-Client Shared State Events ──────────────────────────────

@socketio.on("client_deploy_drones")
def handle_client_deploy_drones(data):
    """
    A frontend client deployed new drones into a coverage zone.
    Store in shared state and broadcast to all clients.
    """
    drones = data.get("drones", [])
    zone = data.get("zone")
    if zone:
        shared_state["coverage_zones"] = ([zone] + shared_state["coverage_zones"])[:80]
    shared_state["deployed_drones"] = drones + [
        d for d in shared_state["deployed_drones"]
        if d.get("id") not in {dr.get("id") for dr in drones}
    ]
    print(f"[State] deploy_drones: {len(drones)} drone(s), zone={zone.get('id') if zone else None}")
    broadcast_state()


@socketio.on("client_update_drones")
def handle_client_update_drones(data):
    """
    A frontend client emits updated drone positions (per simulation tick).
    Replace matching drones in shared state and broadcast.
    """
    updated = data.get("drones", [])
    if not updated:
        return
    updated_ids = {d.get("id") for d in updated}
    # Keep drones not in this update (they may be in another zone), replace the rest
    kept = [d for d in shared_state["deployed_drones"] if d.get("id") not in updated_ids]
    shared_state["deployed_drones"] = updated + kept
    broadcast_state()


@socketio.on("client_remove_drones")
def handle_client_remove_drones(data):
    """Remove completed drones from shared state."""
    remove_ids = set(data.get("ids", []))
    if not remove_ids:
        return
    shared_state["deployed_drones"] = [
        d for d in shared_state["deployed_drones"] if d.get("id") not in remove_ids
    ]
    broadcast_state()


@socketio.on("client_simulation_control")
def handle_client_simulation_control(data):
    """A client started or stopped the simulation."""
    running = bool(data.get("running", False))
    shared_state["simulation_running"] = running
    print(f"[State] simulation_running → {running}")
    broadcast_state()


@socketio.on("client_clear_simulation")
def handle_client_clear_simulation(data=None):
    """A client reset the entire simulation."""
    shared_state["deployed_drones"] = []
    shared_state["coverage_zones"] = []
    shared_state["simulation_running"] = False
    shared_state["frames"] = []
    print("[State] Simulation cleared by client")
    broadcast_state()


@socketio.on("client_add_zone")
def handle_client_add_zone(data):
    """A client added a new coverage zone."""
    zone = data.get("zone")
    if not zone:
        return
    shared_state["coverage_zones"] = ([zone] + shared_state["coverage_zones"])[:80]
    print(f"[State] add_zone: {zone.get('id')}")
    broadcast_state()


# ─── Simulation Controls ─────────────────────────────────────────────

@socketio.on("start_simulation")
def handle_start_simulation(data=None):
    """Start the drone simulator."""
    data = data or {}
    interval = data.get("interval", 2.0)
    # Use the first (most recent) coverage zone as the sweep area
    zones = shared_state.get("coverage_zones", [])
    zone = zones[0] if zones else None
    result = drone_sim.start(interval=interval, zone=zone)
    print(f"[Server] Simulation control: start → {result['status']}")
    emit("simulation_status", result)


@socketio.on("stop_simulation")
def handle_stop_simulation(data=None):
    """Stop the drone simulator."""
    result = drone_sim.stop()
    print(f"[Server] Simulation control: stop → {result['status']}")
    emit("simulation_status", result)


@socketio.on("get_simulation_status")
def handle_get_simulation_status(data=None):
    """Get current simulation status."""
    emit("simulation_status", drone_sim.get_status())


# ═══════════════════════════════════════════════════════════════════════
# Server Entry Point
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    init_db()
    
    print("=" * 60)
    print("  🛸 Skeem - Drone Damage Mapping Server")
    print("  📡 WebSocket: ws://localhost:5001")

    print("  🌐 REST API: http://localhost:5001/api/status")
    print("=" * 60)

    try:
        import torch
        print(f"[System] GPU Support: {torch.cuda.is_available()}")
    except ImportError:
        print("[System] PyTorch not installed")

    socketio.start_background_task(ml_worker_loop)
    
    socketio.run(
        app,
        host="0.0.0.0",
        port=5001,
        debug=True,
        use_reloader=False,  # Avoid double-start with eventlet
    )