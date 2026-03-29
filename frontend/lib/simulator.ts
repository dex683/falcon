export interface CoverageCircle {
  id: string
  centerLat: number
  centerLng: number
  radiusMeters: number
  createdAt: number
  locationName?: string
  populationDensity?: number
  addressType?: string
  resolved?: boolean
}

export interface CircleDraft {
  centerLat: number
  centerLng: number
  radiusMeters: number
}

export interface DeployedDrone {
  id: string
  label: string
  zoneId: string
  centerLat: number
  centerLng: number
  radiusMeters: number
  lat: number
  lng: number
  // Lawnmower path state
  waypoints: [number, number][]   // [lat, lng] pairs
  waypointIndex: number           // index of next target waypoint
  waypointProgressMeters: number  // metres travelled toward current waypoint
  pathCompleted: boolean
  updatedAt: number
}

export interface SimulatorDispatchPayload {
  id: string
  droneId: string
  zoneId: string
  imageId: string
  lat: number
  lng: number
  createdAt: number
}

interface GeoJsonPolygonFeature {
  type: "Feature"
  properties: Record<string, string | number>
  geometry: {
    type: "Polygon"
    coordinates: number[][][]
  }
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection"
  features: GeoJsonPolygonFeature[]
}

const EARTH_RADIUS_METERS = 6371000

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}

export function distanceMeters(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
) {
  const phi1 = toRadians(startLat)
  const phi2 = toRadians(endLat)
  const dPhi = toRadians(endLat - startLat)
  const dLambda = toRadians(endLng - startLng)

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2)

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function pointOffset(
  centerLat: number,
  centerLng: number,
  distanceFromCenterMeters: number,
  bearingRadians: number
) {
  const angularDistance = distanceFromCenterMeters / EARTH_RADIUS_METERS
  const lat1 = toRadians(centerLat)
  const lng1 = toRadians(centerLng)

  const sinLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)
  const sinAngular = Math.sin(angularDistance)
  const cosAngular = Math.cos(angularDistance)

  const lat2 = Math.asin(
    sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearingRadians)
  )

  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRadians) * sinAngular * cosLat1,
      cosAngular - sinLat1 * Math.sin(lat2)
    )

  return {
    lat: toDegrees(lat2),
    lng: toDegrees(lng2),
  }
}

export function randomPointInCircle(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
) {
  const radius = Math.sqrt(Math.random()) * radiusMeters
  const angle = Math.random() * Math.PI * 2
  return pointOffset(centerLat, centerLng, radius, angle)
}

export function buildCircleFeature(circle: CircleDraft | CoverageCircle, points = 64): GeoJsonPolygonFeature {
  const polygon: number[][] = []

  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2
    const pt = pointOffset(circle.centerLat, circle.centerLng, circle.radiusMeters, angle)
    polygon.push([pt.lng, pt.lat])
  }

  return {
    type: "Feature",
    properties: {
      id: "id" in circle ? circle.id : "draft",
      radiusMeters: circle.radiusMeters,
    },
    geometry: {
      type: "Polygon",
      coordinates: [polygon],
    },
  }
}

export function buildCoverageCollection(circles: CoverageCircle[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: circles.map((circle) => buildCircleFeature(circle)),
  }
}

export function metersOffsetFromLatLng(
  centerLat: number,
  centerLng: number,
  lat: number,
  lng: number
) {
  // Equirectangular approximation: accurate enough for small radii (< a few km)
  const dLat = toRadians(lat - centerLat)
  const dLng = toRadians(lng - centerLng)
  const cosLat = Math.cos(toRadians(centerLat))

  const x = dLng * EARTH_RADIUS_METERS * cosLat
  const y = dLat * EARTH_RADIUS_METERS

  return { x, y }
}

export function isInsideCircleMeters(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  lat: number,
  lng: number
) {
  const { x, y } = metersOffsetFromLatLng(centerLat, centerLng, lat, lng)
  return Math.sqrt(x * x + y * y) <= radiusMeters
}

export function areaCellKeyForLatLng(
  centerLat: number,
  centerLng: number,
  lat: number,
  lng: number,
  cellSizeMeters: number
) {
  const size = Number.isFinite(cellSizeMeters) ? Math.max(5, cellSizeMeters) : 20
  const { x, y } = metersOffsetFromLatLng(centerLat, centerLng, lat, lng)
  const cellX = Math.floor(x / size)
  const cellY = Math.floor(y / size)
  return `${cellX},${cellY}`
}

// ─── Lawnmower (Boustrophedon) Path ──────────────────────────────────────────

// Flight constants (match backend drone_simulator.py)
const ALTITUDE_M   = 100
const FOV_DEG      = 90
const OVERLAP_PCT  = 0.75
// footprint = 2 * altitude * tan(FOV/2)
const FOOTPRINT_M  = 2 * ALTITUDE_M * Math.tan((FOV_DEG / 2) * (Math.PI / 180))
const STRIP_SPACING_M = FOOTPRINT_M * (1 - OVERLAP_PCT)  // 25 m at defaults

export function generateLawnmowerWaypoints(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): [number, number][] {
  const DEG_PER_M_LAT = 1 / 111320
  const DEG_PER_M_LNG = 1 / (111320 * Math.cos(centerLat * (Math.PI / 180)))

  const radiusLat = radiusMeters * DEG_PER_M_LAT
  const radiusLng = radiusMeters * DEG_PER_M_LNG
  const stripDeg  = STRIP_SPACING_M * DEG_PER_M_LNG

  const waypoints: [number, number][] = []
  let lngOffset = -radiusLng
  let direction = 1  // +1 south→north, -1 north→south

  while (lngOffset <= radiusLng) {
    const frac = radiusLng > 0 ? (lngOffset / radiusLng) ** 2 : 0
    const halfChordLat = radiusLat * Math.sqrt(Math.max(0, 1 - frac))

    const latStart = centerLat + (direction === 1 ? -halfChordLat : halfChordLat)
    const latEnd   = centerLat + (direction === 1 ?  halfChordLat : -halfChordLat)

    waypoints.push([latStart, centerLng + lngOffset])
    waypoints.push([latEnd,   centerLng + lngOffset])

    lngOffset += stripDeg
    direction  *= -1
  }

  return waypoints
}

export interface LawnmowerStepInput {
  drone: DeployedDrone
  speedMs: number
  dtSeconds: number
}

export interface LawnmowerStepResult {
  lat: number
  lng: number
  waypointIndex: number
  waypointProgressMeters: number
  completed: boolean
}

export function stepLawnmower(input: LawnmowerStepInput): LawnmowerStepResult {
  const { drone, speedMs, dtSeconds } = input
  const { waypoints } = drone

  if (!waypoints || waypoints.length === 0 || drone.waypointIndex >= waypoints.length - 1) {
    return {
      lat: drone.lat,
      lng: drone.lng,
      waypointIndex: drone.waypointIndex,
      waypointProgressMeters: drone.waypointProgressMeters,
      completed: true,
    }
  }

  // Convert lon difference to metres using cos(lat) scaling
  const DEG_TO_M_LAT = 111320
  const DEG_TO_M_LNG = 111320 * Math.cos(drone.centerLat * (Math.PI / 180))

  let remaining = speedMs * dtSeconds  // metres to travel this tick
  let idx  = drone.waypointIndex
  let lat  = drone.lat
  let lng  = drone.lng

  while (remaining > 0 && idx < waypoints.length - 1) {
    const [tLat, tLng] = waypoints[idx + 1]
    const dLat = (tLat - lat) * DEG_TO_M_LAT
    const dLng = (tLng - lng) * DEG_TO_M_LNG
    const distToNext = Math.hypot(dLat, dLng)

    if (distToNext < 0.001) {
      // Already at this waypoint, advance
      lat = tLat
      lng = tLng
      idx += 1
      continue
    }

    if (remaining >= distToNext) {
      lat = tLat
      lng = tLng
      remaining -= distToNext
      idx += 1
    } else {
      const t = remaining / distToNext
      lat += (tLat - lat) * t
      lng += (tLng - lng) * t
      remaining = 0
    }
  }

  const completed = idx >= waypoints.length - 1

  return {
    lat,
    lng,
    waypointIndex: idx,
    waypointProgressMeters: 0,
    completed,
  }
}
