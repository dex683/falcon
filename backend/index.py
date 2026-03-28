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
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# Load .env file if present (before reading env vars)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from ml_processor import DamageDetector
from drone_simulator import DroneSimulator

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
_use_gemini = os.environ.get("USE_GEMINI_FALLBACK", "0").strip().lower() in (
    "1", "true", "yes", "on"
)

if _use_gemini:
    try:
        from gemini_processor import GeminiDamageDetector
        detector = GeminiDamageDetector()
        _detector_name = "GeminiDamageDetector (gemini-2.0-flash)"
        print("[Detector] ✅ Using Gemini Vision API for damage detection")
    except Exception as _e:
        print(f"[Detector] ⚠️  Gemini init failed ({_e}), falling back to mock model")
        detector = DamageDetector(min_detections=1, max_detections=5)
        _detector_name = "DamageDetector-Mock (fire|flood|destruction|good)"
else:
    detector = DamageDetector(min_detections=1, max_detections=5)
    _detector_name = "DamageDetector-Mock (fire|flood|destruction|good)"
    print("[Detector] Using Mock ML model (set USE_GEMINI_FALLBACK=1 to enable Gemini)")

# ─── Services ────────────────────────────────────────────────────────
drone_sim = DroneSimulator(socketio, detector=detector)

# ─── Connection Tracking ─────────────────────────────────────────────
connected_clients = {}

# ─── Shared Simulation State ─────────────────────────────────────────
# This is the single source of truth replayed to every connecting client
# and broadcast to all clients whenever anything changes.
shared_state = {
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
        "categories": ["fire", "flood", "destruction", "good"],
        "severity_scale": "1–10",
        "frames_processed": detector.frame_count,
    })


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

    try:
        # Run ML damage detection
        result = detector.process_frame(image_b64)

        # Build the processed frame payload
        payload = {
            "image": result["image"],
            "detections": result["detections"],
            "processing_time_ms": result["processing_time_ms"],
            "frame_id": result["frame_id"],
            "total_damage_count": result["total_damage_count"],
            "summary": result["summary"],
            "drone_metadata": metadata,
            "timestamp": time.time(),
        }

        # Store frame in shared state for replay to new clients (keep last 200)
        frame_summary = {
            "frame_id": result["frame_id"],
            "summary": result["summary"],
            "drone_metadata": metadata,
            "timestamp": payload["timestamp"],
        }
        shared_state["frames"] = ([frame_summary] + shared_state["frames"])[:200]

        # Broadcast to ALL connected clients (including sender)
        socketio.emit("processed_frame", payload)

        # Log
        det_count = result["total_damage_count"]
        proc_time = result["processing_time_ms"]
        print(f"[ML] {result['frame_id']} processed: "
              f"{det_count} detections in {proc_time}ms")

    except Exception as e:
        print(f"[Server] Error processing frame: {e}")
        emit("error", {"message": f"Processing error: {str(e)}"})


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
    result = drone_sim.start(interval=interval)
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
    print("=" * 60)
    print("  🛸 Skeem - Drone Damage Mapping Server")
    print("  📡 WebSocket: ws://localhost:5001")
    print("  🌐 REST API: http://localhost:5001/api/status")
    print("=" * 60)

    socketio.run(
        app,
        host="0.0.0.0",
        port=5001,
        debug=True,
        use_reloader=False,  # Avoid double-start with eventlet
    )