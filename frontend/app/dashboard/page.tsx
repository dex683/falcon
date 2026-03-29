"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DroneFrame } from "@/context/SocketContext"
import { useSocket } from "@/context/SocketContext"
import { toast } from "@/hooks/use-toast"
import { SeveritySidebar } from "@/components/severity-sidebar"
import { BottomDock, type DashboardView } from "@/components/bottom-dock"
import { SeverityCountsBar } from "@/components/severity-counts-bar"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"

import {
  areaCellKeyForLatLng,
  distanceMeters,
  generateLawnmowerWaypoints,
  isInsideCircleMeters,
  pointOffset,
  stepLawnmower,
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

const DEFAULT_DRONE_SPEED_MS = 25
const DEFAULT_SPIRAL_SPACING_METERS = 200
const DEFAULT_DRONE_ALTITUDE_M = 120
const ALTITUDE_COVERAGE_CELL_FACTOR = 0.6
const CUSTOM_POINT_TRIGGER_METERS = 20

// 1x1 transparent PNG (raw base64, no data URI prefix) — used as a tiny payload for backend integration.
const PLACEHOLDER_FRAME_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2yZ6QAAAAASUVORK5CYII="

export default function DashboardPage() {
  const {
    frames,
    latestFrame,
    status,
    frameCount,
    lastFrameAt,
    sendDroneFrame,
    socket,
    // Shared synced state
    syncedDrones,
    syncedZones,
    syncedSimRunning,
    // Sync emitters
    emitDeployDrones,
    emitUpdateDrones,
    emitRemoveDrones,
    emitSimControl,
    emitClearSimulation,
  } = useSocket()

  // ─── Backend ML Settings ────────────────────────────────────────────
  const backendBase = (process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5001").replace(/\/$/, "")
  const [useGemini, setUseGemini] = useState(false)
  const [geminiAvailable, setGeminiAvailable] = useState(false)
  const [activeModelName, setActiveModelName] = useState("")
  const [settingsLoading, setSettingsLoading] = useState(false)

  useEffect(() => {
    fetch(`${backendBase}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        setUseGemini(data.use_gemini ?? false)
        setGeminiAvailable(data.gemini_available ?? false)
        setActiveModelName(data.ml_model ?? "")
      })
      .catch(() => { /* backend offline — silently ignore */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeView, setActiveView] = useState<DashboardView>("map")
  const [autoPan, setAutoPan] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [show3dBuildings, setShow3dBuildings] = useState(true)
  const [simulationIntervalMs, setSimulationIntervalMs] = useState(250)
  const [maxVisibleReports, setMaxVisibleReports] = useState(120)
  const [droneSpeedMs, setDroneSpeedMs] = useState(DEFAULT_DRONE_SPEED_MS)
  const [droneAltitudeM, setDroneAltitudeM] = useState(DEFAULT_DRONE_ALTITUDE_M)
  const [heatmapRadius, setHeatmapRadius] = useState(44)
  const [heatmapIntensity, setHeatmapIntensity] = useState(3)

  // Load settings from localStorage once
  useEffect(() => {
    try {
      const stored = localStorage.getItem("skeem_dashboard_settings")
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.autoPan !== undefined) setAutoPan(parsed.autoPan)
        if (parsed.showHeatmap !== undefined) setShowHeatmap(parsed.showHeatmap)
        if (parsed.show3dBuildings !== undefined) setShow3dBuildings(parsed.show3dBuildings)
        if (parsed.simulationIntervalMs !== undefined) setSimulationIntervalMs(parsed.simulationIntervalMs)
        if (parsed.maxVisibleReports !== undefined) setMaxVisibleReports(parsed.maxVisibleReports)
        if (parsed.droneSpeedMs !== undefined) setDroneSpeedMs(parsed.droneSpeedMs)
        if (parsed.droneAltitudeM !== undefined) setDroneAltitudeM(parsed.droneAltitudeM)
        if (parsed.heatmapRadius !== undefined) setHeatmapRadius(parsed.heatmapRadius)
        if (parsed.heatmapIntensity !== undefined) setHeatmapIntensity(parsed.heatmapIntensity)
      }
    } catch {}
  }, [])

  // Save settings on change
  useEffect(() => {
    localStorage.setItem("skeem_dashboard_settings", JSON.stringify({
      autoPan, showHeatmap, show3dBuildings, simulationIntervalMs, maxVisibleReports,
      droneSpeedMs, droneAltitudeM, heatmapRadius, heatmapIntensity
    }))
  }, [autoPan, showHeatmap, show3dBuildings, simulationIntervalMs, maxVisibleReports, droneSpeedMs, droneAltitudeM, heatmapRadius, heatmapIntensity])

  // Local-only UI state (not shared) ─────────────────────────────────────
  const [simulatedFrames, setSimulatedFrames] = useState<DroneFrame[]>([])
  const [simulationDrawMode, setSimulationDrawMode] = useState(false)
  const [draftCircle, setDraftCircle] = useState<CircleDraft | null>(null)
  const [completedDrones, setCompletedDrones] = useState(0)
  const [dispatchPayloads, setDispatchPayloads] = useState<SimulatorDispatchPayload[]>([])
  const [dronesPerDeployment, setDronesPerDeployment] = useState(1)
  const [amISimulating, setAmISimulating] = useState(false)

  const [folderImages, setFolderImages] = useState<File[]>([])
  const [droneImageMap, setDroneImageMap] = useState<Record<string, string>>({})
  
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile)
      setVideoObjectUrl(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setVideoObjectUrl(null)
    }
  }, [videoFile])

  const [customPointMode, setCustomPointMode] = useState(false)
  const [customTestPoint, setCustomTestPoint] = useState<{ lat: number; lng: number; zoneId?: string } | null>(null)
  const [customImageFile, setCustomImageFile] = useState<File | null>(null)

  // Drone live stream state
  const [activeLiveStreamDroneId, setActiveLiveStreamDroneId] = useState<string | null>(null)

  // Feed viewer state
  const [feedVisible, setFeedVisible] = useState(true)
  const [feedFullscreen, setFeedFullscreen] = useState(false)

  // Draggable feed position
  const [feedPosition, setFeedPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 })
  const feedDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  // Use synced state as the authoritative source for drones & zones
  const deployedDrones = syncedDrones
  const coverageCircles = syncedZones
  const simulationRunning = syncedSimRunning

  const frameCounterRef = useRef(1)
  const zoneCounterRef = useRef(1)
  const droneCounterRef = useRef(1)
  const payloadCounterRef = useRef(1)
  // Tracks the last known count of synced drones to update local counters only once on connect
  const lastSyncedDroneCountRef = useRef(0)

  // Always-current ref for use inside the tick loop (avoids stale closures)
  const deployedDronesRef = useRef<DeployedDrone[]>([])
  useEffect(() => {
    deployedDronesRef.current = syncedDrones
  }, [syncedDrones])

  const visitedCellsRef = useRef(new Map<string, Set<string>>())
  const base64CacheRef = useRef(new Map<string, string>())
  const customPointTriggeredRef = useRef(false)

  // Keep local counters above the server-provided IDs so we never collide
  useEffect(() => {
    if (syncedDrones.length > lastSyncedDroneCountRef.current) {
      // extract highest drone number seen and push counter past it
      for (const d of syncedDrones) {
        const match = d.id.match(/DRONE-(\d+)/)
        if (match) {
          const n = parseInt(match[1], 10)
          if (n >= droneCounterRef.current) droneCounterRef.current = n + 1
        }
      }
      for (const z of syncedZones) {
        const match = z.id.match(/ZONE-(\d+)/)
        if (match) {
          const n = parseInt(match[1], 10)
          if (n >= zoneCounterRef.current) zoneCounterRef.current = n + 1
        }
      }
      lastSyncedDroneCountRef.current = syncedDrones.length
    }
  }, [syncedDrones, syncedZones])

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
      videoFrameBase64: string | null
      isCustomPoint: boolean
      cellKey: string
    }

    const candidates: Candidate[] = []

    for (const drone of sourceDrones) {
      if (drone.pathCompleted) continue
      if (!isInsideCircleMeters(drone.centerLat, drone.centerLng, drone.radiusMeters, drone.lat, drone.lng)) continue

      const altitudeCell = altitude * ALTITUDE_COVERAGE_CELL_FACTOR
      const effectiveCellSize = Math.max(8, altitudeCell)
      const cellKey = areaCellKeyForLatLng(drone.centerLat, drone.centerLng, drone.lat, drone.lng, effectiveCellSize)
      const zoneKey = drone.zoneId

      let zoneSet = visitedCellsRef.current.get(zoneKey)
      if (!zoneSet) {
        zoneSet = new Set<string>()
        visitedCellsRef.current.set(zoneKey, zoneSet)
      }

      let isCustomPoint = false
      let imageFile: File | null = pickRandomFolderImage()
      let videoFrameBase64: string | null = null

      if (videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current
        const canvas = document.createElement("canvas")
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7)
          videoFrameBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl
        }
      }

      if (customTestPoint && !customPointTriggeredRef.current) {
        const zoneMatch = !customTestPoint.zoneId || customTestPoint.zoneId === drone.zoneId
        if (zoneMatch) {
          const dist = distanceMeters(drone.lat, drone.lng, customTestPoint.lat, customTestPoint.lng)
          if (dist <= CUSTOM_POINT_TRIGGER_METERS) {
            isCustomPoint = true
            customPointTriggeredRef.current = true
            imageFile = customImageFile ?? imageFile
            toast({
              title: "📍 Test point triggered!",
              description: `${drone.id} reached the custom point (${dist.toFixed(0)}m away). Using test image for prediction.`,
            })
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
        videoFrameBase64,
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
        const imageId = candidate.videoFrameBase64
          ? `vid-${now}-${i}`
          : candidate.imageFile
          ? `${candidate.imageFile.name}-${candidate.imageFile.size}-${candidate.imageFile.lastModified}`
          : `placeholder-${now}-${i}`

        let imageBase64 = PLACEHOLDER_FRAME_IMAGE_BASE64
        if (candidate.videoFrameBase64) {
          imageBase64 = candidate.videoFrameBase64
        } else if (candidate.imageFile) {
          try {
            imageBase64 = await fileToBase64Raw(candidate.imageFile)
            setDroneImageMap((prev) => ({ ...prev, [candidate.drone.id]: imageBase64 }))
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
          frame_id: payload.imageId,
          lat: payload.lat,
          lng: payload.lng,
          severity: 0,
          label: candidate.isCustomPoint ? "custom_test" : "processing",
          receivedAt: now,
          status: "processing"
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

    setDraftCircle(null)
    setSimulationDrawMode(false)

    // Pre-compute lawnmower waypoints for the zone (shared by all drones in this zone)
    const zoneWaypoints = generateLawnmowerWaypoints(
      zone.centerLat,
      zone.centerLng,
      zone.radiusMeters,
    )

    const count = Math.max(1, Math.min(8, dronesPerDeployment))
    const freshDrones: DeployedDrone[] = Array.from({ length: count }, (_, index) => {
      // Each drone starts at a different strip to spread coverage
      const startWaypointIndex = Math.floor((index / Math.max(1, count)) * Math.max(0, zoneWaypoints.length - 1))
      const startWaypoint = zoneWaypoints[startWaypointIndex] ?? zoneWaypoints[0]

      return {
        id: `DRONE-${String(droneCounterRef.current++).padStart(3, "0")}`,
        label: `Drone ${index + 1}`,
        zoneId,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusMeters: zone.radiusMeters,
        lat: startWaypoint ? startWaypoint[0] : zone.centerLat,
        lng: startWaypoint ? startWaypoint[1] : zone.centerLng,
        waypoints: zoneWaypoints,
        waypointIndex: startWaypointIndex,
        waypointProgressMeters: 0,
        pathCompleted: false,
        updatedAt: Date.now(),
      }
    })

    // Broadcast to all clients via server
    emitDeployDrones(freshDrones, zone)
  }, [draftCircle, dronesPerDeployment, emitDeployDrones])

  const captureNow = useCallback(() => {
    if (deployedDrones.length === 0) return
    queueCapturesForDrones(deployedDrones, "manual")
  }, [deployedDrones, queueCapturesForDrones])

  const clearSimulator = useCallback(() => {
    // Broadcast clear to all clients, server will update shared_state
    emitClearSimulation()
    // Reset local-only state
    setAmISimulating(false)
    setSimulatedFrames([])
    setDispatchPayloads([])
    setCompletedDrones(0)
    setDraftCircle(null)
    setSimulationDrawMode(false)
    setCustomPointMode(false)
    setCustomTestPoint(null)
    setCustomImageFile(null)
    customPointTriggeredRef.current = false
    visitedCellsRef.current.clear()
  }, [emitClearSimulation])

  const sendTestImage = useCallback(() => {
    if (!customImageFile) return

    const fallbackLat = 28.6139
    const fallbackLng = 77.209

    const lat = customTestPoint?.lat ?? deployedDrones[0]?.lat ?? fallbackLat
    const lng = customTestPoint?.lng ?? deployedDrones[0]?.lng ?? fallbackLng

    void (async () => {
      let imageBase64 = PLACEHOLDER_FRAME_IMAGE_BASE64
      try {
        imageBase64 = await fileToBase64Raw(customImageFile)
      } catch {
        imageBase64 = PLACEHOLDER_FRAME_IMAGE_BASE64
      }

      sendDroneFrame(imageBase64, {
        lat,
        lng,
        source: "manual_upload",
        filename: customImageFile.name,
        size: customImageFile.size,
        zone_id: customTestPoint?.zoneId,
      })

      toast({
        title: "Test image sent",
        description: "Waiting for processed severity…",
      })
    })()
  }, [customImageFile, customTestPoint?.lat, customTestPoint?.lng, customTestPoint?.zoneId, deployedDrones, fileToBase64Raw, sendDroneFrame])

  // ─── Simulation Tick ────────────────────────────────────────────────────
  // Only the client that actually clicked "Start" will run the loop, avoiding multi-tab speedups
  useEffect(() => {
    if (!amISimulating || !simulationRunning || deployedDrones.length === 0) return
    const tick = Math.max(500, simulationIntervalMs)

    const interval = setInterval(() => {
      // Read current positions through ref to avoid stale closure
      const currentDrones = deployedDronesRef.current
      if (currentDrones.length === 0) return

      const now = Date.now()
      const dt = tick / 1000
      const speed = Number.isFinite(droneSpeedMs) ? Math.max(0, droneSpeedMs) : DEFAULT_DRONE_SPEED_MS

      // Compute next positions from the current synced list
      let completedNow = 0
      const removedIds: string[] = []
      const moved: DeployedDrone[] = []

      for (const drone of currentDrones) {
        if (drone.pathCompleted) {
          completedNow += 1
          removedIds.push(drone.id)
          continue
        }

        const next = stepLawnmower({
          drone,
          speedMs: speed,
          dtSeconds: dt,
        })

        if (next.completed) {
          completedNow += 1
          removedIds.push(drone.id)
          continue
        }

        moved.push({
          ...drone,
          waypointIndex: next.waypointIndex,
          waypointProgressMeters: next.waypointProgressMeters,
          pathCompleted: false,
          lat: next.lat,
          lng: next.lng,
          updatedAt: now,
        })
      }

      if (completedNow > 0) {
        setCompletedDrones((count) => count + completedNow)
        if (removedIds.length > 0) emitRemoveDrones(removedIds)
      }

      if (moved.length > 0) {
        emitUpdateDrones(moved)
        queueCapturesForDrones(moved, "tick")
      }

      // If all drones finished, stop simulation
      if (moved.length === 0 && currentDrones.length > 0) {
        setAmISimulating(false)
        emitSimControl(false)
      }
    }, tick)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amISimulating, simulationRunning, deployedDrones.length, droneSpeedMs, simulationIntervalMs])

  // Only show backend-processed frames on the map/severity list.
  const combinedFrames = useMemo(() => {
    const backendIds = new Set(frames.map(f => f.frame_id))
    const pendingSimulated = simulatedFrames.filter(f => !backendIds.has(f.frame_id))
    return [...frames, ...pendingSimulated].sort((a, b) => b.receivedAt - a.receivedAt)
  }, [frames, simulatedFrames])

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

  // ─── Socket: settings_changed sync (multi-tab) ──────────────────────
  useEffect(() => {
    if (!socket) return
    const handler = (data: { use_gemini: boolean; gemini_available: boolean; ml_model: string }) => {
      setUseGemini(data.use_gemini)
      setGeminiAvailable(data.gemini_available)
      setActiveModelName(data.ml_model)
    }
    socket.on("settings_changed", handler)
    return () => { socket.off("settings_changed", handler) }
  }, [socket])

  const handleUseGeminiChange = useCallback(async (next: boolean) => {
    setSettingsLoading(true)
    try {
      const res = await fetch(`${backendBase}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_gemini: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Model switch failed", description: data.error ?? "Unknown error", variant: "destructive" })
      } else {
        setUseGemini(data.use_gemini)
        setGeminiAvailable(data.gemini_available)
        setActiveModelName(data.ml_model)
        toast({
          title: data.use_gemini ? "Gemini Vision enabled" : "Custom ML enabled",
          description: data.ml_model,
        })
      }
    } catch {
      toast({ title: "Model switch failed", description: "Could not reach backend.", variant: "destructive" })
    } finally {
      setSettingsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendBase])

  const statusDotColor =
    status === "connected"
      ? "bg-[oklch(0.72_0.19_142)]"
      : status === "disconnected" || status === "error"
        ? "bg-[oklch(0.62_0.23_25)]"
        : "bg-[oklch(0.55_0_0)]"

    const simulatorStatusText = simulationRunning
      ? (deployedDrones.length > 0 ? "Running" : "Completed")
      : (deployedDrones.length > 0 ? "Paused" : (completedDrones > 0 ? "Completed" : "Stopped"))

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[oklch(0.10_0_0)]">
      {/* Top-right: severity counts + status */}
      <div className="fixed right-4 top-4 z-40 flex items-center gap-2">
        {/* Severity counts */}
        <SeverityCountsBar
          frames={combinedFrames}
          deployedZones={coverageCircles}
        />

        {/* Divider */}
        <div className="h-6 w-px bg-border/40" />

        {/* Status badge */}
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
        show3dBuildings={show3dBuildings}
        heatmapRadius={heatmapRadius}
        heatmapIntensity={heatmapIntensity}
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
        show3dBuildings={show3dBuildings}
        simulationIntervalMs={simulationIntervalMs}
        droneSpeedMs={droneSpeedMs}
        onAutoPanChange={setAutoPan}
        onShowHeatmapChange={setShowHeatmap}
        onShow3dBuildingsChange={setShow3dBuildings}
        onSimulationIntervalChange={(next) => setSimulationIntervalMs(Math.max(500, Math.min(10000, Number.isFinite(next) ? next : 2200)))}
        onDroneSpeedChange={(next) => setDroneSpeedMs(Math.max(0.5, Math.min(50, Number.isFinite(next) ? next : DEFAULT_DRONE_SPEED_MS)))}
        onMaxVisibleReportsChange={(next) => setMaxVisibleReports(Math.max(20, Math.min(300, Number.isFinite(next) ? next : 120)))}
        heatmapRadius={heatmapRadius}
        heatmapIntensity={heatmapIntensity}
        onHeatmapRadiusChange={(next) => setHeatmapRadius(Math.max(5, Math.min(200, Number.isFinite(next) ? next : 44)))}
        onHeatmapIntensityChange={(next) => setHeatmapIntensity(Math.max(0.1, Math.min(20, Number.isFinite(next) ? next : 3)))}
        onResetSettings={() => {
          setAutoPan(true)
          setShowHeatmap(false)
          setShow3dBuildings(true)
          setSimulationIntervalMs(250)
          setMaxVisibleReports(120)
          setDroneSpeedMs(DEFAULT_DRONE_SPEED_MS)
          setDroneAltitudeM(DEFAULT_DRONE_ALTITUDE_M)
          setHeatmapRadius(44)
          setHeatmapIntensity(3)
        }}
        simulationRunning={simulationRunning}
        simulatedCount={simulatedFrames.length}
        onStartSimulation={() => {
          setAmISimulating(true)
          emitSimControl(true)
        }}
        onStopSimulation={() => {
          setAmISimulating(false)
          emitSimControl(false)
        }}
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
        completedDrones={completedDrones}
        simulatorStatusText={simulatorStatusText}
        deployedZones={coverageCircles}
        dispatchCount={dispatchPayloads.length}
        droneAltitudeM={droneAltitudeM}
        onDroneAltitudeChange={(next) => setDroneAltitudeM(Math.max(10, Math.min(1000, Number.isFinite(next) ? next : DEFAULT_DRONE_ALTITUDE_M)))}
        folderImageCount={folderImages.length}
        onSelectImageFolder={(fileList) => {
          const files = fileList ? Array.from(fileList) : []
          const images = files.filter((f) => f.type.startsWith("image/"))
          setFolderImages(images)
          setDroneImageMap({})
          base64CacheRef.current.clear()
        }}
        videoFile={videoFile}
        onSelectVideo={setVideoFile}
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
        onSendTestImage={sendTestImage}
        useGemini={useGemini}
        geminiAvailable={geminiAvailable}
        activeModelName={activeModelName}
        settingsLoading={settingsLoading}
        onUseGeminiChange={handleUseGeminiChange}
        activeLiveStreamDroneId={activeLiveStreamDroneId}
        onViewDroneLiveStream={(droneId) => {
          setActiveLiveStreamDroneId(droneId)
          if (droneId) {
            setFeedVisible(true)
            setFeedFullscreen(false)
            setFeedPosition({ x: -1, y: -1 })
          }
        }}
        feedVisible={feedVisible}
        onToggleFeedVisible={() => setFeedVisible((v) => !v)}
      />

      {/* Layer 2: Bottom dock */}
      <BottomDock activeView={activeView} onSelect={(view) => {
        if (view === activeView) {
          // Toggle sidebar if clicking the same view
          setSidebarOpen((prev) => !prev)
        } else {
          // Switch view and ensure sidebar is open
          setActiveView(view)
          setSidebarOpen(true)
        }
      }} />

      {/* Unified Floating Feed — Draggable + Fullscreen + Closeable */}
      {feedVisible && activeLiveStreamDroneId && simulationRunning && (videoObjectUrl || droneImageMap[activeLiveStreamDroneId]) && (
        <div
          className={cn(
            "absolute z-50 overflow-hidden rounded-xl border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.12_0_0/80%)] shadow-2xl backdrop-blur-sm transition-all duration-300 hover:shadow-[0_0_30px_oklch(0.55_0.18_260/20%)]",
            feedFullscreen
              ? "inset-0 rounded-none"
              : "cursor-grab active:cursor-grabbing"
          )}
          style={feedFullscreen ? {} : {
            left: feedPosition.x >= 0 ? feedPosition.x : undefined,
            top: feedPosition.y >= 0 ? feedPosition.y : undefined,
            right: feedPosition.x < 0 ? 24 : undefined,
            bottom: feedPosition.y < 0 ? 24 : undefined,
          }}
          onMouseDown={feedFullscreen ? undefined : (e) => {
            // Don't drag when clicking buttons
            if ((e.target as HTMLElement).closest('button')) return
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            feedDragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startPosX: rect.left,
              startPosY: rect.top,
            }
            const onMouseMove = (ev: MouseEvent) => {
              if (!feedDragRef.current) return
              const dx = ev.clientX - feedDragRef.current.startX
              const dy = ev.clientY - feedDragRef.current.startY
              setFeedPosition({
                x: feedDragRef.current.startPosX + dx,
                y: feedDragRef.current.startPosY + dy,
              })
            }
            const onMouseUp = () => {
              feedDragRef.current = null
              document.removeEventListener('mousemove', onMouseMove)
              document.removeEventListener('mouseup', onMouseUp)
            }
            document.addEventListener('mousemove', onMouseMove)
            document.addEventListener('mouseup', onMouseUp)
          }}
        >
          {/* Title bar */}
          <div className="flex items-center justify-between bg-[oklch(0.18_0_0/50%)] px-3 py-1.5 text-xs font-medium text-[oklch(0.85_0_0)] select-none">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              <span>Live Feed{activeLiveStreamDroneId ? `: ${activeLiveStreamDroneId}` : ''}</span>
            </div>
            <div className="flex items-center gap-1">
              {/* Fullscreen toggle */}
              <button
                onClick={() => {
                  setFeedFullscreen((v) => !v)
                  if (!feedFullscreen) setFeedPosition({ x: -1, y: -1 })
                }}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-[oklch(1_0_0/10%)] transition-colors"
                aria-label={feedFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {feedFullscreen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                )}
              </button>
              {/* Close button */}
              <button
                onClick={() => setFeedVisible(false)}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-[oklch(1_0_0/10%)] transition-colors"
                aria-label="Close feed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          {/* Content */}
          {videoObjectUrl ? (
            <video
              ref={videoRef}
              src={videoObjectUrl}
              className={feedFullscreen ? "w-full h-[calc(100%-32px)] object-contain bg-black" : "w-80 object-cover"}
              autoPlay
              muted
              loop
              playsInline
            />
          ) : droneImageMap[activeLiveStreamDroneId!] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={droneImageMap[activeLiveStreamDroneId!].startsWith("data:") ? droneImageMap[activeLiveStreamDroneId!] : `data:image/jpeg;base64,${droneImageMap[activeLiveStreamDroneId!]}`}
              alt="Current Drone View"
              className={feedFullscreen ? "w-full h-[calc(100%-32px)] object-contain bg-black" : "w-80 object-cover"}
            />
          ) : null}
        </div>
      )}
    </main>
  )
}
