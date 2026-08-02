import type { GraphicsObject } from "graphics-debug"
import {
  getGraphicsLayer,
  getLayerIndex,
  getLayerNames,
  getTraceLayerColor,
} from "./layer-names"
import type {
  BusTracerSimpleRouteJson,
  CoarseBusRoute,
  SimplifiedPcbTrace,
} from "./types"

type VisualizeParams = {
  simpleRouteJson: BusTracerSimpleRouteJson
  coarseRoutes?: CoarseBusRoute[]
  traces?: SimplifiedPcbTrace[]
}

const withAlpha = (color: string, alpha: number) => {
  const rgb: Record<string, [number, number, number]> = {
    red: [255, 0, 0],
    blue: [0, 0, 255],
    green: [0, 128, 0],
    yellow: [255, 255, 0],
    orange: [255, 165, 0],
    purple: [128, 0, 128],
    cyan: [0, 255, 255],
    magenta: [255, 0, 255],
    lime: [0, 255, 0],
    brown: [165, 42, 42],
    gray: [128, 128, 128],
  }
  const [r, g, b] = rgb[color] ?? rgb.gray!
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const getObstacleLayers = (
  obstacle: BusTracerSimpleRouteJson["obstacles"][number],
  layerCount: number,
) => {
  const names = getLayerNames(layerCount)
  const indexes = new Set<number>()
  for (const layer of obstacle.layers) {
    const index = names.indexOf(layer)
    if (index >= 0) indexes.add(index)
  }
  for (const index of obstacle.zLayers ?? []) {
    if (index >= 0 && index < layerCount) indexes.add(index)
  }
  return [...indexes].sort((a, b) => a - b)
}

const addTraces = (
  graphics: GraphicsObject,
  traces: SimplifiedPcbTrace[],
  srj: BusTracerSimpleRouteJson,
) => {
  const viaDiameter =
    srj.min_via_pad_diameter ??
    srj.minViaPadDiameter ??
    srj.minViaDiameter ??
    0.6
  for (const trace of traces) {
    for (const routePoint of trace.route) {
      if (routePoint.route_type !== "via") continue
      const fromZ = getLayerIndex(routePoint.from_layer, srj.layerCount)
      const toZ = getLayerIndex(routePoint.to_layer, srj.layerCount)
      const zLayers = Array.from(
        { length: Math.abs(toZ - fromZ) + 1 },
        (_, index) => Math.min(fromZ, toZ) + index,
      )
      graphics.circles!.push({
        center: { x: routePoint.x, y: routePoint.y },
        radius: (routePoint.via_diameter ?? viaDiameter) / 2,
        fill: "blue",
        stroke: "none",
        layer: `z${zLayers.join(",")}`,
        label: trace.connection_name,
      })
    }

    for (let index = 0; index < trace.route.length - 1; index++) {
      const first = trace.route[index]!
      const second = trace.route[index + 1]!
      if (
        first.route_type !== "wire" ||
        second.route_type !== "wire" ||
        first.layer !== second.layer
      ) {
        continue
      }
      const isTopLayer = first.layer === "top"
      const baseColor = getTraceLayerColor(first.layer)
      graphics.lines!.push({
        points: [
          { x: first.x, y: first.y },
          { x: second.x, y: second.y },
        ],
        layer: getGraphicsLayer(first.layer, srj.layerCount),
        strokeWidth: first.width,
        strokeColor: isTopLayer ? baseColor : withAlpha(baseColor, 0.5),
        ...(isTopLayer ? {} : { strokeDash: [0.2, 0.2] }),
        label: trace.connection_name,
      })
    }
  }
}

export const visualizeBusTracer = ({
  simpleRouteJson: srj,
  coarseRoutes = [],
  traces = srj.traces ?? [],
}: VisualizeParams): GraphicsObject => {
  const graphics: GraphicsObject = {
    points: [],
    rects: [],
    lines: [],
    circles: [],
    texts: [],
  }

  for (
    let connectionIndex = 0;
    connectionIndex < srj.connections.length;
    connectionIndex++
  ) {
    const connection = srj.connections[connectionIndex]!
    const color = `hsl(${(connectionIndex * 340) / srj.connections.length}, 100%, 50%)`
    for (const point of connection.pointsToConnect) {
      const layer = "layer" in point ? point.layer : point.layers[0]!
      graphics.points!.push({
        x: point.x,
        y: point.y,
        color,
        layer: getGraphicsLayer(layer, srj.layerCount),
        label: `${connection.name}\n${connection.name}\n${layer}`,
      })
    }
  }

  for (const obstacle of srj.obstacles) {
    if (obstacle.isCopperPour) continue
    const zLayers = getObstacleLayers(obstacle, srj.layerCount)
    if (zLayers.length === 0) continue
    const onlyLayer =
      zLayers.length === 1 ? getLayerNames(srj.layerCount)[zLayers[0]!] : null
    const baseColor = onlyLayer === "bottom" ? "blue" : "red"
    graphics.rects!.push({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      ccwRotationDegrees: obstacle.ccwRotationDegrees,
      fill: withAlpha(baseColor, 1 - 0.5 ** zLayers.length),
      layer: `z${zLayers.join(",")}`,
      label: obstacle.obstacleId ?? obstacle.connectedTo.join(", "),
    })
  }

  addTraces(graphics, traces, srj)

  for (const route of coarseRoutes) {
    for (let index = 0; index < route.centerline.length - 1; index++) {
      const first = route.centerline[index]!
      const second = route.centerline[index + 1]!
      if (first.layer === second.layer) {
        graphics.lines!.push({
          points: [
            { x: first.x, y: first.y },
            { x: second.x, y: second.y },
          ],
          strokeColor: "rgba(0, 128, 0, 0.6)",
          strokeWidth: route.corridorWidth,
          strokeDash: [0.2, 0.2],
          layer: getGraphicsLayer(first.layer, srj.layerCount),
          label: `${route.busId} coarse corridor`,
        })
      } else {
        const fromZ = getLayerIndex(first.layer, srj.layerCount)
        const toZ = getLayerIndex(second.layer, srj.layerCount)
        graphics.circles!.push({
          center: { x: first.x, y: first.y },
          radius: route.corridorWidth / 2,
          fill: "rgba(255, 0, 255, 0.5)",
          layer: `z${Math.min(fromZ, toZ)},${Math.max(fromZ, toZ)}`,
          label: `${route.busId} shared layer change`,
        })
      }
    }
  }

  return graphics
}
