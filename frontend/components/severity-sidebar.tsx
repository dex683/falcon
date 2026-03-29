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
  Radio,
  RefreshCcw,
  Send,
  Square,
  Video,
  VideoOff,
  Zap,
  MapPin,
  Clock,
  Compass,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SeverityBadge } from "@/components/severity-badge"
import type { ZoneReport, PriorityLocation } from "@/lib/pdf-report"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import type { DroneFrame } from "@/context/SocketContext"
import type { DashboardView } from "@/components/bottom-dock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { CircleDraft, DeployedDrone, CoverageCircle } from "@/lib/simulator"
import { distanceMeters } from "@/lib/simulator"

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
  deployedZones: CoverageCircle[]
  dispatchCount: number

  folderImageCount: number
  onSelectImageFolder: (files: FileList | null) => void

  videoFile: File | null
  onSelectVideo: (file: File | null) => void

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

  // Drone live stream
  activeLiveStreamDroneId: string | null
  onViewDroneLiveStream: (droneId: string | null) => void

  // Feed visibility
  feedVisible: boolean
  onToggleFeedVisible: () => void

  // Inline Reports 
  zoneReports: Record<string, ZoneReport>
  isFetchingReport: Record<string, boolean>
  isGeneratingPdf: Record<string, boolean>
  selectedPriorityLocation: PriorityLocation | null
  onSelectPriorityLocation: (loc: PriorityLocation | null) => void

  // Actions
  onGenerateZoneReport: (zoneId: string) => void
  onDownloadZoneReportPdf: (zoneId: string) => void
  onResolveZone: (zoneId: string, resolved: boolean) => void
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
  activeLiveStreamDroneId,
  onViewDroneLiveStream,
  feedVisible,
  onToggleFeedVisible,
  zoneReports,
  isFetchingReport,
  isGeneratingPdf,
  selectedPriorityLocation,
  onSelectPriorityLocation,
  onGenerateZoneReport,
  onDownloadZoneReportPdf,
  onResolveZone,
}: SeveritySidebarProps) {
  
  // Filter out good frames
  const damagedFrames = frames.filter((f) => f.severity > 1)

  // Aggregate frames into zones
  const zoneData = deployedZones.map(zone => {
    const zoneFrames = damagedFrames.filter(f => 
      distanceMeters(zone.centerLat, zone.centerLng, f.lat, f.lng) <= zone.radiusMeters
    )

    // Average structural severity of damaged frames
    const avgSeverity = zoneFrames.length > 0 
      ? zoneFrames.reduce((acc, f) => acc + f.severity, 0) / zoneFrames.length
      : 0

    // Apply population density multiplier
    let combinedSeverity = avgSeverity
    if (avgSeverity > 0 && zone.populationDensity) {
      if (zone.populationDensity > 5000) combinedSeverity += 2
      else if (zone.populationDensity > 2000) combinedSeverity += 1
    }
    combinedSeverity = Math.min(10, Math.max(0, Math.round(combinedSeverity)))

    return {
      ...zone,
      zoneFrames,
      combinedSeverity,
    }
  }).sort((a, b) => b.combinedSeverity - a.combinedSeverity)

  const visibleZones = zoneData.slice(0, maxVisibleReports)

  const sectionMeta = ({
    map: {
      title: "Zone Reports",
      subtitle: "Severity-ranked damage reports",
    },
    settings: {
      title: "Settings",
      subtitle: "Configure dashboard variables",
    },
    simulation: {
      title: "Simulation",
      subtitle: "Simulate drone deployments",
    },
    drones: {
      title: "Drone Fleet",
      subtitle: `${deployedDrones.length} active drones`,
    },
  } as Record<DashboardView, { title: string; subtitle: string }>)[view]

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className={cn(
          "fixed top-1/2 z-40 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground shadow-lg backdrop-blur-xl transition-all duration-300 hover:bg-accent focus:outline-none",
          isOpen ? "left-94" : "left-4"
        )}
        aria-label={isOpen ? "Close severity sidebar" : "Open severity sidebar"}
      >
        {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Floating panel */}
      <aside
        className={cn(
          "fixed left-3 top-2 bottom-2 z-30 flex w-88 flex-col overflow-hidden rounded-3xl border border-surface-border bg-surface shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Floating side menu"
      >
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-surface-border px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{sectionMeta.title}</h2>
            <Badge variant="secondary" className="ml-auto rounded-full text-xs tabular-nums">
              {deployedZones.length} Zones
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{sectionMeta.subtitle}</p>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            {view === "map" && visibleZones.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="rounded-full bg-muted p-4">
                  <AlertTriangle className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No active zones deployed.</p>
              </div>
            ) : null}

            {view === "map" ? (
              <div className="space-y-2">
                {visibleZones.map((zone, idx) => {
                  const level = getSeverityLevel(zone.combinedSeverity)
                  const config = SEVERITY_CONFIG[level]
                  
                  return (
                    <Card
                      key={`${zone.id}-${idx}`}
                      className={cn(
                        "group border-border/50 bg-card/40 py-0 transition-colors duration-150 hover:bg-accent/30",
                        zone.resolved && "opacity-60 grayscale-[0.2]"
                      )}
                    >
                      <CardContent className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="max-w-44 truncate text-sm font-medium text-foreground">
                            {zone.locationName || zone.id}
                          </span>
                          <SeverityBadge score={zone.combinedSeverity} />
                        </div>
                        
                        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                          <div className="flex items-center justify-between">
                            <span className="capitalize">{zone.addressType || "Unknown Area"}</span>
                            <span>Pop. Density: {zone.populationDensity ? `${zone.populationDensity}/km²` : "N/A"}</span>
                          </div>
                          
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
                              <span>{zone.zoneFrames.length} total damaged properties</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {zoneReports[zone.id] ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={isGeneratingPdf[zone.id]}
                                  className="h-6 px-2 text-[10px] gap-1 bg-surface-border/50 hover:bg-accent hover:text-accent-foreground transition-colors"
                                  onClick={() => onDownloadZoneReportPdf(zone.id)}
                                >
                                  {isGeneratingPdf[zone.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                                  {isGeneratingPdf[zone.id] ? "Exporting..." : "Export PDF"}
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={isFetchingReport[zone.id]}
                                  className="h-6 px-2 text-[10px] gap-1 bg-surface-border/50 hover:bg-accent hover:text-accent-foreground transition-colors"
                                  onClick={() => onGenerateZoneReport(zone.id)}
                                >
                                  {isFetchingReport[zone.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                                  {isFetchingReport[zone.id] ? "Analyzing..." : "Intelligence"}
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {zoneReports[zone.id] && (
                            <div className="mt-3 pt-3 border-t border-border/50 text-xs">
                              <h4 className="font-semibold text-foreground mb-1">Key Insights</h4>
                              <ul className="mb-4 space-y-1 pl-4 list-disc text-muted-foreground/90 leading-tight">
                                {zoneReports[zone.id].key_insights.map((insight, i) => (
                                  <li key={i}>{insight}</li>
                                ))}
                              </ul>
                              
                              <h4 className="font-semibold text-foreground mb-2">Priority Areas</h4>
                              <div className="space-y-1.5 mb-1">
                                {zoneReports[zone.id].priority_locations.map((loc, i) => {
                                  const isSelected = selectedPriorityLocation?.lat === loc.lat && selectedPriorityLocation?.lng === loc.lng;
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => onSelectPriorityLocation(isSelected ? null : loc)}
                                      className={cn(
                                        "w-full text-left p-2 rounded border transition-colors",
                                        isSelected 
                                          ? "bg-accent text-accent-foreground border-accent-foreground/50 shadow-sm" 
                                          : "bg-background/50 border-border/50 hover:bg-accent/50 text-muted-foreground"
                                      )}
                                    >
                                      <div className="font-medium text-[11px] mb-0.5 text-foreground">Location #{i+1}</div>
                                      <div className="line-clamp-2 text-[10px] leading-tight">{loc.reason}</div>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : null}

            {view === "settings" ? (
              <Card className="border-border/50 bg-card/40 py-0">
                <CardContent className="space-y-4 p-4">
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
                    <Card className="border-border/30 bg-muted/30 py-0">
                      <CardContent className="space-y-4 p-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <Label htmlFor="heatmap-radius" className="text-xs text-muted-foreground">Point radius</Label>
                            <Badge variant="outline" className="font-mono text-[10px]">{heatmapRadius}</Badge>
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
                            <Label htmlFor="heatmap-intensity" className="text-xs text-muted-foreground">Intensity multiplier</Label>
                            <Badge variant="outline" className="font-mono text-[10px]">{heatmapIntensity.toFixed(1)}</Badge>
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
                      </CardContent>
                    </Card>
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

                  <div className="flex items-center justify-between">
                    <Label htmlFor="use-gemini" className="flex flex-col gap-1">
                      <span>Use Gemini Flash Model</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {geminiAvailable ? "Requires backend API key." : "Gemini not configured on backend."}
                      </span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {useGemini ? "Gemini" : activeModelName || "YOLOv8"}
                      </span>
                      <Switch
                        id="use-gemini"
                        checked={useGemini}
                        onCheckedChange={onUseGeminiChange}
                        disabled={settingsLoading || !geminiAvailable}
                      />
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
                </CardContent>
              </Card>
            ) : null}

            {view === "simulation" ? (
              <div className="space-y-3">
                {/* Stats cards */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Frames", value: simulatedCount },
                    { label: "Active", value: deployedDrones.length },
                    { label: "Zones", value: deployedZones.length },
                  ].map(({ label, value }) => (
                    <Card key={label} className="border-border/50 bg-card/40 py-0">
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card className="border-border/50 bg-card/40 py-0">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Dispatches</p>
                    <p className="text-lg font-semibold tabular-nums text-foreground">{dispatchCount}</p>
                  </CardContent>
                </Card>

                {/* Draw mode & deploy section */}
                <Card className="border-border/50 bg-card/40 py-0">
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Circle Draw Mode</p>
                      <p className="text-xs text-muted-foreground">Click map: center, then edge</p>
                    </div>

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

                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>Zones: {deployedZones.length}</span>
                      <span>Status: {simulatorStatusText}</span>
                    </div>

                    {draftCircle ? (
                      <Card className="border-border/30 bg-muted/30 py-0">
                        <CardContent className="p-2 text-xs">
                          <p className="font-medium text-foreground">Draft circle ready</p>
                          <p className="font-mono text-muted-foreground">{draftCircle.centerLat.toFixed(4)}, {draftCircle.centerLng.toFixed(4)}</p>
                          <p className="text-muted-foreground">Radius: {Math.round(draftCircle.radiusMeters)} m</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <p className="text-xs text-muted-foreground">No draft circle selected yet.</p>
                    )}

                    {customTestPoint ? (
                      <Card className="border-border/30 bg-muted/30 py-0">
                        <CardContent className="p-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">Custom test point set</p>
                              <p className="font-mono text-muted-foreground">{customTestPoint.lat.toFixed(4)}, {customTestPoint.lng.toFixed(4)}</p>
                              <p className="text-[11px] text-muted-foreground">{customTestPoint.zoneId ? `Zone: ${customTestPoint.zoneId}` : "Not inside a deployed zone"}</p>
                            </div>
                            <Button type="button" size="sm" variant="ghost" onClick={onClearCustomTestPoint}>
                              Clear
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <p className="text-xs text-muted-foreground">No custom test point selected.</p>
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
                  </CardContent>
                </Card>

                {/* Images section */}
                <Card className="border-border/50 bg-card/40 py-0">
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Images</p>
                      <p className="text-xs text-muted-foreground">Pick a folder; images are chosen randomly per capture.</p>
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
                      <p className="text-[11px] text-muted-foreground">Loaded: {folderImageCount}</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="video-upload">Aerial video</Label>
                      <Input
                        id="video-upload"
                        type="file"
                        accept="video/mp4,video/x-m4v,video/*"
                        onChange={(e) => onSelectVideo(e.target.files?.[0] ?? null)}
                      />
                      <p className="text-[11px] text-muted-foreground">Loaded: {videoFile ? videoFile.name : "None"}</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="custom-image">Custom image (optional)</Label>
                      <Input
                        id="custom-image"
                        type="file"
                        accept="image/*"
                        onChange={(e) => onSelectCustomImage(e.target.files?.[0] ?? null)}
                      />
                      <p className="text-[11px] text-muted-foreground">Selected: {customImageSelected ? "Yes" : "No"}</p>
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
                  </CardContent>
                </Card>

                {/* Controls */}
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

                {/* Deployed drones list */}
                {/* <Card className="border-border/50 bg-card/40 py-0">
                  <CardContent className="p-2">
                    <ScrollArea className="max-h-52">
                      <div className="space-y-2">
                        {deployedDrones.length === 0 ? (
                          <p className="px-2 py-4 text-xs text-muted-foreground">No drones deployed.</p>
                        ) : (
                          deployedDrones.map((drone) => (
                            <Card key={drone.id} className="border-border/30 bg-muted/20 py-0">
                              <CardContent className="p-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold text-foreground">{drone.id}</p>
                                  <Plane className="h-3.5 w-3.5 text-[#695cff]" />
                                </div>
                                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                  {drone.lat.toFixed(4)}, {drone.lng.toFixed(4)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{drone.zoneId} • r={Math.round(drone.radiusMeters)}m</p>
                                <p className="text-[11px] text-muted-foreground/60">{new Date(drone.updatedAt).toLocaleTimeString()}</p>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card> */}

                <Button type="button" variant="ghost" className="w-full" onClick={onClearSimulation}>
                  <RefreshCcw className="h-4 w-4" />
                  Reset Simulator
                </Button>
              </div>
            ) : null}

            {view === "drones" ? (
              <div className="space-y-3">
                {/* Feed control button */}
                <Button
                  type="button"
                  size="sm"
                  variant={feedVisible ? "secondary" : "outline"}
                  className={cn(
                    "w-full gap-2 text-xs",
                    !feedVisible && "border-[#695cff]/40 text-[#695cff]"
                  )}
                  onClick={onToggleFeedVisible}
                >
                  {feedVisible ? (
                    <>
                      <VideoOff className="h-3.5 w-3.5" />
                      Hide Live Feed
                    </>
                  ) : (
                    <>
                      <Video className="h-3.5 w-3.5" />
                      Show Live Feed
                    </>
                  )}
                </Button>

                {deployedDrones.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className="rounded-full bg-muted p-4">
                      <Radio className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">No drones deployed yet.</p>
                    <p className="text-xs text-muted-foreground">Deploy drones from the Simulation tab.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deployedDrones.map((drone) => {
                      const isStreaming = activeLiveStreamDroneId === drone.id
                      return (
                        <Card
                          key={drone.id}
                          className={cn(
                            "border-border/50 bg-card/40 py-0 transition-all duration-200",
                            isStreaming && "border-[#695cff]/50 bg-[#695cff]/5"
                          )}
                        >
                          <CardContent className="p-3">
                            {/* Top row: ID + status */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-lg",
                                  drone.pathCompleted
                                    ? "bg-muted"
                                    : "bg-[#695cff]/15"
                                )}>
                                  <Plane
                                    className={cn(
                                      "h-3.5 w-3.5 rotate-45",
                                      drone.pathCompleted ? "text-muted-foreground" : "text-[#695cff]"
                                    )}
                                    strokeWidth={2}
                                  />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-foreground">{drone.id}</p>
                                  <p className="text-[10px] text-muted-foreground">{drone.label || drone.id}</p>
                                </div>
                              </div>
                              <Badge
                                variant={drone.pathCompleted ? "secondary" : "default"}
                                className={cn(
                                  "text-[10px]",
                                  !drone.pathCompleted && "bg-[#695cff] text-white"
                                )}
                              >
                                {drone.pathCompleted ? "Done" : "Active"}
                              </Badge>
                            </div>

                            {/* Info grid */}
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground mb-3">
                              <div className="flex items-center gap-1.5">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="font-mono truncate">
                                  {drone.lat.toFixed(4)}, {drone.lng.toFixed(4)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Compass className="h-3 w-3 shrink-0" />
                                <span>{drone.zoneId}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Radio className="h-3 w-3 shrink-0" />
                                <span>r={Math.round(drone.radiusMeters)}m</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>{new Date(drone.updatedAt).toLocaleTimeString()}</span>
                              </div>
                            </div>

                            {/* Live stream button */}
                            <Button
                              type="button"
                              size="sm"
                              variant={isStreaming ? "default" : "outline"}
                              className={cn(
                                "w-full gap-2 text-xs",
                                isStreaming && "bg-[#695cff] hover:bg-[#695cff]/90 text-white"
                              )}
                              onClick={() =>
                                onViewDroneLiveStream(isStreaming ? null : drone.id)
                              }
                            >
                              {isStreaming ? (
                                <>
                                  <VideoOff className="h-3.5 w-3.5" />
                                  Stop Live Stream
                                </>
                              ) : (
                                <>
                                  <Video className="h-3.5 w-3.5" />
                                  View Live Stream
                                </>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </>
  )
}
