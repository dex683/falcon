# agents.md — Drone Damage Mapper

## Status: Phase 1 + Phase 2 complete + Single-Page Dock Refactor + Simulator Deployment Design

---

## Architecture

### Context
- `context/SocketContext.tsx` — Provides `SocketProvider` and `useSocket()` hook.
  - Connects to `NEXT_PUBLIC_SOCKET_URL` via Socket.IO if env var is set.
  - Falls back to **demo mode** (simulated random frames every 4 s) when no URL is configured.
  - Exposes: `status`, `latestFrame`, `frames` (max 200, newest-first), `frameCount`, `lastFrameAt`.
  - Frame shape: `{ frame_id, lat, lng, severity, label, receivedAt }`.

### Routing
- `/` → redirects to `/dashboard`
- `/dashboard` — main page (`app/dashboard/page.tsx`)

### Component Tree (`/dashboard`)
```
DashboardPage
├── LiveMap            (z-0, fixed inset-0) — MapLibre GL via react-map-gl
├── SeveritySidebar    (z-30, floating rounded side menu, collapsible)
└── BottomDock         (z-50, fixed bottom-center, in-page view switcher)
```

### Key Components
| Path | Purpose |
|------|---------|
| `components/live-map.tsx` | Full-viewport MapLibre GL map, renders severity markers, popups, auto-pan |
| `components/severity-sidebar.tsx` | Floating rounded side menu that renders Map / Settings / Simulation content |
| `components/bottom-dock.tsx` | Frosted-glass bottom dock with magnification hover and local view switching |
| `components/severity-badge.tsx` | Reusable badge for severity scores |
| `lib/simulator.ts` | Simulator domain types + geospatial helpers for circle drawing and drone movement |
| `lib/severity.ts` | `getSeverityLevel()` helper + `SEVERITY_CONFIG` lookup table |

### Map Details
- Style: OpenFreeMap `bright` — `https://tiles.openfreemap.org/styles/bright`
- Default pitch: 45°, bearing: -17.6°
- 3D buildings via `fill-extrusion` layer injected on map load
- Auto-pan to latest marker only when it falls outside the current viewport

### Single-Page View Model
- Dock items now switch local dashboard state instead of navigating routes.
- Views in dock: `map`, `settings`, `simulation`.
- All content remains in `/dashboard` and overlays the live map.
- Settings are local state for `autoPan`, simulation interval, and max visible reports.
- Simulation view can start/stop timed frame generation, deploy one frame, and clear generated frames.
- Simulated frames are merged with socket frames for both map markers and severity ranking.

### Simulator Model
- Simulator supports multiple deployments by drawing multiple circles on the map.
- Circle drawing flow: first click sets center, second click sets radius.
- Deploy action creates one coverage zone + configurable number of drones per zone.
- Drones are shown live on-map and move continuously inside their assigned circle bounds.
- Every simulation tick generates synthetic image-coordinate payloads (frontend queue only; backend endpoint not implemented yet).
- Payloads are reflected as simulated frames and merged into live severity/map streams.

### Design Tokens (globals.css)
- `--severity-low` / `--severity-moderate` / `--severity-severe` — green / amber / red
- `--surface` — frosted glass panel background (`oklch(0.13 0.005 240 / 75%)`)
- `--surface-border` — panel border

---

## Pending Phases
- **Phase 3:** Right sidebar — Priority Response Panel with "Mark as Responded"
- **Phase 4:** Top status bar — connection dot, frame count, last frame time
- **Phase 5:** Polish — responsive bottom sheets, Framer Motion transitions, full colour audit

## Recent Decisions
- Reused existing `SeveritySidebar` component file to avoid churn, but changed behavior into a floating menu (not attached to viewport edge).
- Kept map full-screen in all views so the dock truly acts as an in-page mode selector.
- Introduced local simulation controls without any Next.js API routes (frontend-only state).
- Added simulator geospatial helpers in `lib/simulator.ts` to centralize distance, circle polygon, and point sampling logic.
- Kept backend dispatch as an in-memory queue (design-ready for real API/socket integration later).
