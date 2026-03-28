"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DroneFrame } from "@/context/SocketContext"
import { useSocket } from "@/context/SocketContext"
import { toast } from "@/hooks/use-toast"
import { SeveritySidebar } from "@/components/severity-sidebar"
import { BottomDock, type DashboardView } from "@/components/bottom-dock"
import dynamic from "next/dynamic"
import {
  pointOffset,
  randomPointInCircle,
  type CircleDraft,
  type CoverageCircle,
  type DeployedDrone,
  type SimulatorDispatchPayload,
} from "@/lib/simulator"

// Dynamically import the map to avoid SSR issues with maplibre-gl
const LiveMap = dynamic(() => import("@/components/live-map").then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-0 animate-pulse bg-[oklch(0.10_0_0)]" aria-label="Loading map" />
  ),
})

const SIMULATION_LABELS = ["roof_damage", "road_block", "flooding", "debris_field", "fire_damage"]

// 1x1 transparent PNG (raw base64, no data URI prefix) — used as a tiny payload for backend integration.
const PLACEHOLDER_FRAME_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2yZ6QAAAAASUVORK5CYII="

export default function DashboardPage() {
  const { frames, latestFrame, status, frameCount, lastFrameAt, sendDroneFrame } = useSocket()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeView, setActiveView] = useState<DashboardView>("map")
  const [autoPan, setAutoPan] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [simulationIntervalMs, setSimulationIntervalMs] = useState(2200)
  const [maxVisibleReports, setMaxVisibleReports] = useState(120)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [simulatedFrames, setSimulatedFrames] = useState<DroneFrame[]>([])
  const [simulationDrawMode, setSimulationDrawMode] = useState(false)
  const [draftCircle, setDraftCircle] = useState<CircleDraft | null>(null)
  const [coverageCircles, setCoverageCircles] = useState<CoverageCircle[]>([])
  const [deployedDrones, setDeployedDrones] = useState<DeployedDrone[]>([])
  const [dispatchPayloads, setDispatchPayloads] = useState<SimulatorDispatchPayload[]>([])
  const [dronesPerDeployment, setDronesPerDeployment] = useState(1)

  const frameCounterRef = useRef(1)
  const zoneCounterRef = useRef(1)
  const droneCounterRef = useRef(1)
  const payloadCounterRef = useRef(1)

  const emitFramesForDrones = useCallback((sourceDrones: DeployedDrone[]) => {
    if (sourceDrones.length === 0) return
    const now = Date.now()
    const generatedFrames: DroneFrame[] = sourceDrones.map((drone) => {
      const sample = randomPointInCircle(
        drone.centerLat,
        drone.centerLng,
        Math.max(30, drone.radiusMeters * 0.35)
      )

      return {
        frame_id: `SIM-${String(frameCounterRef.current++).padStart(4, "0")}`,
        lat: sample.lat,
        lng: sample.lng,
        // The backend will compute real severity/label; keep this local record minimal.
        severity: 0,
        label: SIMULATION_LABELS[Math.floor(Math.random() * SIMULATION_LABELS.length)],
        receivedAt: now,
      }
    })

    const payloadBatch: SimulatorDispatchPayload[] = sourceDrones.map((drone, index) => ({
      id: `PAY-${String(payloadCounterRef.current++).padStart(5, "0")}`,
      droneId: drone.id,
      zoneId: drone.zoneId,
      imageId: `IMG-${Date.now()}-${index}`,
      lat: generatedFrames[index].lat,
      lng: generatedFrames[index].lng,
      createdAt: now,
    }))

    // Send frames to backend for ML processing. The backend responds via `processed_frame`.
    for (let i = 0; i < payloadBatch.length; i++) {
      const payload = payloadBatch[i]
      sendDroneFrame(PLACEHOLDER_FRAME_IMAGE_BASE64, {
        lat: payload.lat,
        lng: payload.lng,
        source: "frontend_simulator",
        drone_id: payload.droneId,
        zone_id: payload.zoneId,
        image_id: payload.imageId,
      })
    }

    // Keep a local record of dispatched frames for UI counts only.
    setSimulatedFrames((prev) => [...generatedFrames, ...prev].slice(0, 500))
    setDispatchPayloads((prev) => [...payloadBatch, ...prev].slice(0, 300))
  }, [sendDroneFrame])

  const deployFromDraftCircle = useCallback(() => {
    if (!draftCircle) return

    const zoneId = `ZONE-${String(zoneCounterRef.current++).padStart(3, "0")}`
    const zone: CoverageCircle = {
      id: zoneId,
      centerLat: draftCircle.centerLat,
      centerLng: draftCircle.centerLng,
      radiusMeters: draftCircle.radiusMeters,
      createdAt: Date.now(),
    }

    const count = Math.max(1, Math.min(8, dronesPerDeployment))
    const freshDrones: DeployedDrone[] = Array.from({ length: count }, (_, index) => {
      const orbitMeters = Math.max(40, draftCircle.radiusMeters * (0.25 + Math.random() * 0.6))
      const angleRad = Math.random() * Math.PI * 2
      const angularVelocity = (0.2 + Math.random() * 0.8) * (Math.random() > 0.5 ? 1 : -1)
      const position = pointOffset(draftCircle.centerLat, draftCircle.centerLng, orbitMeters, angleRad)

      return {
        id: `DRONE-${String(droneCounterRef.current++).padStart(3, "0")}`,
        label: `Drone ${index + 1}`,
        zoneId,
        centerLat: draftCircle.centerLat,
        centerLng: draftCircle.centerLng,
        radiusMeters: draftCircle.radiusMeters,
        lat: position.lat,
        lng: position.lng,
        angleRad,
        angularVelocity,
        orbitMeters,
        updatedAt: Date.now(),
      }
    })

    setCoverageCircles((prev) => [zone, ...prev].slice(0, 80))
    setDeployedDrones((prev) => [ ...freshDrones, ...prev ])
    emitFramesForDrones(freshDrones)
    setDraftCircle(null)
    setSimulationDrawMode(false)
  }, [draftCircle, dronesPerDeployment, emitFramesForDrones])

  const captureNow = useCallback(() => {
    if (deployedDrones.length === 0) return
    emitFramesForDrones(deployedDrones)
  }, [deployedDrones, emitFramesForDrones])

  const clearSimulator = useCallback(() => {
    setSimulationRunning(false)
    setSimulatedFrames([])
    setDispatchPayloads([])
    setCoverageCircles([])
    setDeployedDrones([])
    setDraftCircle(null)
    setSimulationDrawMode(false)
  }, [])

  useEffect(() => {
    if (!simulationRunning || deployedDrones.length === 0) return
    const tick = Math.max(500, simulationIntervalMs)

    const interval = setInterval(() => {
      const now = Date.now()
      const dt = tick / 1000

      setDeployedDrones((prev) => {
        if (prev.length === 0) return prev

        const moved = prev.map((drone) => {
          const nextAngle = drone.angleRad + drone.angularVelocity * dt
          const nextPosition = pointOffset(
            drone.centerLat,
            drone.centerLng,
            drone.orbitMeters,
            nextAngle
          )

          return {
            ...drone,
            angleRad: nextAngle,
            lat: nextPosition.lat,
            lng: nextPosition.lng,
            updatedAt: now,
          }
        })

        emitFramesForDrones(moved)
        return moved
      })
    }, tick)

    return () => clearInterval(interval)
  }, [deployedDrones.length, emitFramesForDrones, simulationIntervalMs, simulationRunning])

  // Only show backend-processed frames on the map/severity list.
  const combinedFrames = useMemo(
    () => [...frames].sort((a, b) => b.receivedAt - a.receivedAt),
    [frames]
  )

  const combinedLatestFrame = combinedFrames[0] ?? latestFrame

  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    if (prev === status) return
    prevStatusRef.current = status

    if (status === "disconnected" || status === "error") {
      if (prev === "connected") {
        toast({
          title: "Socket disconnected",
          description: "Live feed is currently offline.",
          variant: "destructive",
        })
      }
      return
    }

    if (status === "connected" && (prev === "disconnected" || prev === "error")) {
      toast({
        title: "Socket reconnected",
        description: "Live feed restored.",
      })
    }
  }, [status])

  const statusDotColor =
    status === "connected"
      ? "bg-[oklch(0.72_0.19_142)]"
      : status === "disconnected" || status === "error"
        ? "bg-[oklch(0.62_0.23_25)]"
        : "bg-[oklch(0.55_0_0)]"

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[oklch(0.10_0_0)]">
      {/* Status badge (top-right, non-intrusive) */}
      <div className="fixed right-4 top-4 z-40">
        <div className="flex h-8 items-center gap-3 rounded-full border border-border bg-surface px-3 text-[11px] text-[oklch(0.75_0_0)] shadow-lg backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusDotColor}`} aria-label={`Socket status ${status}`} />
            <span className="text-[11px]">{status.charAt(0).toUpperCase() + status.slice(1)}</span>
          </div>
          <div className="h-4 w-px bg-border/70" />
          <div className="flex items-center gap-1">
            <span className="text-[oklch(0.55_0_0)]">Frames</span>
            <span className="tabular-nums text-[oklch(0.92_0_0)]">{frameCount}</span>
          </div>
          <div className="h-4 w-px bg-border/70" />
          <div className="flex items-center gap-1">
            <span className="text-[oklch(0.55_0_0)]">Last</span>
            <span className="tabular-nums text-[oklch(0.92_0_0)]">
              {lastFrameAt ? new Date(lastFrameAt).toLocaleTimeString() : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Layer 0: Full-viewport map */}
      <LiveMap
        frames={combinedFrames}
        latestFrame={combinedLatestFrame}
        autoPan={autoPan}
        showHeatmap={showHeatmap}
        drawMode={activeView === "simulation" && simulationDrawMode}
        coverageCircles={coverageCircles}
        deployedDrones={deployedDrones}
        circleDraft={draftCircle}
        onCircleDraftChange={setDraftCircle}
        onCircleDrawComplete={setDraftCircle}
      />

      {/* Layer 1: Floating side menu */}
      <SeveritySidebar
        view={activeView}
        frames={combinedFrames}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        maxVisibleReports={maxVisibleReports}
        autoPan={autoPan}
        showHeatmap={showHeatmap}
        simulationIntervalMs={simulationIntervalMs}
        onAutoPanChange={setAutoPan}
        onShowHeatmapChange={setShowHeatmap}
        onSimulationIntervalChange={(next) => setSimulationIntervalMs(Math.max(500, Math.min(10000, Number.isFinite(next) ? next : 2200)))}
        onMaxVisibleReportsChange={(next) => setMaxVisibleReports(Math.max(20, Math.min(300, Number.isFinite(next) ? next : 120)))}
        onResetSettings={() => {
          setAutoPan(true)
          setShowHeatmap(false)
          setSimulationIntervalMs(2200)
          setMaxVisibleReports(120)
        }}
        simulationRunning={simulationRunning}
        simulatedCount={simulatedFrames.length}
        onStartSimulation={() => setSimulationRunning(true)}
        onStopSimulation={() => setSimulationRunning(false)}
        onCaptureNow={captureNow}
        onClearSimulation={clearSimulator}
        drawMode={simulationDrawMode}
        onToggleDrawMode={() => setSimulationDrawMode((prev) => !prev)}
        draftCircle={draftCircle}
        dronesPerDeployment={dronesPerDeployment}
        onDronesPerDeploymentChange={(next) => setDronesPerDeployment(Math.max(1, Math.min(8, Number.isFinite(next) ? next : 1)))}
        onDeployFromCircle={deployFromDraftCircle}
        deployedDrones={deployedDrones}
        deployedZones={coverageCircles.length}
        dispatchCount={dispatchPayloads.length}
      />

      {/* Layer 2: Bottom dock */}
      <BottomDock activeView={activeView} onSelect={setActiveView} />
    </main>
  )
}
