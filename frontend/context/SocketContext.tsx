"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"
import type { DeployedDrone, CoverageCircle } from "@/lib/simulator"

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

// ─── Shared State (synced across all clients) ─────────────────────────────
export interface SharedState {
  deployed_drones: DeployedDrone[]
  coverage_zones: CoverageCircle[]
  simulation_running: boolean
  frames: unknown[]  // summarized frame history (no image data)
}

interface SocketContextValue {
  status: ConnectionStatus
  latestFrame: DroneFrame | null
  frames: DroneFrame[]
  frameCount: number
  lastFrameAt: number | null
  latestTelemetry: DroneTelemetry | null
  simulationStatus: SimulationStatus | null

  // Shared state (synced across all clients via server)
  syncedDrones: DeployedDrone[]
  syncedZones: CoverageCircle[]
  syncedSimRunning: boolean

  // Emitters
  sendDroneFrame: (imageBase64: string, metadata?: Record<string, unknown>) => void
  startSimulation: (intervalSeconds?: number) => void
  stopSimulation: () => void
  getSimulationStatus: () => void

  // Multi-client shared state emitters
  emitDeployDrones: (drones: DeployedDrone[], zone: CoverageCircle) => void
  emitUpdateDrones: (drones: DeployedDrone[]) => void
  emitRemoveDrones: (ids: string[]) => void
  emitSimControl: (running: boolean) => void
  emitClearSimulation: () => void
  emitAddZone: (zone: CoverageCircle) => void
}

const SocketContext = createContext<SocketContextValue>({
  status: "connecting",
  latestFrame: null,
  frames: [],
  frameCount: 0,
  lastFrameAt: null,
  latestTelemetry: null,
  simulationStatus: null,
  syncedDrones: [],
  syncedZones: [],
  syncedSimRunning: false,
  sendDroneFrame: () => {},
  startSimulation: () => {},
  stopSimulation: () => {},
  getSimulationStatus: () => {},
  emitDeployDrones: () => {},
  emitUpdateDrones: () => {},
  emitRemoveDrones: () => {},
  emitSimControl: () => {},
  emitClearSimulation: () => {},
  emitAddZone: () => {},
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
    status?: string
    type?: string
    severity?: number
    max_severity?: number
  }
  drone_metadata?: {
    lat?: number
    lng?: number
  }
  metadata?: {
    lat?: number
    lng?: number
    [key: string]: unknown
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

  // Shared synced state (driven by `state_sync` events from server)
  const [syncedDrones, setSyncedDrones] = useState<DeployedDrone[]>([])
  const [syncedZones, setSyncedZones] = useState<CoverageCircle[]>([])
  const [syncedSimRunning, setSyncedSimRunning] = useState(false)

  const socketRef = useRef<import("socket.io-client").Socket | null>(null)

  // ─── Simulation Controls ──────────────────────────────────────────────
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

  // ─── Multi-Client Shared State Emitters ──────────────────────────────
  const emitDeployDrones = useCallback((drones: DeployedDrone[], zone: CoverageCircle) => {
    socketRef.current?.emit("client_deploy_drones", { drones, zone })
  }, [])

  const emitUpdateDrones = useCallback((drones: DeployedDrone[]) => {
    socketRef.current?.emit("client_update_drones", { drones })
  }, [])

  const emitRemoveDrones = useCallback((ids: string[]) => {
    socketRef.current?.emit("client_remove_drones", { ids })
  }, [])

  const emitSimControl = useCallback((running: boolean) => {
    socketRef.current?.emit("client_simulation_control", { running })
  }, [])

  const emitClearSimulation = useCallback(() => {
    socketRef.current?.emit("client_clear_simulation", {})
  }, [])

  const emitAddZone = useCallback((zone: CoverageCircle) => {
    socketRef.current?.emit("client_add_zone", { zone })
  }, [])

  // ─── Incoming Frame Processing ────────────────────────────────────────
  const handleProcessedFrame = useCallback((payload: ProcessedFramePayload) => {
    if (!payload || typeof payload !== "object") return

    const receivedAt = normalizeTimestampMs(payload.timestamp)
    const lat = payload.drone_metadata?.lat ?? payload.metadata?.lat
    const lng = payload.drone_metadata?.lng ?? payload.metadata?.lng
    const severity = payload.summary?.severity ?? payload.summary?.max_severity
    const label = payload.summary?.type ?? payload.summary?.status

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

  // ─── Socket Connection ────────────────────────────────────────────────
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5001"

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

      // ─── Multi-client state sync ──────────────────────────────────────
      socket.on("state_sync", (state: SharedState) => {
        if (!state || typeof state !== "object") return
        setSyncedDrones(Array.isArray(state.deployed_drones) ? state.deployed_drones : [])
        setSyncedZones(Array.isArray(state.coverage_zones) ? state.coverage_zones : [])
        setSyncedSimRunning(Boolean(state.simulation_running))
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
        syncedDrones,
        syncedZones,
        syncedSimRunning,
        sendDroneFrame,
        startSimulation,
        stopSimulation,
        getSimulationStatus,
        emitDeployDrones,
        emitUpdateDrones,
        emitRemoveDrones,
        emitSimControl,
        emitClearSimulation,
        emitAddZone,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  return useContext(SocketContext)
}
