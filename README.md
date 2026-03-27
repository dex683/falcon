# Autonomous Drone based Damage mapping - Team Skeem
A real-time disaster damage assessment system that uses simulated drone footage to map and prioritize damaged areas for first responders.

---

## Overview

After a disaster, ground teams need to know where to go first. This project simulates an autonomous drone surveying an affected area, sending aerial images back to a backend that scores damage severity using a vision ML model. Results are plotted live on a map, color-coded by severity, and ranked into a priority response list.

---

## How It Works

1. A Python script simulates a drone flying a predefined path, sending GPS coordinates and images to the backend over a WebSocket connection.
2. The backend places incoming frames into a SQLite-backed FIFO queue. A background worker picks them up one at a time and runs inference using a YOLOv8 model fine-tuned on the xBD disaster dataset.
3. Each frame is assigned a damage severity score from 0 to 10 and a damage label (e.g. structural collapse, flooding, fire).
4. Results are broadcast to the frontend in real time. The map updates with color-coded markers and the priority list re-ranks automatically based on severity.

---

## System Design

```
Drone Simulator (Python)
        |
        |  { frame_id, lat, lng, image (base64) }
        v
FastAPI Backend (Python)
        |
        |-- SQLite Queue
        |        |
        |   Vision Worker (YOLOv8)
        |        |
        |   { frame_id, lat, lng, severity (0-10), label }
        |
        v
Next.js Frontend
        |
        |-- Leaflet Map (OSM tiles) -- color-coded markers
        |-- Priority Response List
```

---

## Severity Scale

| Score | Color | Meaning |
|-------|-------|---------|
| 0 - 3 | Green | Minor or no damage |
| 4 - 6 | Orange | Moderate damage |
| 7 - 10 | Red | Severe damage, respond first |

---

## Tech Stack

| Part | Technology |
|------|------------|
| Frontend | Next.js, Leaflet.js, OpenStreetMap |
| Backend | Python, FastAPI |
| Transport | WebSocket via Socket.IO |
| ML Model | YOLOv8 fine-tuned on xBD dataset |
| Drone Sim | Python script |

---

## Getting Started

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Drone Simulator

```bash
cd simulator
python drone_sim.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---
