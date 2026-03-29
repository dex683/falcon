"use client"

import { Badge } from "@/components/ui/badge"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import type { CoverageCircle } from "@/lib/simulator"
import { distanceMeters } from "@/lib/simulator"
import type { DroneFrame } from "@/context/SocketContext"
import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react"

interface SeverityCountsBarProps {
  frames: DroneFrame[]
  deployedZones: CoverageCircle[]
}

export function SeverityCountsBar({ frames, deployedZones }: SeverityCountsBarProps) {
  const damagedFrames = frames.filter((f) => f.severity > 1)

  const zoneReports = deployedZones.map((zone) => {
    const zoneFrames = damagedFrames.filter(
      (f) => distanceMeters(zone.centerLat, zone.centerLng, f.lat, f.lng) <= zone.radiusMeters
    )
    const avgSeverity =
      zoneFrames.length > 0
        ? zoneFrames.reduce((acc, f) => acc + f.severity, 0) / zoneFrames.length
        : 0
    let combinedSeverity = avgSeverity
    if (avgSeverity > 0 && zone.populationDensity) {
      if (zone.populationDensity > 5000) combinedSeverity += 2
      else if (zone.populationDensity > 2000) combinedSeverity += 1
    }
    combinedSeverity = Math.min(10, Math.max(0, Math.round(combinedSeverity)))
    return { combinedSeverity }
  })

  const counts = {
    severe: zoneReports.filter((z) => getSeverityLevel(z.combinedSeverity) === "severe").length,
    moderate: zoneReports.filter((z) => getSeverityLevel(z.combinedSeverity) === "moderate").length,
    low: zoneReports.filter((z) => getSeverityLevel(z.combinedSeverity) === "low").length,
  }

  const items = [
    {
      level: "severe" as const,
      icon: AlertTriangle,
      count: counts.severe,
    },
    {
      level: "moderate" as const,
      icon: ShieldAlert,
      count: counts.moderate,
    },
    {
      level: "low" as const,
      icon: ShieldCheck,
      count: counts.low,
    },
  ]

  return (
    <div className="flex items-center gap-1.5">
      {items.map(({ level, icon: Icon, count }) => {
        const config = SEVERITY_CONFIG[level]
        return (
          <div
            key={level}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur-xl transition-all duration-200 hover:scale-105"
            style={{
              borderColor: `color-mix(in oklch, ${config.color} 35%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${config.color} 8%, oklch(0.13 0.005 240 / 80%))`,
            }}
          >
            <Icon
              className="h-3.5 w-3.5"
              style={{ color: config.color }}
              strokeWidth={2}
            />
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: config.color }}
            >
              {count}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-white">
              {config.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
