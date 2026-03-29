"use client"

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react"
import MapGL, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import type { MapLibreEvent } from "maplibre-gl"
import { Plane, Maximize2, X } from "lucide-react"
import type { DroneFrame } from "@/context/SocketContext"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import { SeverityBadge } from "@/components/severity-badge"
import {
  buildCircleFeature,
  buildCoverageCollection,
  distanceMeters,
  type CircleDraft,
  type CoverageCircle,
  type DeployedDrone,
} from "@/lib/simulator"
import type { PriorityLocation } from "@/lib/pdf-report"
import "maplibre-gl/dist/maplibre-gl.css"

const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright"

function isGoodFrame(frame: DroneFrame) {
  const normalizedLabel = (frame.label ?? "").trim().toLowerCase()
  return normalizedLabel === "good" || normalizedLabel === "no_damage" || frame.severity <= 1.2
}

function formatDistance(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return "0 m"
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${Math.round(meters)} m`
}

function formatArea(areaSquareMeters: number) {
  if (!Number.isFinite(areaSquareMeters) || areaSquareMeters < 0) return "0 m²"
  if (areaSquareMeters >= 1_000_000) return `${(areaSquareMeters / 1_000_000).toFixed(2)} km²`
  return `${Math.round(areaSquareMeters)} m²`
}

interface LiveMapProps {
  frames: DroneFrame[]
  latestFrame: DroneFrame | null
  autoPan: boolean
  showHeatmap: boolean
  show3dBuildings: boolean
  heatmapRadius: number
  heatmapIntensity: number
  drawMode: boolean
  pickPointMode: boolean
  coverageCircles: CoverageCircle[]
  deployedDrones: DeployedDrone[]
  circleDraft: CircleDraft | null
  customTestPoint: { lat: number; lng: number } | null
  priorityHighlight?: PriorityLocation | null
  onCircleDraftChange: (draft: CircleDraft | null) => void
  onCircleDrawComplete: (draft: CircleDraft) => void
  onPickPoint: (pt: { lat: number; lng: number }) => void
  onCancelDrawMode: () => void
}

export interface LiveMapRef {
  getScreenshot: () => string | null
}

interface PopupInfo {
  frame: DroneFrame
}

export const LiveMap = forwardRef<LiveMapRef, LiveMapProps>(function LiveMap({
  frames,
  latestFrame,
  autoPan,
  showHeatmap,
  show3dBuildings,
  heatmapRadius,
  heatmapIntensity,
  drawMode,
  pickPointMode,
  coverageCircles,
  deployedDrones,
  circleDraft,
  customTestPoint,
  priorityHighlight,
  onCircleDraftChange,
  onCircleDrawComplete,
  onPickPoint,
  onCancelDrawMode,
}: LiveMapProps, ref: React.Ref<LiveMapRef>) {
  const mapRef = useRef<MapRef>(null)

  useImperativeHandle(ref, () => ({
    getScreenshot: () => {
      if (!mapRef.current) return null
      const canvas = mapRef.current.getCanvas()
      return canvas ? canvas.toDataURL("image/png") : null
    }
  }), [])
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null)
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [drawStart, setDrawStart] = useState<{ lat: number; lng: number } | null>(null)
  const [drawHover, setDrawHover] = useState<{ lat: number; lng: number; radiusMeters: number } | null>(null)
  const [animatedDronePositions, setAnimatedDronePositions] = useState<Record<string, { lat: number; lng: number }>>({})

  useEffect(() => {
    // Seed positions for new drones and remove stale ones.
    setAnimatedDronePositions((prev) => {
      const next: Record<string, { lat: number; lng: number }> = {}
      for (const drone of deployedDrones) {
        next[drone.id] = prev[drone.id] ?? { lat: drone.lat, lng: drone.lng }
      }
      return next
    })
  }, [deployedDrones])

  useEffect(() => {
    if (deployedDrones.length === 0) return

    let rafId = 0
    let lastTs: number | null = null

    const targetById = new Map(
      deployedDrones.map((drone) => [drone.id, { lat: drone.lat, lng: drone.lng }])
    )

    const step = (ts: number) => {
      const dt = lastTs == null ? 1 / 60 : Math.max(0.001, (ts - lastTs) / 1000)
      lastTs = ts

      // Exponential smoothing gives fluid movement independent of tick interval.
      const alpha = 1 - Math.exp(-10 * dt)

      setAnimatedDronePositions((prev) => {
        const next: Record<string, { lat: number; lng: number }> = {}

        for (const drone of deployedDrones) {
          const current = prev[drone.id] ?? { lat: drone.lat, lng: drone.lng }
          const target = targetById.get(drone.id) ?? { lat: drone.lat, lng: drone.lng }

          const latDelta = target.lat - current.lat
          const lngDelta = target.lng - current.lng
          const closeEnough = Math.abs(latDelta) < 0.000002 && Math.abs(lngDelta) < 0.000002

          next[drone.id] = closeEnough
            ? target
            : {
                lat: current.lat + latDelta * alpha,
                lng: current.lng + lngDelta * alpha,
              }
        }

        return next
      })

      rafId = window.requestAnimationFrame(step)
    }

    rafId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafId)
  }, [deployedDrones])

  useEffect(() => {
    if (!drawMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setDrawStart(null)
      setDrawHover(null)
      onCircleDraftChange(null)
      onCancelDrawMode()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [drawMode, onCancelDrawMode, onCircleDraftChange])

  useEffect(() => {
    if (!popupInfo) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        setPopupInfo(null)
        return
      }

      // Ignore clicks inside the popup itself.
      if (target.closest(".maplibregl-popup")) return

      // Ignore clicks on severity markers (they manage popup open state).
      if (target.closest("[data-severity-marker='true']")) return

      setPopupInfo(null)
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [popupInfo])

  const draftGeoJson = useMemo(() => {
    if (!circleDraft || circleDraft.radiusMeters < 10) return null
    return {
      type: "FeatureCollection" as const,
      features: [buildCircleFeature(circleDraft)],
    }
  }, [circleDraft])

  const coverageGeoJson = useMemo(() => buildCoverageCollection(coverageCircles), [coverageCircles])

  // Deduplicate frames by frame_id — keep the newest occurrence (frames are newest-first)
  const uniqueFrames = useMemo(() => {
    const out: DroneFrame[] = []
    const seen = new Set<string>()
    for (const frame of frames) {
      if (seen.has(frame.frame_id)) continue
      seen.add(frame.frame_id)
      out.push(frame)
    }
    return out
  }, [frames])

  const heatmapGeoJson = useMemo(() => {
    if (!showHeatmap || uniqueFrames.length === 0) return null

    const eligible = uniqueFrames.filter((frame) => !isGoodFrame(frame))

    const points = eligible.slice(0, 500).map((frame) => {
      const normalizedSeverity = Number.isFinite(frame.severity)
        ? Math.max(0, Math.min(1, frame.severity / 10))
        : 0

      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [frame.lng, frame.lat] as [number, number],
        },
        properties: {
          weight: normalizedSeverity,
        },
      }
    })

    return {
      type: "FeatureCollection" as const,
      features: points,
    }
  }, [showHeatmap, uniqueFrames])

  // Auto-pan to latest frame only if it falls outside the current viewport
  useEffect(() => {
    if (!autoPan || !latestFrame || !mapRef.current || !mapLoaded) return
    const map = mapRef.current.getMap()
    const bounds = map.getBounds()
    const inView = bounds.contains([latestFrame.lng, latestFrame.lat])
    if (!inView) {
      map.easeTo({
        center: [latestFrame.lng, latestFrame.lat],
        duration: 800,
        easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
      })
    }
  }, [autoPan, latestFrame, mapLoaded])

  const handleMapLoad = useCallback((e: MapLibreEvent) => {
    setMapLoaded(true)
  }, [])

  // 3D Buildings Layer Toggle
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current.getMap()
    const layerId = "3d-buildings"

    if (show3dBuildings) {
      if (!map.getLayer(layerId)) {
        const labelLayerId = map
          .getStyle()
          .layers.find((l) => l.type === "symbol" && (l.layout as Record<string, unknown>)?.["text-field"])?.id

        if (map.getSource("openmaptiles") || map.getSource("maptiler_planet")) {
          const sourceId = map.getSource("openmaptiles") ? "openmaptiles" : "maptiler_planet"
          map.addLayer(
            {
              id: layerId,
              source: sourceId,
              "source-layer": "building",
              type: "fill-extrusion",
              minzoom: 14,
              paint: {
                "fill-extrusion-color": "#1a1a2e",
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.5, ["get", "render_height"]],
                "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.5, ["get", "render_min_height"]],
                "fill-extrusion-opacity": 0.7,
              },
            },
            labelLayerId
          )
        }
      }
    } else {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId)
      }
    }
  }, [show3dBuildings, mapLoaded])


  const handleMapClick = useCallback((event: { lngLat: { lat: number; lng: number } }) => {
    if (pickPointMode) {
      onPickPoint({ lat: event.lngLat.lat, lng: event.lngLat.lng })
      return
    }
    if (!drawMode) return
    const { lat, lng } = event.lngLat

    if (!drawStart) {
      setDrawStart({ lat, lng })
      onCircleDraftChange({ centerLat: lat, centerLng: lng, radiusMeters: 40 })
      setDrawHover({ lat, lng, radiusMeters: 40 })
      return
    }

    const radiusMeters = distanceMeters(drawStart.lat, drawStart.lng, lat, lng)
    if (radiusMeters < 25) {
      setDrawStart(null)
      setDrawHover(null)
      onCircleDraftChange(null)
      return
    }

    const draft = {
      centerLat: drawStart.lat,
      centerLng: drawStart.lng,
      radiusMeters,
    }

    onCircleDrawComplete(draft)
    setDrawStart(null)
    setDrawHover(null)
  }, [drawMode, drawStart, onCircleDraftChange, onCircleDrawComplete, onPickPoint, pickPointMode])

  const handleMapMove = useCallback((event: { lngLat: { lat: number; lng: number } }) => {
    if (!drawMode || !drawStart) return
    const { lat, lng } = event.lngLat
    const radiusMeters = distanceMeters(drawStart.lat, drawStart.lng, lat, lng)
    setDrawHover({ lat, lng, radiusMeters })
    onCircleDraftChange({
      centerLat: drawStart.lat,
      centerLng: drawStart.lng,
      radiusMeters,
    })
  }, [drawMode, drawStart, onCircleDraftChange])

  useEffect(() => {
    if (drawMode) return
    setDrawStart(null)
    setDrawHover(null)
  }, [drawMode])

  return (
    <div className={`fixed inset-0 ${enlargedImage ? 'z-[9999]' : 'z-0'}`}>
      <MapGL
        ref={mapRef}
        initialViewState={{
          longitude: 77.209,
          latitude: 28.6139,
          zoom: 12,
          pitch: 45,
          bearing: -17.6,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAP_STYLE}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
        onMouseMove={handleMapMove}
        attributionControl={false}
        cursor={drawMode || pickPointMode ? "crosshair" : "grab"}
        reuseMaps
      >
        <NavigationControl position="bottom-right" style={{ bottom: "96px", right: "16px" }} />

        {heatmapGeoJson ? (
          <Source id="severity-heatmap" type="geojson" data={heatmapGeoJson}>
            <Layer
              id="severity-heatmap-layer"
              type="heatmap"
              paint={{
                "heatmap-weight": ["get", "weight"],
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, heatmapIntensity / 3, 15, heatmapIntensity],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, heatmapRadius * 0.4, 15, heatmapRadius],
                "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 0.55, 18, 0.35],
                "heatmap-color": [
                  "interpolate",
                  ["linear"],
                  ["heatmap-density"],
                  0,
                  "rgba(0,0,0,0)",
                  0.35,
                  SEVERITY_CONFIG.low.hex,
                  0.65,
                  SEVERITY_CONFIG.moderate.hex,
                  0.9,
                  SEVERITY_CONFIG.severe.hex,
                ],
              }}
            />
          </Source>
        ) : null}

        <Source id="coverage-zones" type="geojson" data={coverageGeoJson}>
          <Layer
            id="coverage-fill"
            type="fill"
            paint={{
              "fill-color": "#695cff",
              "fill-opacity": 0.09,
            }}
          />
          <Layer
            id="coverage-outline"
            type="line"
            paint={{
              "line-color": "#695cff",
              "line-width": 2,
              "line-opacity": 0.75,
            }}
          />
        </Source>

        {draftGeoJson ? (
          <Source id="draft-zone" type="geojson" data={draftGeoJson}>
            <Layer
              id="draft-fill"
              type="fill"
              paint={{
                "fill-color": "#30D158",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="draft-outline"
              type="line"
              paint={{
                "line-color": "#30D158",
                "line-width": 2,
                "line-dasharray": [2, 1],
              }}
            />
          </Source>
        ) : null}

        {drawMode && drawStart && drawHover ? (
          <Marker longitude={drawHover.lng} latitude={drawHover.lat} anchor="bottom">
            <div className="-translate-y-2 rounded-full border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/88%)] px-2.5 py-1 text-[11px] font-mono tabular-nums text-[oklch(0.92_0_0)] shadow-lg backdrop-blur-xl">
              r={formatDistance(drawHover.radiusMeters)} • A={formatArea(Math.PI * drawHover.radiusMeters * drawHover.radiusMeters)}
            </div>
          </Marker>
        ) : null}

        {deployedDrones.map((drone) => {
          const animated = animatedDronePositions[drone.id]
          const lat = animated?.lat ?? drone.lat
          const lng = animated?.lng ?? drone.lng

          return (
          <Marker
            key={drone.id}
            longitude={lng}
            latitude={lat}
            anchor="center"
          >
            <div className="relative flex items-center justify-center">
              <span className="absolute h-8 w-8 rounded-full bg-[#695cff]/22 blur-[1px]" />
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[#695cff]/70 bg-[#695cff]/92 shadow-lg">
                <Plane className="h-3.5 w-3.5 rotate-45 text-white" strokeWidth={2.25} />
              </span>
            </div>
          </Marker>
          )
        })}

        {customTestPoint ? (
          <Marker longitude={customTestPoint.lng} latitude={customTestPoint.lat} anchor="center">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-8 w-8 rounded-full bg-[oklch(0.62_0.23_25/25%)] blur-[2px]" />
              <span className="relative block h-3.5 w-3.5 rounded-full border border-[oklch(0.95_0_0/80%)] bg-[oklch(0.62_0.23_25)]" />
            </div>
          </Marker>
        ) : null}

        {uniqueFrames.map((frame) => {
          const isProcessing = frame.status === "processing"
          const isGood = isGoodFrame(frame)
          const level = getSeverityLevel(frame.severity)
          const config = SEVERITY_CONFIG[level]
          const isSevere = level === "severe"
          const isLatest = latestFrame?.frame_id === frame.frame_id

          return (
            <Marker
              key={`${frame.frame_id}-marker`}
              longitude={frame.lng}
              latitude={frame.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation()
                setPopupInfo({ frame })
              }}
            >
              <button
                className="group relative cursor-pointer focus:outline-none"
                aria-label={isProcessing ? "Processing..." : `${frame.label} severity ${frame.severity}`}
                data-severity-marker="true"
              >
                {isProcessing ? (
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[oklch(0.6_0_0)] opacity-40"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[oklch(0.5_0_0)]"></span>
                  </span>
                ) : (
                  <>
                    {/* Outer ring for severe markers */}
                    {isSevere && !isGood && (
                      <span
                        className="absolute inset-0 -m-1.5 rounded-full opacity-40 severity-pulse"
                        style={{ backgroundColor: config.color, filter: "blur(4px)" }}
                      />
                    )}
                    <span
                      className={
                        isGood
                          ? "relative block h-3 w-3 rounded-full border border-[oklch(0.98_0_0/85%)] bg-[#3b82f6] opacity-95 shadow-[0_0_0_1px_oklch(0.1_0_0/20%)]"
                          : `relative block h-4 w-4 rounded-full border-2 border-[oklch(0.10_0_0/50%)] marker-fade-in shadow-lg transition-transform duration-150 group-hover:scale-125 ${isLatest && isSevere ? "severity-pulse" : ""}`
                      }
                      style={isGood ? undefined : { backgroundColor: config.color }}
                    />
                  </>
                )}
              </button>
            </Marker>
          )
        })}

        {popupInfo && (
          <Popup
            longitude={popupInfo.frame.lng}
            latitude={popupInfo.frame.lat}
            anchor="bottom"
            offset={12}
            closeOnClick={false}
            onClose={() => setPopupInfo(null)}
          >
            <div className="w-60 rounded-xl border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/92%)] p-3 backdrop-blur-xl">
              <div className="mb-3 flex items-start justify-between gap-2">
                <span className="text-[11px] font-mono text-[oklch(0.45_0_0)]">#{popupInfo.frame.frame_id}</span>
                <span className="text-[11px] font-mono text-[oklch(0.45_0_0)]">
                  {popupInfo.frame.receivedAt ? new Date(popupInfo.frame.receivedAt).toLocaleTimeString() : ""}
                </span>
              </div>
              
              {popupInfo.frame.image_b64 ? (
                <div 
                  className="group relative mb-3 w-full cursor-pointer overflow-hidden rounded bg-[oklch(0_0_0)] outline outline-1 outline-[oklch(1_0_0/10%)] transition-all hover:outline-[oklch(0.5_0.1_200)]"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEnlargedImage(popupInfo.frame.image_b64 ?? null)
                  }}
                  title="Click to enlarge"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${popupInfo.frame.image_b64}`} alt="Processed Frame" className="h-auto w-full object-contain transition-transform duration-300 group-hover:scale-105" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/40 group-hover:opacity-100">
                    <Maximize2 className="h-6 w-6 text-white drop-shadow-md" />
                  </div>
                </div>
              ) : null}

              <div className="mb-2 flex items-center justify-between border-b border-[oklch(0.35_0.01_240/40%)] pb-2">
                <span className="text-xs font-medium text-[oklch(0.75_0_0)]">Severity Score</span>
                <SeverityBadge score={popupInfo.frame.severity} />
              </div>

              <p className="font-mono text-[11px] text-[oklch(0.45_0_0)]">
                {popupInfo.frame.lat.toFixed(5)}, {popupInfo.frame.lng.toFixed(5)}
              </p>
            </div>
          </Popup>
        )}
        {/* Priority Highlight Marker */}
        {priorityHighlight ? (
          <Marker
            longitude={priorityHighlight.lng}
            latitude={priorityHighlight.lat}
            anchor="bottom"
          >
            <div className="flex flex-col items-center group">
              <div className="absolute -top-10 scale-0 transition-transform group-hover:scale-100 bg-background/90 text-foreground px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg border border-border">
                Priority Area
              </div>
              <div className="relative flex h-8 w-8 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[oklch(0.6_0.2_30)] opacity-75"></span>
                <span className="relative inline-flex h-4 w-4 rounded-full bg-[oklch(0.6_0.2_30)] ring-4 ring-background"></span>
              </div>
            </div>
          </Marker>
        ) : null}
      </MapGL>

      {/* Enlarged Image Modal */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[oklch(0.05_0_0/80%)] p-4 backdrop-blur-md transition-all animate-in fade-in duration-200"
          onClick={() => setEnlargedImage(null)}
        >
          <div 
            className="relative max-h-full max-w-[90vw] rounded-2xl bg-[oklch(0.12_0_0)] p-2 shadow-2xl ring-1 ring-white/10 animate-in zoom-in-95 duration-200" 
            onClick={e => e.stopPropagation()}
          >
            <button 
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[oklch(0.2_0_0)] text-[oklch(0.6_0_0)] ring-1 ring-white/20 transition-colors hover:bg-[oklch(0.3_0_0)] hover:text-white"
              onClick={() => setEnlargedImage(null)}
              aria-label="Close enlarged view"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={`data:image/jpeg;base64,${enlargedImage}`} 
              className="max-h-[85vh] w-auto rounded-xl object-contain" 
              alt="Enlarged full resolution view of capture" 
            />
          </div>
        </div>
      )}
    </div>
  )
})
