"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"

export interface DroneFrame {
  frame_id: string
  lat: number
  lng: number
  severity: number
  label: string
  receivedAt: number
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error" | "demo"

export interface DroneTelemetry {
  drone_id: string
  lat: number
  lng: number
  altitude_m: number
  heading_deg: number
  speed_ms: number
  battery_pct: number
  signal_strength: number
  gps_satellites: number
  flight_time_s: number
  frames_sent: number
  timestamp: number
}

export interface SimulationStatus {
  running: boolean
  frames_sent: number
  battery?: number
  elapsed_s?: number
  reason?: string
  status?: string
  interval?: number
}

interface SocketContextValue {
  status: ConnectionStatus
  latestFrame: DroneFrame | null
  frames: DroneFrame[]
  frameCount: number
  lastFrameAt: number | null
  latestTelemetry: DroneTelemetry | null
  simulationStatus: SimulationStatus | null
  sendDroneFrame: (imageBase64: string, metadata?: Record<string, unknown>) => void
  startSimulation: (intervalSeconds?: number) => void
  stopSimulation: () => void
  getSimulationStatus: () => void
}

const SocketContext = createContext<SocketContextValue>({
  status: "connecting",
  latestFrame: null,
  frames: [],
  frameCount: 0,
  lastFrameAt: null,
  latestTelemetry: null,
  simulationStatus: null,
  sendDroneFrame: () => {},
  startSimulation: () => {},
  stopSimulation: () => {},
  getSimulationStatus: () => {},
})

function normalizeTimestampMs(timestamp: unknown): number {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return Date.now()
  // Backend docs use Unix seconds (float). If it looks like ms already, keep it.
  return timestamp > 1e12 ? Math.round(timestamp) : Math.round(timestamp * 1000)
}

type ProcessedFramePayload = {
  frame_id: string
  timestamp: number
  summary?: {
    type?: string
    severity?: number
  }
  drone_metadata?: {
    lat?: number
    lng?: number
  }
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [latestFrame, setLatestFrame] = useState<DroneFrame | null>(null)
  const [frames, setFrames] = useState<DroneFrame[]>([])
  const [frameCount, setFrameCount] = useState(0)
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null)
  const [latestTelemetry, setLatestTelemetry] = useState<DroneTelemetry | null>(null)
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatus | null>(null)
  const socketRef = useRef<import("socket.io-client").Socket | null>(null)

  const startSimulation = useCallback((intervalSeconds?: number) => {
    const socket = socketRef.current
    if (!socket) return
    const interval = typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds)
      ? Math.max(0.25, Math.min(10, intervalSeconds))
      : undefined
    socket.emit("start_simulation", interval ? { interval } : undefined)
  }, [])

  const sendDroneFrame = useCallback((imageBase64: string, metadata?: Record<string, unknown>) => {
    const socket = socketRef.current
    if (!socket) return
    if (typeof imageBase64 !== "string" || imageBase64.length === 0) return
    socket.emit("drone_frame", {
      image: imageBase64,
      metadata: metadata && typeof metadata === "object" ? metadata : undefined,
    })
  }, [])

  const stopSimulation = useCallback(() => {
    socketRef.current?.emit("stop_simulation")
  }, [])

  const getSimulationStatus = useCallback(() => {
    socketRef.current?.emit("get_simulation_status")
  }, [])

  const handleProcessedFrame = useCallback((payload: ProcessedFramePayload) => {
    if (!payload || typeof payload !== "object") return

    const receivedAt = normalizeTimestampMs(payload.timestamp)
    const lat = payload.drone_metadata?.lat
    const lng = payload.drone_metadata?.lng
    const severity = payload.summary?.severity
    const label = payload.summary?.type

    if (typeof lat !== "number" || typeof lng !== "number") return
    if (typeof severity !== "number" || !Number.isFinite(severity)) return

    const frame: DroneFrame = {
      frame_id: payload.frame_id,
      lat,
      lng,
      severity,
      label: typeof label === "string" && label.length > 0 ? label : "unknown",
      receivedAt,
    }

    setLatestFrame(frame)
    setFrames((prev) => [frame, ...prev].slice(0, 200))
    setFrameCount((c) => c + 1)
    setLastFrameAt(receivedAt)
  }, [])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5001"

    // Real Socket.IO connection (Skeem backend)
    import("socket.io-client").then(({ io }) => {
      const socket = io(url, {
        transports: ["websocket"],
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      })

      socketRef.current = socket

      socket.on("connect", () => {
        setStatus("connected")
        socket.emit("register", { type: "frontend" })
      })
      socket.on("disconnect", () => setStatus("disconnected"))
      socket.on("connect_error", () => setStatus("error"))
      socket.on("reconnect_attempt", () => setStatus("connecting"))
      socket.on("reconnect", () => setStatus("connected"))

      socket.on("processed_frame", handleProcessedFrame)
      socket.on("drone_telemetry", (telemetry: DroneTelemetry) => {
        if (!telemetry || typeof telemetry !== "object") return
        setLatestTelemetry(telemetry)
      })
      socket.on("simulation_status", (sim: SimulationStatus) => {
        if (!sim || typeof sim !== "object") return
        setSimulationStatus(sim)
      })
    })

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [handleProcessedFrame])

  return (
    <SocketContext.Provider
      value={{
        status,
        latestFrame,
        frames,
        frameCount,
        lastFrameAt,
        latestTelemetry,
        simulationStatus,
        sendDroneFrame,
        startSimulation,
        stopSimulation,
        getSimulationStatus,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  return useContext(SocketContext)
}
