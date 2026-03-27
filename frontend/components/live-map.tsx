"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import MapGL, { Marker, Popup, NavigationControl, type MapRef } from "react-map-gl/maplibre"
import type { MapLibreEvent } from "maplibre-gl"
import type { DroneFrame } from "@/context/SocketContext"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import { SeverityBadge } from "@/components/severity-badge"
import "maplibre-gl/dist/maplibre-gl.css"

const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright"

interface LiveMapProps {
  frames: DroneFrame[]
  latestFrame: DroneFrame | null
}

interface PopupInfo {
  frame: DroneFrame
}

export function LiveMap({ frames, latestFrame }: LiveMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Deduplicate frames by frame_id — keep the latest occurrence
  const uniqueFrames = useMemo(() => {
    const seen = new Map<string, DroneFrame>()
    for (const frame of frames) {
      seen.set(frame.frame_id, frame)
    }
    return Array.from(seen.values())
  }, [frames])

  // Auto-pan to latest frame only if it falls outside the current viewport
  useEffect(() => {
    if (!latestFrame || !mapRef.current || !mapLoaded) return
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
  }, [latestFrame, mapLoaded])

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
        attributionControl={false}
        reuseMaps
      >
        <NavigationControl position="bottom-right" style={{ bottom: "96px", right: "16px" }} />

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
