"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DroneFrame } from "@/context/SocketContext"
import { useSocket } from "@/context/SocketContext"
import { toast } from "@/hooks/use-toast"
import { SeveritySidebar } from "@/components/severity-sidebar"
import { BottomDock, type DashboardView } from "@/components/bottom-dock"
import dynamic from "next/dynamic"
import {
  areaCellKeyForLatLng,
  distanceMeters,
  isInsideCircleMeters,
  pointOffset,
  stepInwardSpiralConstantSpeed,
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

const DEFAULT_DRONE_SPEED_MS = 6
const DEFAULT_SPIRAL_SPACING_METERS = 50
const DEFAULT_DRONE_ALTITUDE_M = 120
const ALTITUDE_COVERAGE_CELL_FACTOR = 0.6
const CUSTOM_POINT_TRIGGER_METERS = 12

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
  const [droneSpeedMs, setDroneSpeedMs] = useState(DEFAULT_DRONE_SPEED_MS)
  const [spiralSpacingMeters, setSpiralSpacingMeters] = useState(DEFAULT_SPIRAL_SPACING_METERS)
  const [droneAltitudeM, setDroneAltitudeM] = useState(DEFAULT_DRONE_ALTITUDE_M)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [simulatedFrames, setSimulatedFrames] = useState<DroneFrame[]>([])
  const [simulationDrawMode, setSimulationDrawMode] = useState(false)
  const [draftCircle, setDraftCircle] = useState<CircleDraft | null>(null)
  const [coverageCircles, setCoverageCircles] = useState<CoverageCircle[]>([])
  const [deployedDrones, setDeployedDrones] = useState<DeployedDrone[]>([])
  const [dispatchPayloads, setDispatchPayloads] = useState<SimulatorDispatchPayload[]>([])
  const [dronesPerDeployment, setDronesPerDeployment] = useState(1)

  const [folderImages, setFolderImages] = useState<File[]>([])
  const [customPointMode, setCustomPointMode] = useState(false)
  const [customTestPoint, setCustomTestPoint] = useState<{ lat: number; lng: number; zoneId?: string } | null>(null)
  const [customImageFile, setCustomImageFile] = useState<File | null>(null)

  const frameCounterRef = useRef(1)
  const zoneCounterRef = useRef(1)
  const droneCounterRef = useRef(1)
  const payloadCounterRef = useRef(1)

  const visitedCellsRef = useRef(new Map<string, Set<string>>())
  const base64CacheRef = useRef(new Map<string, string>())
  const customPointTriggeredRef = useRef(false)

  const fileToBase64Raw = useCallback(async (file: File) => {
    const cacheKey = `${file.name}:${file.size}:${file.lastModified}`
    const cached = base64CacheRef.current.get(cacheKey)
    if (cached) return cached

    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== "string") {
          reject(new Error("Unexpected FileReader result"))
          return
        }
        const comma = result.indexOf(",")
        if (comma === -1) {
          reject(new Error("Invalid data URL"))
          return
        }
        resolve(result.slice(comma + 1))
      }
      reader.readAsDataURL(file)
    })

    base64CacheRef.current.set(cacheKey, raw)
    return raw
  }, [])

  const pickRandomFolderImage = useCallback(() => {
    if (folderImages.length === 0) return null
    return folderImages[Math.floor(Math.random() * folderImages.length)] ?? null
  }, [folderImages])

  const queueCapturesForDrones = useCallback((sourceDrones: DeployedDrone[], reason: "tick" | "manual" | "deploy") => {
    if (sourceDrones.length === 0) return
    const now = Date.now()
    const speed = Number.isFinite(droneSpeedMs) ? Math.max(0, droneSpeedMs) : DEFAULT_DRONE_SPEED_MS
    const altitude = Number.isFinite(droneAltitudeM) ? Math.max(10, droneAltitudeM) : DEFAULT_DRONE_ALTITUDE_M

    type Candidate = {
      drone: DeployedDrone
      lat: number
      lng: number
      zoneId: string
      imageFile: File | null
      isCustomPoint: boolean
      cellKey: string
    }

    const candidates: Candidate[] = []

    for (const drone of sourceDrones) {
      if (drone.spiralCompleted) continue
      if (!isInsideCircleMeters(drone.centerLat, drone.centerLng, drone.radiusMeters, drone.lat, drone.lng)) continue

      const cellSize = Math.max(8, drone.spiralSpacingMeters * 0.8)
      const altitudeCell = altitude * ALTITUDE_COVERAGE_CELL_FACTOR
      const effectiveCellSize = Math.max(cellSize, altitudeCell)
      const cellKey = areaCellKeyForLatLng(drone.centerLat, drone.centerLng, drone.lat, drone.lng, effectiveCellSize)
      const zoneKey = drone.zoneId

      let zoneSet = visitedCellsRef.current.get(zoneKey)
      if (!zoneSet) {
        zoneSet = new Set<string>()
        visitedCellsRef.current.set(zoneKey, zoneSet)
      }

      let isCustomPoint = false
      let imageFile: File | null = pickRandomFolderImage()

      if (customTestPoint && !customPointTriggeredRef.current) {
        const zoneMatch = !customTestPoint.zoneId || customTestPoint.zoneId === drone.zoneId
        if (zoneMatch) {
          const dist = distanceMeters(drone.lat, drone.lng, customTestPoint.lat, customTestPoint.lng)
          if (dist <= CUSTOM_POINT_TRIGGER_METERS) {
            isCustomPoint = true
            customPointTriggeredRef.current = true
            imageFile = customImageFile ?? imageFile
          }
        }
      }

      // Normal captures are limited to once-per-cell; custom point capture overrides that guard.
      if (!isCustomPoint) {
        if (zoneSet.has(cellKey)) continue
        zoneSet.add(cellKey)
      } else {
        zoneSet.add(cellKey)
      }

      candidates.push({
        drone,
        lat: drone.lat,
        lng: drone.lng,
        zoneId: drone.zoneId,
        imageFile,
        isCustomPoint,
        cellKey,
      })
    }

    if (candidates.length === 0) return

    void (async () => {
      const payloadBatch: SimulatorDispatchPayload[] = []
      const generatedFrames: DroneFrame[] = []

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]
        const imageId = candidate.imageFile
          ? `${candidate.imageFile.name}-${candidate.imageFile.size}-${candidate.imageFile.lastModified}`
          : `placeholder-${now}-${i}`

        let imageBase64 = PLACEHOLDER_FRAME_IMAGE_BASE64
        if (candidate.imageFile) {
          try {
            imageBase64 = await fileToBase64Raw(candidate.imageFile)
          } catch {
            imageBase64 = PLACEHOLDER_FRAME_IMAGE_BASE64
          }
        }

        const payload: SimulatorDispatchPayload = {
          id: `PAY-${String(payloadCounterRef.current++).padStart(5, "0")}`,
          droneId: candidate.drone.id,
          zoneId: candidate.zoneId,
          imageId,
          lat: candidate.lat,
          lng: candidate.lng,
          createdAt: now,
        }

        sendDroneFrame(imageBase64, {
          lat: payload.lat,
          lng: payload.lng,
          source: "frontend_simulator",
          simulator_reason: reason,
          drone_speed_ms: speed,
          altitude_m: altitude,
          drone_id: payload.droneId,
          zone_id: payload.zoneId,
          image_id: payload.imageId,
          cell_key: candidate.cellKey,
          custom_point: candidate.isCustomPoint ? true : undefined,
        })

        payloadBatch.push(payload)

        generatedFrames.push({
          frame_id: `SIM-${String(frameCounterRef.current++).padStart(4, "0")}`,
          lat: payload.lat,
          lng: payload.lng,
          severity: 0,
          label: candidate.isCustomPoint ? "custom_test" : SIMULATION_LABELS[Math.floor(Math.random() * SIMULATION_LABELS.length)],
          receivedAt: now,
        })
      }

      setSimulatedFrames((prev) => [...generatedFrames, ...prev].slice(0, 500))
      setDispatchPayloads((prev) => [...payloadBatch, ...prev].slice(0, 300))
    })()
  }, [customImageFile, customTestPoint, droneAltitudeM, droneSpeedMs, fileToBase64Raw, pickRandomFolderImage, sendDroneFrame])

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
    const outerRadiusMeters = Math.max(15, draftCircle.radiusMeters - 5)
    const freshDrones: DeployedDrone[] = Array.from({ length: count }, (_, index) => {
      const angleOffset = (index / Math.max(1, count)) * Math.PI * 2
      const direction: 1 | -1 = index % 2 === 0 ? 1 : -1
      const startPos = pointOffset(draftCircle.centerLat, draftCircle.centerLng, outerRadiusMeters, direction * angleOffset)

      return {
        id: `DRONE-${String(droneCounterRef.current++).padStart(3, "0")}`,
        label: `Drone ${index + 1}`,
        zoneId,
        centerLat: draftCircle.centerLat,
        centerLng: draftCircle.centerLng,
        radiusMeters: draftCircle.radiusMeters,
        lat: startPos.lat,
        lng: startPos.lng,
        spiralProgressRad: 0,
        spiralAngleOffsetRad: angleOffset,
        spiralDirection: direction,
        spiralSpacingMeters: Number.isFinite(spiralSpacingMeters)
          ? Math.max(10, Math.min(200, spiralSpacingMeters))
          : DEFAULT_SPIRAL_SPACING_METERS,
        spiralOuterRadiusMeters: outerRadiusMeters,
        spiralCompleted: false,
        updatedAt: Date.now(),
      }
    })

    setCoverageCircles((prev) => [zone, ...prev].slice(0, 80))
    setDeployedDrones((prev) => [ ...freshDrones, ...prev ])
    queueCapturesForDrones(freshDrones, "deploy")
    setDraftCircle(null)
    setSimulationDrawMode(false)
  }, [draftCircle, dronesPerDeployment, queueCapturesForDrones, spiralSpacingMeters])

  const captureNow = useCallback(() => {
    if (deployedDrones.length === 0) return
    queueCapturesForDrones(deployedDrones, "manual")
  }, [deployedDrones, queueCapturesForDrones])

  const clearSimulator = useCallback(() => {
    setSimulationRunning(false)
    setSimulatedFrames([])
    setDispatchPayloads([])
    setCoverageCircles([])
    setDeployedDrones([])
    setDraftCircle(null)
    setSimulationDrawMode(false)
    setCustomPointMode(false)
    setCustomTestPoint(null)
    setCustomImageFile(null)
    customPointTriggeredRef.current = false
    visitedCellsRef.current.clear()
  }, [])

  useEffect(() => {
    if (!simulationRunning || deployedDrones.length === 0) return
    const tick = Math.max(500, simulationIntervalMs)

    const interval = setInterval(() => {
      const now = Date.now()
      const dt = tick / 1000

      setDeployedDrones((prev) => {
        if (prev.length === 0) return prev

        const speed = Number.isFinite(droneSpeedMs) ? Math.max(0, droneSpeedMs) : DEFAULT_DRONE_SPEED_MS

        const moved = prev.map((drone) => {
          if (drone.spiralCompleted) {
            return { ...drone, updatedAt: now }
          }

          const next = stepInwardSpiralConstantSpeed({
            centerLat: drone.centerLat,
            centerLng: drone.centerLng,
            outerRadiusMeters: drone.spiralOuterRadiusMeters,
            spacingMeters: drone.spiralSpacingMeters,
            progressRad: drone.spiralProgressRad,
            angleOffsetRad: drone.spiralAngleOffsetRad,
            direction: drone.spiralDirection,
            speedMs: speed,
            dtSeconds: dt,
          })

          return {
            ...drone,
            spiralProgressRad: next.nextProgressRad,
            spiralCompleted: next.completed,
            lat: next.lat,
            lng: next.lng,
            updatedAt: now,
          }
        })

        queueCapturesForDrones(moved, "tick")
        return moved
      })
    }, tick)

    return () => clearInterval(interval)
  }, [deployedDrones.length, droneSpeedMs, queueCapturesForDrones, simulationIntervalMs, simulationRunning])

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
        pickPointMode={activeView === "simulation" && customPointMode}
        coverageCircles={coverageCircles}
        deployedDrones={deployedDrones}
        circleDraft={draftCircle}
        customTestPoint={customTestPoint}
        onCircleDraftChange={setDraftCircle}
        onCircleDrawComplete={setDraftCircle}
        onPickPoint={(pt) => {
          setCustomTestPoint((prev) => {
            const next = { lat: pt.lat, lng: pt.lng } as { lat: number; lng: number; zoneId?: string }

            // Attempt to associate with the first zone that contains the point.
            for (const zone of coverageCircles) {
              const inside = distanceMeters(zone.centerLat, zone.centerLng, pt.lat, pt.lng) <= zone.radiusMeters
              if (inside) {
                next.zoneId = zone.id
                break
              }
            }

            return next
          })
          setCustomPointMode(false)
          customPointTriggeredRef.current = false
        }}
        onCancelDrawMode={() => setSimulationDrawMode(false)}
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
        droneSpeedMs={droneSpeedMs}
        onAutoPanChange={setAutoPan}
        onShowHeatmapChange={setShowHeatmap}
        onSimulationIntervalChange={(next) => setSimulationIntervalMs(Math.max(500, Math.min(10000, Number.isFinite(next) ? next : 2200)))}
        onDroneSpeedChange={(next) => setDroneSpeedMs(Math.max(0.5, Math.min(25, Number.isFinite(next) ? next : DEFAULT_DRONE_SPEED_MS)))}
        onMaxVisibleReportsChange={(next) => setMaxVisibleReports(Math.max(20, Math.min(300, Number.isFinite(next) ? next : 120)))}
        onResetSettings={() => {
          setAutoPan(true)
          setShowHeatmap(false)
          setSimulationIntervalMs(2200)
          setMaxVisibleReports(120)
          setDroneSpeedMs(DEFAULT_DRONE_SPEED_MS)
          setSpiralSpacingMeters(DEFAULT_SPIRAL_SPACING_METERS)
          setDroneAltitudeM(DEFAULT_DRONE_ALTITUDE_M)
        }}
        simulationRunning={simulationRunning}
        simulatedCount={simulatedFrames.length}
        onStartSimulation={() => setSimulationRunning(true)}
        onStopSimulation={() => setSimulationRunning(false)}
        onCaptureNow={captureNow}
        onClearSimulation={clearSimulator}
        drawMode={simulationDrawMode}
        onToggleDrawMode={() => {
          setSimulationDrawMode((prev) => !prev)
          setCustomPointMode(false)
        }}
        draftCircle={draftCircle}
        dronesPerDeployment={dronesPerDeployment}
        onDronesPerDeploymentChange={(next) => setDronesPerDeployment(Math.max(1, Math.min(8, Number.isFinite(next) ? next : 1)))}
        onDeployFromCircle={deployFromDraftCircle}
        deployedDrones={deployedDrones}
        deployedZones={coverageCircles.length}
        dispatchCount={dispatchPayloads.length}
        droneAltitudeM={droneAltitudeM}
        onDroneAltitudeChange={(next) => setDroneAltitudeM(Math.max(10, Math.min(1000, Number.isFinite(next) ? next : DEFAULT_DRONE_ALTITUDE_M)))}
        spiralSpacingMeters={spiralSpacingMeters}
        onSpiralSpacingChange={(next) => setSpiralSpacingMeters(Math.max(10, Math.min(200, Number.isFinite(next) ? next : DEFAULT_SPIRAL_SPACING_METERS)))}
        folderImageCount={folderImages.length}
        onSelectImageFolder={(fileList) => {
          const files = fileList ? Array.from(fileList) : []
          const images = files.filter((f) => f.type.startsWith("image/"))
          setFolderImages(images)
          base64CacheRef.current.clear()
        }}
        customPointMode={customPointMode}
        onToggleCustomPointMode={() => {
          setCustomPointMode((prev) => !prev)
          setSimulationDrawMode(false)
        }}
        customTestPoint={customTestPoint}
        onClearCustomTestPoint={() => {
          setCustomTestPoint(null)
          customPointTriggeredRef.current = false
        }}
        customImageSelected={!!customImageFile}
        onSelectCustomImage={(file) => {
          setCustomImageFile(file)
          if (file) base64CacheRef.current.clear()
        }}
      />

      {/* Layer 2: Bottom dock */}
      <BottomDock activeView={activeView} onSelect={setActiveView} />
    </main>
  )
}
