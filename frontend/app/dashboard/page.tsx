"use client"

import { useState } from "react"
import { useSocket } from "@/context/SocketContext"
import { SeveritySidebar } from "@/components/severity-sidebar"
import { BottomDock } from "@/components/bottom-dock"
import dynamic from "next/dynamic"

// Dynamically import the map to avoid SSR issues with maplibre-gl
const LiveMap = dynamic(() => import("@/components/live-map").then((m) => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-0 animate-pulse bg-[oklch(0.10_0_0)]" aria-label="Loading map" />
  ),
})

export default function DashboardPage() {
  const { frames, latestFrame } = useSocket()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[oklch(0.10_0_0)]">
      {/* Layer 0: Full-viewport map */}
      <LiveMap frames={frames} latestFrame={latestFrame} />

      {/* Layer 1: Severity sidebar */}
      <SeveritySidebar
        frames={frames}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* Layer 2: Bottom dock */}
      <BottomDock />
    </main>
  )
}
