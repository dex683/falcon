"""
Skeem — Autonomous Drone Damage Mapping Server
================================================
Flask-SocketIO server that receives drone images in real-time,
processes them through an ML damage detection pipeline, and
streams annotated results to the frontend via WebSockets.
"""

import eventlet
eventlet.monkey_patch()

import time
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

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

# ─── Services ────────────────────────────────────────────────────────
detector = DamageDetector(min_detections=1, max_detections=5)
drone_sim = DroneSimulator(socketio, detector=detector)

# ─── Connection Tracking ─────────────────────────────────────────────
connected_clients = {}


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
        "ml_model": "DamageDetector-Mock (fire|flood|destruction|good)",
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
    print("  🛸 Skeem — Drone Damage Mapping Server")
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