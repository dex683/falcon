
import type { CoverageCircle } from "./simulator"

export interface PriorityLocation {
  lat: number
  lng: number
  reason: string
}

export interface ZoneReport {
  overall_severity: number
  summary: string
  key_insights: string[]
  rescue_plan: string[]
  priority_locations: PriorityLocation[]
}

export async function generatePdfReport(
  zone: CoverageCircle,
  report: ZoneReport,
  mapImageBase64: string | null
): Promise<void> {
  const { jsPDF } = await import("jspdf")

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  let cursorY = 20

  // Title
  doc.setFont("helvetica", "bold")
  doc.setFontSize(22)
  doc.text("Zone Intelligence Report", 15, cursorY)
  cursorY += 10

  // Zone Info
  doc.setFont("helvetica", "normal")
  doc.setFontSize(12)
  const locationText = zone.locationName || `Zone ${zone.id.substring(0, 6)}`
  doc.text(`Location: ${locationText}`, 15, cursorY)
  cursorY += 6
  doc.text(`Severity Score: ${report.overall_severity} / 10`, 15, cursorY)
  cursorY += 10

  // Map Image
  if (mapImageBase64) {
    // A4 width is 210mm. Subtract 30 (15 margins). Width = 180.
    const imgWidth = 180
    // Fix aspect ratio assuming 16:9 roughly for the map view, or just 180x100
    const imgHeight = 100
    try {
      doc.addImage(mapImageBase64, "PNG", 15, cursorY, imgWidth, imgHeight)
      cursorY += imgHeight + 10
    } catch (e) {
      console.warn("Could not embed map image in PDF:", e)
    }
  } else {
    // If no map available
    doc.setFont("helvetica", "italic")
    doc.text("Map visual unavailable.", 15, cursorY)
    cursorY += 10
  }

  // Helper for wrapping text
  const addWrappedText = (text: string, x: number, y: number, maxWidth: number) => {
    const lines = doc.splitTextToSize(text, maxWidth)
    doc.text(lines, x, y)
    // Return distance advanced: roughly 6mm per line
    return lines.length * 6
  }

  const maxWidth = pageWidth - 30

  // Summary
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text("Situation Summary", 15, cursorY)
  cursorY += 6
  
  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  cursorY += addWrappedText(report.summary, 15, cursorY, maxWidth)
  cursorY += 6

  // Key Insights
  if (report.key_insights && report.key_insights.length > 0) {
    if (cursorY > 250) {
      doc.addPage()
      cursorY = 20
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("Key Insights", 15, cursorY)
    cursorY += 6

    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    report.key_insights.forEach((insight) => {
      if (cursorY > 270) {
        doc.addPage()
        cursorY = 20
      }
      cursorY += addWrappedText(`• ${insight}`, 15, cursorY, maxWidth)
    })
    cursorY += 6
  }

  // Rescue Plan
  if (report.rescue_plan && report.rescue_plan.length > 0) {
    if (cursorY > 250) {
      doc.addPage()
      cursorY = 20
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("Recommended Rescue Plan", 15, cursorY)
    cursorY += 6

    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    report.rescue_plan.forEach((step, idx) => {
      if (cursorY > 270) {
        doc.addPage()
        cursorY = 20
      }
      cursorY += addWrappedText(`${idx + 1}. ${step}`, 15, cursorY, maxWidth)
    })
    cursorY += 6
  }

  // Priority Locations
  if (report.priority_locations && report.priority_locations.length > 0) {
    if (cursorY > 250) {
      doc.addPage()
      cursorY = 20
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text("Priority Locations", 15, cursorY)
    cursorY += 6

    doc.setFont("helvetica", "normal")
    doc.setFontSize(11)
    report.priority_locations.forEach((loc) => {
      if (cursorY > 270) {
        doc.addPage()
        cursorY = 20
      }
      cursorY += addWrappedText(`[${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}]: ${loc.reason}`, 15, cursorY, maxWidth)
    })
  }

  doc.save(`Zone_Report_${zone.id.substring(0, 6)}.pdf`)
}
