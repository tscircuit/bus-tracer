export const getLayerNames = (layerCount: number): string[] => {
  if (!Number.isInteger(layerCount) || layerCount < 1) {
    throw new Error(`layerCount must be a positive integer, got ${layerCount}`)
  }
  if (layerCount === 1) return ["top"]
  if (layerCount === 2) return ["top", "bottom"]

  return [
    "top",
    ...Array.from(
      { length: layerCount - 2 },
      (_, index) => `inner${index + 1}`,
    ),
    "bottom",
  ]
}

export const getLayerIndex = (layer: string, layerCount: number): number => {
  const index = getLayerNames(layerCount).indexOf(layer)
  if (index < 0)
    throw new Error(`Unknown layer "${layer}" for ${layerCount} layers`)
  return index
}

export const getGraphicsLayer = (layer: string, layerCount: number) =>
  `z${getLayerIndex(layer, layerCount)}`

export const getTraceLayerColor = (layer: string): string => {
  const colors: Record<string, string> = {
    top: "red",
    bottom: "blue",
    inner1: "green",
    inner2: "yellow",
    inner3: "orange",
    inner4: "purple",
    inner5: "cyan",
    inner6: "magenta",
    inner7: "lime",
    inner8: "brown",
  }
  return colors[layer] ?? "gray"
}
