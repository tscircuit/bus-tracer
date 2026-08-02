import type { BusTracerSimpleRouteJson, RoutePoint } from "./types"

export type Point = { x: number; y: number }

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export const pointToSegmentDistance = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return distance(point, a)

  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  )
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy })
}

export const pointToPolylineDistance = (point: Point, polyline: Point[]) => {
  if (polyline.length === 0) return 0
  if (polyline.length === 1) return distance(point, polyline[0]!)

  let minimum = Number.POSITIVE_INFINITY
  for (let index = 0; index < polyline.length - 1; index++) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistance(point, polyline[index]!, polyline[index + 1]!),
    )
  }
  return minimum
}

const rotateIntoObstacleSpace = (
  point: Point,
  center: Point,
  ccwRotationDegrees = 0,
) => {
  if (!ccwRotationDegrees) return point
  const radians = (-ccwRotationDegrees * Math.PI) / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

export const isPointInsideObstacle = (
  point: Point,
  obstacle: BusTracerSimpleRouteJson["obstacles"][number],
  padding = 0,
) => {
  const rotated = rotateIntoObstacleSpace(
    point,
    obstacle.center,
    obstacle.ccwRotationDegrees,
  )
  return (
    Math.abs(rotated.x - obstacle.center.x) <= obstacle.width / 2 + padding &&
    Math.abs(rotated.y - obstacle.center.y) <= obstacle.height / 2 + padding
  )
}

export const simplifyRoutePoints = (points: RoutePoint[]): RoutePoint[] => {
  const deduplicated: RoutePoint[] = []
  for (const point of points) {
    const previous = deduplicated.at(-1)
    if (
      previous &&
      previous.x === point.x &&
      previous.y === point.y &&
      previous.layer === point.layer
    ) {
      continue
    }
    deduplicated.push(point)
  }

  if (deduplicated.length < 3) return deduplicated
  const simplified = [deduplicated[0]!]
  for (let index = 1; index < deduplicated.length - 1; index++) {
    const previous = simplified.at(-1)!
    const current = deduplicated[index]!
    const next = deduplicated[index + 1]!
    if (previous.layer !== current.layer || current.layer !== next.layer) {
      simplified.push(current)
      continue
    }
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x)
    if (Math.abs(cross) > 1e-9) simplified.push(current)
  }
  simplified.push(deduplicated.at(-1)!)
  return simplified
}

export const getOffsetPolyline = (
  points: RoutePoint[],
  offset: number,
): RoutePoint[] =>
  points.map((point, index) => {
    let previous: RoutePoint | undefined = points[index - 1]
    let next: RoutePoint | undefined = points[index + 1]
    if (previous?.layer !== point.layer) previous = undefined
    if (next?.layer !== point.layer) next = undefined
    const from = previous ?? point
    const to = next ?? point
    const dx = to.x - from.x
    const dy = to.y - from.y
    const magnitude = Math.hypot(dx, dy) || 1
    return {
      x: point.x + (-dy / magnitude) * offset,
      y: point.y + (dx / magnitude) * offset,
      layer: point.layer,
    }
  })

export const getPolylineLength = (points: Point[]) => {
  let length = 0
  for (let index = 0; index < points.length - 1; index++) {
    length += distance(points[index]!, points[index + 1]!)
  }
  return length
}
