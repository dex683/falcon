"use client"

import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { SeverityBadge } from "@/components/severity-badge"
import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"
import type { DroneFrame } from "@/context/SocketContext"

interface SeveritySidebarProps {
  frames: DroneFrame[]
  isOpen: boolean
  onToggle: () => void
}

export function SeveritySidebar({ frames, isOpen, onToggle }: SeveritySidebarProps) {
  const sorted = [...frames].sort((a, b) => b.severity - a.severity)

  const counts = {
    severe: frames.filter((f) => getSeverityLevel(f.severity) === "severe").length,
    moderate: frames.filter((f) => getSeverityLevel(f.severity) === "moderate").length,
    low: frames.filter((f) => getSeverityLevel(f.severity) === "low").length,
  }

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className="fixed left-4 top-1/2 z-40 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/75%)] text-[oklch(0.96_0_0)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:bg-[oklch(0.22_0.01_230)] focus:outline-none"
        aria-label={isOpen ? "Close severity sidebar" : "Open severity sidebar"}
        style={{ left: isOpen ? "calc(320px + 8px)" : "16px" }}
      >
        {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-30 flex h-full w-80 flex-col border-r border-[oklch(0.35_0.01_240/40%)] bg-[oklch(0.13_0.005_240/80%)] shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Severity list"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-[oklch(0.35_0.01_240/40%)] p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-[oklch(0.96_0_0)]">Damage Reports</h2>
            <span className="ml-auto rounded-full bg-[oklch(0.22_0.01_230)] px-2 py-0.5 text-xs tabular-nums text-[oklch(0.55_0_0)]">
              {frames.length}
            </span>
          </div>

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
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="rounded-full bg-[oklch(0.18_0_0)] p-4">
                <AlertTriangle className="h-6 w-6 text-[oklch(0.35_0_0)]" />
              </div>
              <p className="text-sm text-[oklch(0.45_0_0)]">Waiting for incoming frames…</p>
            </div>
          ) : (
            <ul className="divide-y divide-[oklch(0.24_0.005_240/60%)]">
              {sorted.map((frame, idx) => {
                const level = getSeverityLevel(frame.severity)
                const config = SEVERITY_CONFIG[level]
                return (
                  <li
                    key={`${frame.frame_id}-${idx}`}
                    className="group flex flex-col gap-1.5 px-5 py-4 transition-colors duration-150 hover:bg-[oklch(0.16_0.005_240/60%)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="max-w-[160px] truncate text-sm font-medium text-[oklch(0.92_0_0)]">
                        {frame.label.replace(/_/g, " ")}
                      </span>
                      <SeverityBadge score={frame.severity} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
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
          )}
        </div>
      </aside>
    </>
  )
}
