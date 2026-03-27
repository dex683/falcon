export type SeverityLevel = "low" | "moderate" | "severe"

export function getSeverityLevel(score: number): SeverityLevel {
  if (score <= 3) return "low"
  if (score <= 6) return "moderate"
  return "severe"
}

export const SEVERITY_CONFIG = {
  low: {
    label: "Low",
    color: "oklch(0.72 0.19 142)",
    bgColor: "oklch(0.72 0.19 142 / 15%)",
    badgeClass: "bg-[oklch(0.72_0.19_142/15%)] text-[oklch(0.72_0.19_142)] border-[oklch(0.72_0.19_142/30%)]",
    dotClass: "bg-[oklch(0.72_0.19_142)]",
    hex: "#4ade80",
  },
  moderate: {
    label: "Moderate",
    color: "oklch(0.75 0.17 60)",
    bgColor: "oklch(0.75 0.17 60 / 15%)",
    badgeClass: "bg-[oklch(0.75_0.17_60/15%)] text-[oklch(0.75_0.17_60)] border-[oklch(0.75_0.17_60/30%)]",
    dotClass: "bg-[oklch(0.75_0.17_60)]",
    hex: "#facc15",
  },
  severe: {
    label: "Severe",
    color: "oklch(0.62 0.23 25)",
    bgColor: "oklch(0.62 0.23 25 / 15%)",
    badgeClass: "bg-[oklch(0.62_0.23_25/15%)] text-[oklch(0.62_0.23_25)] border-[oklch(0.62_0.23_25/30%)]",
    dotClass: "bg-[oklch(0.62_0.23_25)]",
    hex: "#ef4444",
  },
} as const
