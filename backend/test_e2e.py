"""
Quick E2E test: connects to the server via SocketIO, starts the
drone simulation, waits for a processed frame, then exits.
"""
import socketio
import time
import sys

sio = socketio.Client()
received_frames = []

@sio.on("connect")
def on_connect():
    print("[TEST] ✅ Connected to server")
    sio.emit("register", {"type": "test_client"})
    print("[TEST] Starting simulation...")
    sio.emit("start_simulation", {"interval": 1.5})

@sio.on("connection_ack")
def on_ack(data):
    print(f"[TEST] Server ACK: {data['message']}")

@sio.on("processed_frame")
def on_processed_frame(data):
    frame_id = data.get("frame_id", "?")
    detections = data.get("detections", [])
    proc_time = data.get("processing_time_ms", 0)
    img_len = len(data.get("image", ""))
    
    print(f"[TEST] ✅ Received processed frame: {frame_id}")
    print(f"       Detections: {len(detections)}")
    for d in detections:
        print(f"         - {d['label']} ({d['confidence']:.0%}) [{d['severity_label']}]")
    print(f"       Processing time: {proc_time}ms")
    print(f"       Image size: {img_len} chars (base64)")
    
    received_frames.append(data)

    if len(received_frames) >= 2:
        print(f"\n[TEST] 🎉 Successfully received {len(received_frames)} frames!")
        print("[TEST] Stopping simulation...")
        sio.emit("stop_simulation")
        time.sleep(0.5)
        sio.disconnect()

@sio.on("drone_telemetry")
def on_telemetry(data):
    print(f"[TEST] 📡 Telemetry: lat={data['lat']}, lng={data['lng']}, "
          f"alt={data['altitude_m']}m, battery={data['battery_pct']}%")

@sio.on("simulation_status")
def on_sim_status(data):
    print(f"[TEST] 🛸 Simulation: {data}")

@sio.on("error")
def on_error(data):
    print(f"[TEST] ❌ Error: {data}")

print("[TEST] Connecting to ws://localhost:5001 ...")
try:
    sio.connect("http://localhost:5001", transports=["websocket"])
    sio.wait()
    print("\n[TEST] ✅ ALL TESTS PASSED")
    sys.exit(0)
except Exception as e:
    print(f"[TEST] ❌ Connection failed: {e}")
    sys.exit(1)
