"use client"

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plane,
  Play,
  Radar,
  RefreshCcw,
  Send,
  Square,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SeverityBadge } from "@/components/severity-badge"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import type { DroneFrame } from "@/context/SocketContext"
import type { DashboardView } from "@/components/bottom-dock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import type { CircleDraft, DeployedDrone } from "@/lib/simulator"

interface SeveritySidebarProps {
  view: DashboardView
  frames: DroneFrame[]
  isOpen: boolean
  onToggle: () => void
  maxVisibleReports: number
  autoPan: boolean
  showHeatmap: boolean
  simulationIntervalMs: number
  onAutoPanChange: (next: boolean) => void
  onShowHeatmapChange: (next: boolean) => void
  onSimulationIntervalChange: (next: number) => void
  onMaxVisibleReportsChange: (next: number) => void
  onResetSettings: () => void
  simulationRunning: boolean
  simulatedCount: number
  onStartSimulation: () => void
  onStopSimulation: () => void
  onCaptureNow: () => void
  onClearSimulation: () => void
  drawMode: boolean
  onToggleDrawMode: () => void
  draftCircle: CircleDraft | null
  dronesPerDeployment: number
  onDronesPerDeploymentChange: (next: number) => void
  onDeployFromCircle: () => void
  deployedDrones: DeployedDrone[]
  deployedZones: number
  dispatchCount: number
}

export function SeveritySidebar({
  view,
  frames,
  isOpen,
  onToggle,
  maxVisibleReports,
  autoPan,
  showHeatmap,
  simulationIntervalMs,
  onAutoPanChange,
  onShowHeatmapChange,
  onSimulationIntervalChange,
  onMaxVisibleReportsChange,
  onResetSettings,
  simulationRunning,
  simulatedCount,
  onStartSimulation,
  onStopSimulation,
  onCaptureNow,
  onClearSimulation,
  drawMode,
  onToggleDrawMode,
  draftCircle,
  dronesPerDeployment,
  onDronesPerDeploymentChange,
  onDeployFromCircle,
  deployedDrones,
  deployedZones,
  dispatchCount,
}: SeveritySidebarProps) {
  const sorted = [...frames].sort((a, b) => b.severity - a.severity)
  const visibleFrames = sorted.slice(0, maxVisibleReports)

  const counts = {
    severe: frames.filter((f) => getSeverityLevel(f.severity) === "severe").length,
    moderate: frames.filter((f) => getSeverityLevel(f.severity) === "moderate").length,
    low: frames.filter((f) => getSeverityLevel(f.severity) === "low").length,
  }

  const sectionMeta = {
    map: {
      title: "Main Map View",
      subtitle: "Severity-ranked reports",
    },
    settings: {
      title: "Settings",
      subtitle: "Configure dashboard variables",
    },
    simulation: {
      title: "Simulation",
      subtitle: "Simulate drone deployments",
    },
  }[view]

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className={cn(
          "fixed top-1/2 z-40 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/75%)] text-[oklch(0.96_0_0)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:bg-[oklch(0.22_0.01_230)] focus:outline-none",
          isOpen ? "left-94" : "left-4"
        )}
        aria-label={isOpen ? "Close severity sidebar" : "Open severity sidebar"}
      >
        {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Floating panel */}
      <aside
        className={cn(
          "fixed left-3 top-2  bottom-2 z-30 flex w-88 flex-col rounded-3xl border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/80%)] shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Floating side menu"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-[oklch(0.35_0.01_240/40%)] p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-[oklch(0.96_0_0)]">{sectionMeta.title}</h2>
            <span className="ml-auto rounded-full bg-[oklch(0.22_0.01_230)] px-2 py-0.5 text-xs tabular-nums text-[oklch(0.55_0_0)]">
              {frames.length}
            </span>
          </div>
          <p className="text-xs text-[oklch(0.55_0_0)]">{sectionMeta.subtitle}</p>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2">
            {(["severe", "moderate", "low"] as const).map((level) => (
              <div
                key={level}
                className="flex flex-col items-center rounded-xl border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.10_0_0/50%)] py-2"
              >
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{ color: SEVERITY_CONFIG[level].color }}
                >
                  {counts[level]}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[oklch(0.45_0_0)]">
                  {SEVERITY_CONFIG[level].label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5">
          {view === "map" && visibleFrames.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="rounded-full bg-[oklch(0.18_0_0)] p-4">
                <AlertTriangle className="h-6 w-6 text-[oklch(0.35_0_0)]" />
              </div>
              <p className="text-sm text-[oklch(0.45_0_0)]">Waiting for incoming frames…</p>
            </div>
          ) : null}

          {view === "map" ? (
            <ul className="overflow-hidden rounded-2xl border border-[oklch(0.24_0.005_240/60%)] divide-y divide-[oklch(0.24_0.005_240/60%)]">
              {visibleFrames.map((frame, idx) => {
                const level = getSeverityLevel(frame.severity)
                const config = SEVERITY_CONFIG[level]
                return (
                  <li
                    key={`${frame.frame_id}-${idx}`}
                    className="group flex flex-col gap-1.5 px-5 py-4 transition-colors duration-150 hover:bg-[oklch(0.16_0.005_240/60%)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="max-w-40 truncate text-sm font-medium text-[oklch(0.92_0_0)]">
                        {frame.label.replace(/_/g, " ")}
                      </span>
                      <SeverityBadge score={frame.severity} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                      <span className="font-mono text-[11px] text-[oklch(0.45_0_0)]">
                        {frame.lat.toFixed(4)}, {frame.lng.toFixed(4)}
                      </span>
                    </div>
                    <span className="text-[11px] text-[oklch(0.35_0_0)]">
                      {new Date(frame.receivedAt).toLocaleTimeString()}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {view === "settings" ? (
            <div className="space-y-4 rounded-2xl border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.10_0_0/40%)] p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-pan">Map auto-pan</Label>
                <Switch
                  id="auto-pan"
                  checked={autoPan}
                  onCheckedChange={onAutoPanChange}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="heatmap">Severity heatmap</Label>
                <Switch
                  id="heatmap"
                  checked={showHeatmap}
                  onCheckedChange={onShowHeatmapChange}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="sim-interval">Simulation interval (ms)</Label>
                <Input
                  id="sim-interval"
                  type="number"
                  min={500}
                  max={10000}
                  step={100}
                  value={simulationIntervalMs}
                  onChange={(e) => onSimulationIntervalChange(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-visible">Max reports in severity list</Label>
                <Input
                  id="max-visible"
                  type="number"
                  min={20}
                  max={300}
                  step={10}
                  value={maxVisibleReports}
                  onChange={(e) => onMaxVisibleReportsChange(Number(e.target.value))}
                />
              </div>

              <Button type="button" variant="outline" className="w-full" onClick={onResetSettings}>
                Reset to defaults
              </Button>
            </div>
          ) : null}

          {view === "simulation" ? (
            <div className="space-y-4 rounded-2xl border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.10_0_0/40%)] p-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-3">
                  <p className="text-xs text-[oklch(0.55_0_0)]">Frames</p>
                  <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{simulatedCount}</p>
                </div>
                <div className="rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-3">
                  <p className="text-xs text-[oklch(0.55_0_0)]">Drones</p>
                  <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{deployedDrones.length}</p>
                </div>
                <div className="rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-3">
                  <p className="text-xs text-[oklch(0.55_0_0)]">Dispatches</p>
                  <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{dispatchCount}</p>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-4">
                <div className="space-y-1">
                  <div>
                    <p className="text-sm font-medium text-[oklch(0.96_0_0)]">Circle Draw Mode</p>
                    <p className="text-xs text-[oklch(0.55_0_0)]">Click map: center, then edge</p>
                  </div>

                </div>

                <div className="pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    variant={drawMode ? "secondary" : "outline"}
                    onClick={onToggleDrawMode}
                  >
                    <Circle className="h-3.5 w-3.5" />
                    {drawMode ? "Armed" : "Draw"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-[oklch(0.60_0_0)]">
                  <span>Zones: {deployedZones}</span>
                  <span>Status: {simulationRunning ? "Running" : "Stopped"}</span>
                </div>

                {draftCircle ? (
                  <div className="rounded-lg border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.12_0_0/50%)] p-2 text-xs text-[oklch(0.75_0_0)]">
                    <p className="font-medium text-[oklch(0.90_0_0)]">Draft circle ready</p>
                    <p className="font-mono">{draftCircle.centerLat.toFixed(4)}, {draftCircle.centerLng.toFixed(4)}</p>
                    <p>Radius: {Math.round(draftCircle.radiusMeters)} m</p>
                  </div>
                ) : (
                  <p className="text-xs text-[oklch(0.55_0_0)]">No draft circle selected yet.</p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="drones-per-zone">Drones per new zone</Label>
                  <Input
                    id="drones-per-zone"
                    type="number"
                    min={1}
                    max={8}
                    value={dronesPerDeployment}
                    onChange={(e) => onDronesPerDeploymentChange(Number(e.target.value))}
                  />
                </div>

                <Button type="button" className="w-full" disabled={!draftCircle} onClick={onDeployFromCircle}>
                  <Radar className="h-4 w-4" />
                  Deploy
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {simulationRunning ? (
                  <Button type="button" variant="secondary" onClick={onStopSimulation}>
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                ) : (
                  <Button type="button" onClick={onStartSimulation}>
                    <Play className="h-4 w-4" />
                    Start
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={onCaptureNow} disabled={deployedDrones.length === 0}>
                  <Send className="h-4 w-4" />
                  Capture Now
                </Button>
              </div>

              <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-2">
                {deployedDrones.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-[oklch(0.55_0_0)]">No drones deployed. </p>
                ) : (
                  deployedDrones.map((drone) => (
                    <div key={drone.id} className="rounded-lg border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.12_0_0/45%)] p-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[oklch(0.92_0_0)]">{drone.id}</p>
                        <Plane className="h-3.5 w-3.5 text-[oklch(0.70_0.18_220)]" />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[oklch(0.70_0_0)]">
                        {drone.lat.toFixed(4)}, {drone.lng.toFixed(4)}
                      </p>
                      <p className="text-[11px] text-[oklch(0.55_0_0)]">{drone.zoneId} • r={Math.round(drone.radiusMeters)}m</p>
                      <p className="text-[11px] text-[oklch(0.45_0_0)]">{new Date(drone.updatedAt).toLocaleTimeString()}</p>
                    </div>
                  ))
                )}
              </div>

              <Button type="button" variant="ghost" className="w-full" onClick={onClearSimulation}>
                <RefreshCcw className="h-4 w-4" />
                Reset Simulator
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
