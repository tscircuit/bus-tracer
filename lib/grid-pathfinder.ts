import { pointToPolylineDistance, simplifyRoutePoints } from "./geometry"
import { MinHeap } from "./min-heap"
import type { RoutePoint } from "./types"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type GridState = { ix: number; iy: number; layerIndex: number }

export type GridPathfinderParams = {
  start: RoutePoint
  goal: RoutePoint
  layers: string[]
  bounds: Bounds
  cellSize: number
  viaPenalty: number
  isBlocked: (point: { x: number; y: number }, layer: string) => boolean
  guide?: Array<{ x: number; y: number }>
  guidePenalty?: number
  allowLayerChanges?: boolean
}

const stateKey = (state: GridState) =>
  `${state.ix}:${state.iy}:${state.layerIndex}`

const isSamePosition = (first: RoutePoint, second: RoutePoint) =>
  first.x === second.x && first.y === second.y

/**
 * Keep every layer change at one physical coordinate. A grid path can change
 * through several adjacent layer states at the same cell, but that represents
 * one plated through-via in the routed output rather than a stack of vias.
 *
 * Replacing the first and last grid points with the exact terminals can also
 * move one endpoint away from a layer change. Add a short planar escape before
 * collapsing the layer stack so we never emit a diagonal layer transition.
 */
const normalizeLayerTransitions = (points: RoutePoint[]) => {
  const normalized = points.map((point) => ({ ...point }))
  if (normalized.length < 2) return normalized

  const first = normalized[0]!
  const second = normalized[1]!
  if (first.layer !== second.layer && !isSamePosition(first, second)) {
    normalized.splice(1, 0, { ...second, layer: first.layer })
  }

  const last = normalized.at(-1)!
  const penultimate = normalized.at(-2)!
  if (penultimate.layer !== last.layer && !isSamePosition(penultimate, last)) {
    normalized.splice(normalized.length - 1, 0, {
      ...last,
      layer: penultimate.layer,
    })
  }

  const collapsed: RoutePoint[] = []
  for (let startIndex = 0; startIndex < normalized.length; ) {
    let endIndex = startIndex + 1
    while (
      endIndex < normalized.length &&
      isSamePosition(normalized[startIndex]!, normalized[endIndex]!)
    ) {
      endIndex++
    }
    collapsed.push(normalized[startIndex]!)
    if (endIndex - startIndex > 1) {
      collapsed.push(normalized[endIndex - 1]!)
    }
    startIndex = endIndex
  }

  return collapsed
}

export const findGridPath = (params: GridPathfinderParams): RoutePoint[] => {
  const { bounds, cellSize, layers } = params
  const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSize))
  const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cellSize))
  const toGrid = (point: RoutePoint): GridState => ({
    ix: Math.max(
      0,
      Math.min(width, Math.round((point.x - bounds.minX) / cellSize)),
    ),
    iy: Math.max(
      0,
      Math.min(height, Math.round((point.y - bounds.minY) / cellSize)),
    ),
    layerIndex: layers.indexOf(point.layer),
  })
  const toPoint = (state: GridState) => ({
    x: bounds.minX + state.ix * cellSize,
    y: bounds.minY + state.iy * cellSize,
  })
  const start = toGrid(params.start)
  const goal = toGrid(params.goal)
  if (start.layerIndex < 0 || goal.layerIndex < 0) {
    throw new Error(
      `Path endpoint uses an unavailable layer (${params.start.layer} -> ${params.goal.layer})`,
    )
  }

  const startKey = stateKey(start)
  const goalKey = stateKey(goal)
  const open = new MinHeap<GridState>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const cameFrom = new Map<string, string>()
  const states = new Map<string, GridState>([[startKey, start]])
  const closed = new Set<string>()
  const heuristic = (state: GridState) =>
    Math.hypot(state.ix - goal.ix, state.iy - goal.iy) * cellSize +
    Math.abs(state.layerIndex - goal.layerIndex) * params.viaPenalty
  open.push(start, heuristic(start))

  const planarMoves = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const

  const isStateBlocked = (state: GridState) => {
    const key = stateKey(state)
    if (key === startKey || key === goalKey) return false
    return params.isBlocked(toPoint(state), layers[state.layerIndex]!)
  }

  const isPlanarMoveBlocked = (from: GridState, to: GridState) => {
    if (isStateBlocked(to)) return true
    const fromPoint = toPoint(from)
    const toPointValue = toPoint(to)
    const layer = layers[to.layerIndex]!
    const samples = [0.25, 0.5, 0.75]
    for (const t of samples) {
      if (
        params.isBlocked(
          {
            x: fromPoint.x + (toPointValue.x - fromPoint.x) * t,
            y: fromPoint.y + (toPointValue.y - fromPoint.y) * t,
          },
          layer,
        )
      ) {
        return true
      }
    }
    return false
  }

  while (open.size > 0) {
    const current = open.pop()!
    const currentKey = stateKey(current)
    if (closed.has(currentKey)) continue
    if (currentKey === goalKey) {
      const pathKeys = [goalKey]
      while (pathKeys[0] !== startKey) {
        const previous = cameFrom.get(pathKeys[0]!)
        if (!previous) throw new Error("Could not reconstruct the grid path")
        pathKeys.unshift(previous)
      }
      const route = pathKeys.map((key) => {
        const state = states.get(key)!
        const point = toPoint(state)
        return { ...point, layer: layers[state.layerIndex]! }
      })
      if (
        route.length === 1 &&
        (params.start.x !== params.goal.x ||
          params.start.y !== params.goal.y ||
          params.start.layer !== params.goal.layer)
      ) {
        return simplifyRoutePoints([{ ...params.start }, { ...params.goal }])
      }
      route[0] = { ...params.start }
      route[route.length - 1] = { ...params.goal }
      return simplifyRoutePoints(normalizeLayerTransitions(route))
    }
    closed.add(currentKey)

    const neighbors: Array<{ state: GridState; movementCost: number }> = []
    for (const [dx, dy] of planarMoves) {
      const neighbor = {
        ix: current.ix + dx,
        iy: current.iy + dy,
        layerIndex: current.layerIndex,
      }
      if (
        neighbor.ix < 0 ||
        neighbor.ix > width ||
        neighbor.iy < 0 ||
        neighbor.iy > height ||
        isPlanarMoveBlocked(current, neighbor)
      ) {
        continue
      }
      if (dx !== 0 && dy !== 0) {
        const sideA = { ...current, ix: current.ix + dx }
        const sideB = { ...current, iy: current.iy + dy }
        if (isStateBlocked(sideA) || isStateBlocked(sideB)) continue
      }
      neighbors.push({
        state: neighbor,
        movementCost: Math.hypot(dx, dy) * cellSize,
      })
    }

    if (params.allowLayerChanges !== false) {
      for (const delta of [-1, 1]) {
        const neighbor = {
          ...current,
          layerIndex: current.layerIndex + delta,
        }
        if (neighbor.layerIndex < 0 || neighbor.layerIndex >= layers.length)
          continue
        if (isStateBlocked(current) || isStateBlocked(neighbor)) continue
        neighbors.push({ state: neighbor, movementCost: params.viaPenalty })
      }
    }

    for (const { state: neighbor, movementCost } of neighbors) {
      const neighborKey = stateKey(neighbor)
      if (closed.has(neighborKey)) continue
      const guideCost = params.guide
        ? pointToPolylineDistance(toPoint(neighbor), params.guide) *
          (params.guidePenalty ?? 0)
        : 0
      const tentative =
        (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) +
        movementCost +
        guideCost
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue
      }
      cameFrom.set(neighborKey, currentKey)
      states.set(neighborKey, neighbor)
      gScore.set(neighborKey, tentative)
      open.push(neighbor, tentative + heuristic(neighbor))
    }
  }

  throw new Error(
    `No path found from (${params.start.x}, ${params.start.y}, ${params.start.layer}) to ` +
      `(${params.goal.x}, ${params.goal.y}, ${params.goal.layer})`,
  )
}
