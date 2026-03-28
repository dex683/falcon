export interface CoverageCircle {
  id: string
  centerLat: number
  centerLng: number
  radiusMeters: number
  createdAt: number
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
  spiralProgressRad: number
  spiralAngleOffsetRad: number
  spiralDirection: 1 | -1
  spiralSpacingMeters: number
  spiralOuterRadiusMeters: number
  spiralCompleted: boolean
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

export interface SpiralStepInput {
  centerLat: number
  centerLng: number
  outerRadiusMeters: number
  spacingMeters: number
  progressRad: number
  angleOffsetRad: number
  direction: 1 | -1
  speedMs: number
  dtSeconds: number
}

export interface SpiralStepResult {
  lat: number
  lng: number
  nextProgressRad: number
  completed: boolean
  radiusMeters: number
}

export function stepInwardSpiralConstantSpeed(input: SpiralStepInput): SpiralStepResult {
  const outerRadius = Math.max(0, input.outerRadiusMeters)
  const spacing = Math.max(1, input.spacingMeters)
  const b = spacing / (Math.PI * 2) // radial drop per radian
  const dt = Math.max(0, input.dtSeconds)
  const speed = Math.max(0, input.speedMs)
  const theta = Math.max(0, input.progressRad)

  const radiusNow = Math.max(0, outerRadius - b * theta)
  if (radiusNow <= 0 || outerRadius <= 0) {
    return {
      lat: input.centerLat,
      lng: input.centerLng,
      nextProgressRad: theta,
      completed: true,
      radiusMeters: 0,
    }
  }

  const dsDtheta = Math.sqrt(radiusNow * radiusNow + b * b)
  const dTheta = dsDtheta > 0 ? (speed * dt) / dsDtheta : 0
  const nextTheta = theta + dTheta
  const radiusNext = Math.max(0, outerRadius - b * nextTheta)

  const bearing = input.direction * (nextTheta + input.angleOffsetRad)
  const nextPos = pointOffset(input.centerLat, input.centerLng, radiusNext, bearing)

  return {
    lat: nextPos.lat,
    lng: nextPos.lng,
    nextProgressRad: nextTheta,
    completed: radiusNext <= 0,
    radiusMeters: radiusNext,
  }
}
