"use client"

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Plane,
  Play,
  Radar,
  RefreshCcw,
  Send,
  Square,
  Zap,
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
  show3dBuildings: boolean
  simulationIntervalMs: number
  droneSpeedMs: number
  droneAltitudeM: number
  onAutoPanChange: (next: boolean) => void
  onShowHeatmapChange: (next: boolean) => void
  onShow3dBuildingsChange: (next: boolean) => void
  heatmapRadius: number
  heatmapIntensity: number
  onHeatmapRadiusChange: (next: number) => void
  onHeatmapIntensityChange: (next: number) => void
  onSimulationIntervalChange: (next: number) => void
  onDroneSpeedChange: (next: number) => void
  onDroneAltitudeChange: (next: number) => void
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
  completedDrones: number
  simulatorStatusText: string
  deployedZones: number
  dispatchCount: number

  folderImageCount: number
  onSelectImageFolder: (files: FileList | null) => void

  customPointMode: boolean
  onToggleCustomPointMode: () => void
  customTestPoint: { lat: number; lng: number; zoneId?: string } | null
  onClearCustomTestPoint: () => void
  customImageSelected: boolean
  onSelectCustomImage: (file: File | null) => void
  onSendTestImage: () => void

  // ML model switcher
  useGemini: boolean
  geminiAvailable: boolean
  activeModelName: string
  settingsLoading: boolean
  onUseGeminiChange: (next: boolean) => void
}

export function SeveritySidebar({
  view,
  frames,
  isOpen,
  onToggle,
  maxVisibleReports,
  autoPan,
  showHeatmap,
  show3dBuildings,
  simulationIntervalMs,
  droneSpeedMs,
  droneAltitudeM,
  onAutoPanChange,
  onShowHeatmapChange,
  onShow3dBuildingsChange,
  heatmapRadius,
  heatmapIntensity,
  onHeatmapRadiusChange,
  onHeatmapIntensityChange,
  onSimulationIntervalChange,
  onDroneSpeedChange,
  onDroneAltitudeChange,
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
  completedDrones,
  simulatorStatusText,
  deployedZones,
  dispatchCount,
  folderImageCount,
  onSelectImageFolder,
  videoFile,
  onSelectVideo,
  customPointMode,
  onToggleCustomPointMode,
  customTestPoint,
  onClearCustomTestPoint,
  customImageSelected,
  onSelectCustomImage,
  onSendTestImage,
  useGemini,
  geminiAvailable,
  activeModelName,
  settingsLoading,
  onUseGeminiChange,
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
          "fixed left-3 top-2 bottom-2 z-30 flex w-88 flex-col rounded-3xl border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/80%)] shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Floating side menu"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-[oklch(0.35_0.01_240/40%)] p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{sectionMeta.title}</h2>
            <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs tabular-nums text-accent-foreground">
              {frames.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{sectionMeta.subtitle}</p>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2">
            {(["severe", "moderate", "low"] as const).map((level) => (
              <div
                key={level}
                className="flex flex-col items-center rounded-xl border border-border bg-background/30 py-2"
              >
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{ color: SEVERITY_CONFIG[level].color }}
                >
                  {counts[level]}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
              <div className="rounded-full bg-background/40 p-4">
                <AlertTriangle className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No incoming reports.</p>
            </div>
          ) : null}

          {view === "map" ? (
            <ul className="overflow-hidden rounded-2xl border border-border/70 divide-y divide-border/70">
              {visibleFrames.map((frame, idx) => {
                const level = getSeverityLevel(frame.severity)
                const config = SEVERITY_CONFIG[level]
                return (
                  <li
                    key={`${frame.frame_id}-${frame.receivedAt}-${idx}`}
                    className="group flex flex-col gap-1.5 px-5 py-4 transition-colors duration-150 hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="max-w-44 truncate text-sm font-medium text-foreground">
                        {frame.label.replace(/_/g, " ")}
                      </span>
                      <SeverityBadge score={frame.severity} />
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {frame.lat.toFixed(4)}, {frame.lng.toFixed(4)}
                      </span>
                      <span className="text-muted-foreground/60">•</span>
                      <span className="tabular-nums text-muted-foreground/80">
                        {new Date(frame.receivedAt).toLocaleTimeString()}
                      </span>
                    </div>
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

              {showHeatmap && (
                <div className="space-y-4 rounded-lg bg-[oklch(0.08_0_0/40%)] p-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <Label htmlFor="heatmap-radius" className="text-xs text-[oklch(0.70_0_0)]">Point radius</Label>
                      <span className="font-mono text-[10px] text-[oklch(0.50_0_0)]">{heatmapRadius}</span>
                    </div>
                    <Input
                      id="heatmap-radius"
                      type="range"
                      min={10}
                      max={150}
                      step={1}
                      value={heatmapRadius}
                      onChange={(e) => onHeatmapRadiusChange(Number(e.target.value))}
                      className="h-2 cursor-pointer"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <Label htmlFor="heatmap-intensity" className="text-xs text-[oklch(0.70_0_0)]">Intensity multiplier</Label>
                      <span className="font-mono text-[10px] text-[oklch(0.50_0_0)]">{heatmapIntensity.toFixed(1)}</span>
                    </div>
                    <Input
                      id="heatmap-intensity"
                      type="range"
                      min={0.1}
                      max={8}
                      step={0.1}
                      value={heatmapIntensity}
                      onChange={(e) => onHeatmapIntensityChange(Number(e.target.value))}
                      className="h-2 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="3d-buildings">3D buildings</Label>
                <Switch
                  id="3d-buildings"
                  checked={show3dBuildings}
                  onCheckedChange={onShow3dBuildingsChange}
                />
              </div>

              <Separator />

              {/* ── ML Model Selector ── */}
              <div className="space-y-3 rounded-xl border border-[oklch(0.28_0.015_260/50%)] bg-[oklch(0.12_0.008_260/40%)] p-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-[oklch(0.72_0.19_280)]" />
                  <span className="text-sm font-medium text-[oklch(0.92_0_0)]">ML Model</span>
                  {settingsLoading && (
                    <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[oklch(0.60_0_0)]" />
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="use-gemini"
                      className={cn(!geminiAvailable && "text-[oklch(0.50_0_0)]")}
                    >
                      Gemini Vision API
                    </Label>
                    {!geminiAvailable && (
                      <p className="text-[11px] text-[oklch(0.50_0_0)]">No API key configured</p>
                    )}
                  </div>
                  <Switch
                    id="use-gemini"
                    checked={useGemini}
                    disabled={settingsLoading || !geminiAvailable}
                    onCheckedChange={onUseGeminiChange}
                  />
                </div>

                <div className="flex items-center gap-1.5 rounded-lg bg-[oklch(0.08_0_0/60%)] px-2.5 py-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-[oklch(0.45_0_0)]">Active</span>
                  <span className="ml-1 truncate font-mono text-[11px] text-[oklch(0.70_0.12_280)]">
                    {activeModelName || "—"}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="sim-interval">Simulation interval (ms)</Label>
                <Input
                  id="sim-interval"
                  type="number"
                  min={300}
                  max={10000}
                  step={100}
                  value={simulationIntervalMs}
                  onChange={(e) => onSimulationIntervalChange(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="drone-speed">Drone speed (m/s)</Label>
                <Input
                  id="drone-speed"
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={droneSpeedMs}
                  onChange={(e) => onDroneSpeedChange(Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="altitude">Drone altitude (m)</Label>
                <Input
                  id="altitude"
                  type="number"
                  min={10}
                  max={3000}
                  step={10}
                  value={droneAltitudeM}
                  onChange={(e) => onDroneAltitudeChange(Number(e.target.value))}
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
                  <p className="text-xs text-[oklch(0.55_0_0)]">Active</p>
                  <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{deployedDrones.length}</p>
                </div>
                <div className="rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-3">
                  <p className="text-xs text-[oklch(0.55_0_0)]">Completed</p>
                  <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{completedDrones}</p>
                </div>
              </div>

              <div className="rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-3">
                <p className="text-xs text-[oklch(0.55_0_0)]">Dispatches</p>
                <p className="text-lg font-semibold tabular-nums text-[oklch(0.96_0_0)]">{dispatchCount}</p>
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

                <div className="pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    variant={customPointMode ? "secondary" : "outline"}
                    onClick={onToggleCustomPointMode}
                  >
                    <Plane className="h-3.5 w-3.5" />
                    {customPointMode ? "Pick Test Point (Armed)" : "Pick Test Point"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-[oklch(0.60_0_0)]">
                  <span>Zones: {deployedZones}</span>
                  <span>Status: {simulatorStatusText}</span>
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

                {customTestPoint ? (
                  <div className="rounded-lg border border-[oklch(0.24_0.005_240/60%)] bg-[oklch(0.12_0_0/50%)] p-2 text-xs text-[oklch(0.75_0_0)]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[oklch(0.90_0_0)]">Custom test point set</p>
                        <p className="font-mono">{customTestPoint.lat.toFixed(4)}, {customTestPoint.lng.toFixed(4)}</p>
                        <p className="text-[11px] text-[oklch(0.55_0_0)]">{customTestPoint.zoneId ? `Zone: ${customTestPoint.zoneId}` : "Not inside a deployed zone"}</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" onClick={onClearCustomTestPoint}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[oklch(0.55_0_0)]">No custom test point selected.</p>
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

              <div className="space-y-3 rounded-xl border border-[oklch(0.24_0.005_240/60%)] p-4">
                <div>
                  <p className="text-sm font-medium text-[oklch(0.96_0_0)]">Images</p>
                  <p className="text-xs text-[oklch(0.55_0_0)]">Pick a folder; images are chosen randomly per capture.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="image-folder">Image folder</Label>
                  <Input
                    id="image-folder"
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => onSelectImageFolder(e.target.files)}
                    {...({ webkitdirectory: "" } as any)}
                  />
                  <p className="text-[11px] text-[oklch(0.55_0_0)]">Loaded: {folderImageCount}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="video-upload">Aerial video</Label>
                  <Input
                    id="video-upload"
                    type="file"
                    accept="video/mp4,video/x-m4v,video/*"
                    onChange={(e) => onSelectVideo(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-[11px] text-[oklch(0.55_0_0)]">Loaded: {videoFile ? videoFile.name : "None"}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="custom-image">Custom image (optional)</Label>
                  <Input
                    id="custom-image"
                    type="file"
                    accept="image/*"
                    onChange={(e) => onSelectCustomImage(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-[11px] text-[oklch(0.55_0_0)]">Selected: {customImageSelected ? "Yes" : "No"}</p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!customImageSelected}
                  onClick={onSendTestImage}
                >
                  Send test image
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
