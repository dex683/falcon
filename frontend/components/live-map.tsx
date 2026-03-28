"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import MapGL, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import type { MapLibreEvent } from "maplibre-gl"
import { Plane } from "lucide-react"
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
import "maplibre-gl/dist/maplibre-gl.css"

const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright"

interface LiveMapProps {
  frames: DroneFrame[]
  latestFrame: DroneFrame | null
  autoPan: boolean
  showHeatmap: boolean
  drawMode: boolean
  coverageCircles: CoverageCircle[]
  deployedDrones: DeployedDrone[]
  circleDraft: CircleDraft | null
  onCircleDraftChange: (draft: CircleDraft | null) => void
  onCircleDrawComplete: (draft: CircleDraft) => void
}

interface PopupInfo {
  frame: DroneFrame
}

export function LiveMap({
  frames,
  latestFrame,
  autoPan,
  showHeatmap,
  drawMode,
  coverageCircles,
  deployedDrones,
  circleDraft,
  onCircleDraftChange,
  onCircleDrawComplete,
}: LiveMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [drawStart, setDrawStart] = useState<{ lat: number; lng: number } | null>(null)

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

    const points = uniqueFrames.slice(0, 500).map((frame) => {
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
    const map = e.target

    // 3D buildings
    const labelLayerId = map
      .getStyle()
      .layers.find((l) => l.type === "symbol" && (l.layout as Record<string, unknown>)?.["text-field"])?.id

    if (map.getSource("openmaptiles") || map.getSource("maptiler_planet")) {
      const sourceId = map.getSource("openmaptiles") ? "openmaptiles" : "maptiler_planet"
      map.addLayer(
        {
          id: "3d-buildings",
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
  }, [])

  const handleMapClick = useCallback((event: { lngLat: { lat: number; lng: number } }) => {
    if (!drawMode) return
    const { lat, lng } = event.lngLat

    if (!drawStart) {
      setDrawStart({ lat, lng })
      onCircleDraftChange({ centerLat: lat, centerLng: lng, radiusMeters: 40 })
      return
    }

    const radiusMeters = distanceMeters(drawStart.lat, drawStart.lng, lat, lng)
    if (radiusMeters < 25) {
      setDrawStart(null)
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
  }, [drawMode, drawStart, onCircleDraftChange, onCircleDrawComplete])

  const handleMapMove = useCallback((event: { lngLat: { lat: number; lng: number } }) => {
    if (!drawMode || !drawStart) return
    const { lat, lng } = event.lngLat
    const radiusMeters = distanceMeters(drawStart.lat, drawStart.lng, lat, lng)
    onCircleDraftChange({
      centerLat: drawStart.lat,
      centerLng: drawStart.lng,
      radiusMeters,
    })
  }, [drawMode, drawStart, onCircleDraftChange])

  useEffect(() => {
    if (drawMode) return
    setDrawStart(null)
  }, [drawMode])

  return (
    <div className="fixed inset-0 z-0">
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
        cursor={drawMode ? "crosshair" : "grab"}
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
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 3],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 18, 15, 44],
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
              "fill-color": "#0A84FF",
              "fill-opacity": 0.09,
            }}
          />
          <Layer
            id="coverage-outline"
            type="line"
            paint={{
              "line-color": "#0A84FF",
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

        {deployedDrones.map((drone) => (
          <Marker
            key={drone.id}
            longitude={drone.lng}
            latitude={drone.lat}
            anchor="center"
          >
            <div className="relative flex items-center justify-center">
              <span className="absolute h-8 w-8 rounded-full bg-[oklch(0.65_0.18_220/22%)] blur-[1px]" />
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[oklch(0.95_0_0/70%)] bg-[oklch(0.65_0.18_220/92%)] shadow-lg">
                <Plane className="h-3.5 w-3.5 rotate-45 text-[oklch(0.98_0_0)]" strokeWidth={2.25} />
              </span>
            </div>
          </Marker>
        ))}

        {uniqueFrames.map((frame) => {
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
                aria-label={`${frame.label} severity ${frame.severity}`}
              >
                {/* Outer ring for severe markers */}
                {isSevere && (
                  <span
                    className="absolute inset-0 -m-1.5 rounded-full opacity-40 severity-pulse"
                    style={{ backgroundColor: config.color, filter: "blur(4px)" }}
                  />
                )}
                <span
                  className={`relative block h-4 w-4 rounded-full border-2 border-[oklch(0.10_0_0/50%)] marker-fade-in shadow-lg transition-transform duration-150 group-hover:scale-125 ${isLatest && isSevere ? "severity-pulse" : ""}`}
                  style={{ backgroundColor: config.color }}
                />
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
            <div className="w-52 rounded-xl border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/92%)] p-3 backdrop-blur-xl">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="text-[11px] font-mono text-[oklch(0.45_0_0)]">#{popupInfo.frame.frame_id}</span>
                <SeverityBadge score={popupInfo.frame.severity} />
              </div>
              <p className="mb-2 text-sm font-medium capitalize text-[oklch(0.96_0_0)]">
                {popupInfo.frame.label.replace(/_/g, " ")}
              </p>
              <p className="font-mono text-[11px] text-[oklch(0.45_0_0)]">
                {popupInfo.frame.lat.toFixed(5)}, {popupInfo.frame.lng.toFixed(5)}
              </p>
            </div>
          </Popup>
        )}
      </MapGL>
    </div>
  )
}
