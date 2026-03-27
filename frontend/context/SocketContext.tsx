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

interface SocketContextValue {
  status: ConnectionStatus
  latestFrame: DroneFrame | null
  frames: DroneFrame[]
  frameCount: number
  lastFrameAt: number | null
}

const SocketContext = createContext<SocketContextValue>({
  status: "connecting",
  latestFrame: null,
  frames: [],
  frameCount: 0,
  lastFrameAt: null,
})

// Demo simulation — random damage frames near New Delhi
const DEMO_LABELS = [
  "structural_collapse",
  "roof_damage",
  "road_obstruction",
  "flooding",
  "fire_damage",
  "debris_field",
  "power_line_down",
  "landslide",
]

function randomDemoFrame(id: number): Omit<DroneFrame, "receivedAt"> {
  const baseLat = 28.6139
  const baseLng = 77.209
  return {
    frame_id: String(id).padStart(3, "0"),
    lat: baseLat + (Math.random() - 0.5) * 0.12,
    lng: baseLng + (Math.random() - 0.5) * 0.12,
    severity: Math.round(Math.random() * 100) / 10,
    label: DEMO_LABELS[Math.floor(Math.random() * DEMO_LABELS.length)],
  }
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [latestFrame, setLatestFrame] = useState<DroneFrame | null>(null)
  const [frames, setFrames] = useState<DroneFrame[]>([])
  const [frameCount, setFrameCount] = useState(0)
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null)
  const demoCounterRef = useRef(1)
  const socketRef = useRef<import("socket.io-client").Socket | null>(null)

  const handleFrame = useCallback((raw: Omit<DroneFrame, "receivedAt">) => {
    const frame: DroneFrame = { ...raw, receivedAt: Date.now() }
    setLatestFrame(frame)
    setFrames((prev) => [frame, ...prev].slice(0, 200))
    setFrameCount((c) => c + 1)
    setLastFrameAt(Date.now())
  }, [])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL

    // If no socket URL is configured, run in demo mode
    if (!url) {
      setStatus("demo")
      // Seed a few frames immediately
      const seed = Array.from({ length: 8 }, (_, i) => {
        const raw = randomDemoFrame(demoCounterRef.current++)
        return { ...raw, receivedAt: Date.now() - (8 - i) * 3000 }
      })
      setFrames(seed)
      setLatestFrame(seed[0])
      setFrameCount(seed.length)
      setLastFrameAt(seed[0].receivedAt)

      // Then emit a new frame every 4 seconds
      const interval = setInterval(() => {
        handleFrame(randomDemoFrame(demoCounterRef.current++))
      }, 4000)
      return () => clearInterval(interval)
    }

    // Real socket connection
    import("socket.io-client").then(({ io }) => {
      const socket = io(url, {
        transports: ["websocket"],
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      })

      socketRef.current = socket

      socket.on("connect", () => setStatus("connected"))
      socket.on("disconnect", () => setStatus("disconnected"))
      socket.on("connect_error", () => setStatus("error"))
      socket.on("reconnect_attempt", () => setStatus("connecting"))
      socket.on("reconnect", () => setStatus("connected"))

      socket.on("frame", handleFrame)
      socket.on("drone_frame", handleFrame)
      socket.on("damage_frame", handleFrame)
    })

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [handleFrame])

  return (
    <SocketContext.Provider value={{ status, latestFrame, frames, frameCount, lastFrameAt }}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  return useContext(SocketContext)
}
