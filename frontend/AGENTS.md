# agents.md — Drone Damage Mapper

## Status: Phase 1 + Phase 2 complete

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
├── SeveritySidebar    (z-30, left panel, collapsible)
└── BottomDock         (z-50, fixed bottom-center)
```

### Key Components
| Path | Purpose |
|------|---------|
| `components/live-map.tsx` | Full-viewport MapLibre GL map, renders severity markers, popups, auto-pan |
| `components/severity-sidebar.tsx` | Collapsible left sidebar, severity-sorted frame list |
| `components/bottom-dock.tsx` | Frosted-glass bottom dock with magnification hover |
| `components/severity-badge.tsx` | Reusable badge for severity scores |
| `lib/severity.ts` | `getSeverityLevel()` helper + `SEVERITY_CONFIG` lookup table |

### Map Details
- Style: OpenFreeMap `bright` — `https://tiles.openfreemap.org/styles/bright`
- Default pitch: 45°, bearing: -17.6°
- 3D buildings via `fill-extrusion` layer injected on map load
- Auto-pan to latest marker only when it falls outside the current viewport

### Design Tokens (globals.css)
- `--severity-low` / `--severity-moderate` / `--severity-severe` — green / amber / red
- `--surface` — frosted glass panel background (`oklch(0.13 0.005 240 / 75%)`)
- `--surface-border` — panel border

---

## Pending Phases
- **Phase 3:** Right sidebar — Priority Response Panel with "Mark as Responded"
- **Phase 4:** Top status bar — connection dot, frame count, last frame time
- **Phase 5:** Polish — responsive bottom sheets, Framer Motion transitions, full colour audit
