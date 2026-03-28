"use client"

import { useRef } from "react"
import { Map, Settings2, Plane } from "lucide-react"
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react"
import { cn } from "@/lib/utils"

/* ─── config ─────────────────────────────────────────────────────────── */

const BASE_SIZE = 48
const MAX_SIZE  = 64
const RANGE     = 140           // px influence radius on either side

const SPRING_CFG = { mass: 1, stiffness: 800, damping: 100 }

export type DashboardView = "map" | "settings" | "simulation"

interface NavItem {
  icon: React.ElementType
  label: string
  view: DashboardView
}

const NAV_ITEMS: NavItem[] = [
  { icon: Map, label: "Main Map", view: "map" },
  { icon: Settings2, label: "Settings", view: "settings" },
  { icon: Plane, label: "Simulation", view: "simulation" },
]

/* ─── single icon ────────────────────────────────────────────────────── */

function DockIcon({
  item,
  mouseX,
  isActive,
  onSelect,
}: {
  item: NavItem
  mouseX: MotionValue<number>
  isActive: boolean
  onSelect: (view: DashboardView) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // distance from cursor centre to this icon's centre
  const distance = useTransform(mouseX, (mx) => {
    const el = ref.current
    if (!el) return RANGE + 1
    const rect = el.getBoundingClientRect()
    return mx - (rect.x + rect.width / 2)
  })

  // map distance → size
  const sizePx  = useTransform(distance, [-RANGE, 0, RANGE], [BASE_SIZE, MAX_SIZE, BASE_SIZE])
  const size    = useSpring(sizePx, SPRING_CFG)

  // lift icon upward as it grows
  const liftPx  = useTransform(size, [BASE_SIZE, MAX_SIZE], [0, -6])
  const lift    = useSpring(liftPx, SPRING_CFG)

  // icon scale relative to container
  const iconScale = useTransform(size, [BASE_SIZE, MAX_SIZE], [1, 1.18])
  const iconScaleSpring = useSpring(iconScale, SPRING_CFG)

  const Icon = item.icon

  return (
    <motion.button
      type="button"
      ref={ref}
      onClick={() => onSelect(item.view)}
      style={{ width: size, height: size, y: lift }}
      className={cn(
        "group relative flex shrink-0 items-center justify-center rounded-xl",
        "transition-[background-color,box-shadow] duration-150",
        isActive
          ? "bg-[oklch(0.65_0.18_220/18%)] shadow-[0_0_0_1px_oklch(0.65_0.18_220/28%)]"
          : "hover:bg-[oklch(1_0_0/6%)]",
      )}
      aria-label={item.label}
      aria-current={isActive ? "true" : undefined}
    >
      {/* icon — separately scaled so stroke-width stays sharp */}
      <motion.div
        style={{ scale: iconScaleSpring }}
        className="flex items-center justify-center"
      >
        <Icon
          className={cn(
            "h-5 w-5 transition-colors duration-150",
            isActive
              ? "text-[oklch(0.65_0.18_220)]"
              : "text-[oklch(0.50_0_0)] group-hover:text-[oklch(0.92_0_0)]",
          )}
          strokeWidth={isActive ? 2.5 : 1.75}
        />
      </motion.div>

      {/* active indicator dot */}
      {isActive && (
        <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[oklch(0.65_0.18_220)]" />
      )}

      {/* tooltip */}
      <span
        className={cn(
          "pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2",
          "whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium tracking-wide",
          "bg-[oklch(0.18_0.005_240/95%)] text-[oklch(0.80_0_0)]",
          "border border-[oklch(0.35_0.01_240/50%)]",
          "opacity-0 scale-90",
          "group-hover:opacity-100 group-hover:scale-100",
          "transition-[opacity,transform] duration-150",
        )}
        aria-hidden
      >
        {item.label}
      </span>
    </motion.button>
  )
}

/* ─── dock shell ─────────────────────────────────────────────────────── */

export function BottomDock({
  activeView,
  onSelect,
}: {
  activeView: DashboardView
  onSelect: (view: DashboardView) => void
}) {
  const mouseX  = useMotionValue(Infinity)   // Infinity = "no cursor"

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className={cn(
          "flex items-end gap-1.5 px-3 pb-3 pt-2",
          "rounded-2xl",
          /* frosted-glass surface — uses design token colours */
          "bg-[oklch(0.13_0.005_240/80%)] backdrop-blur-2xl",
          "border border-[oklch(0.35_0.01_240/40%)]",
          "shadow-[0_8px_32px_oklch(0_0_0/50%),inset_0_1px_0_oklch(1_0_0/8%)]",
        )}
      >
        {NAV_ITEMS.map((item) => (
          <DockIcon
            key={item.view}
            item={item}
            mouseX={mouseX}
            isActive={item.view === activeView}
            onSelect={onSelect}
          />
        ))}
      </motion.div>
    </div>
  )
}
