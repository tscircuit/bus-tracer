import { isPointInsideObstacle } from "./geometry"
import { getLayerIndex } from "./layer-names"
import type { BusTracerSimpleRouteJson } from "./types"

type BlockerOptions = {
  padding: number
  ignoredConnectionIds?: Set<string>
  ignoreObstacleShortSideBelow?: number
  extraBlocked?: (point: { x: number; y: number }, layer: string) => boolean
}

const obstacleBlocksLayer = (
  obstacle: BusTracerSimpleRouteJson["obstacles"][number],
  layer: string,
  layerCount: number,
) => {
  if (obstacle.layers.includes(layer)) return true
  const layerIndex = getLayerIndex(layer, layerCount)
  return obstacle.zLayers?.includes(layerIndex) ?? false
}

export const createObstacleBlocker = (
  srj: BusTracerSimpleRouteJson,
  options: BlockerOptions,
) => {
  const ignoredIds = options.ignoredConnectionIds ?? new Set<string>()
  return (point: { x: number; y: number }, layer: string) => {
    if (options.extraBlocked?.(point, layer)) return true
    for (const obstacle of srj.obstacles) {
      if (
        obstacle.isCopperPour ||
        !obstacleBlocksLayer(obstacle, layer, srj.layerCount)
      ) {
        continue
      }
      if (
        options.ignoreObstacleShortSideBelow !== undefined &&
        Math.min(obstacle.width, obstacle.height) <
          options.ignoreObstacleShortSideBelow
      ) {
        continue
      }
      if (obstacle.connectedTo.some((id) => ignoredIds.has(id))) continue
      if (isPointInsideObstacle(point, obstacle, options.padding)) return true
    }
    return false
  }
}
