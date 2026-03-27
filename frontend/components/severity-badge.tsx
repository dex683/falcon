import { getSeverityLevel, SEVERITY_CONFIG } from "@/lib/severity"

interface SeverityBadgeProps {
  score: number
  className?: string
}

export function SeverityBadge({ score, className = "" }: SeverityBadgeProps) {
  const level = getSeverityLevel(score)
  const config = SEVERITY_CONFIG[level]

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${config.badgeClass} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      {score.toFixed(1)}
    </span>
  )
}
