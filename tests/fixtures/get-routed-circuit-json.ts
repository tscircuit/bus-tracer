import type { AnyCircuitElement } from "circuit-json"
import type { BusTracer } from "lib/bus-tracer"
import { getSampleCircuitJson } from "tests/fixtures/get-sample-circuit-json"

export const getRoutedCircuitJson = async (
  sampleName: string,
  solver: BusTracer,
) => {
  const baseCircuitJson = await getSampleCircuitJson(sampleName)
  const sourceTraces = new Map(
    baseCircuitJson
      .filter((element) => element.type === "source_trace")
      .map((trace) => [trace.source_trace_id, trace]),
  )
  const pcbTraces: AnyCircuitElement[] = []
  const pcbVias: AnyCircuitElement[] = []

  for (const trace of solver.getOutput().traces) {
    const sourceTrace = sourceTraces.get(trace.connection_name)
    const pcbTrace = {
      ...trace,
      source_trace_id: trace.connection_name,
      subcircuit_id: sourceTrace?.subcircuit_id,
    } as AnyCircuitElement
    pcbTraces.push(pcbTrace)

    for (const [routeIndex, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue
      const outerDiameter = point.via_diameter ?? 0.6
      pcbVias.push({
        type: "pcb_via",
        pcb_via_id: `${trace.pcb_trace_id}_via_${routeIndex}`,
        pcb_trace_id: trace.pcb_trace_id,
        x: point.x,
        y: point.y,
        hole_diameter: point.via_hole_diameter ?? outerDiameter / 2,
        outer_diameter: outerDiameter,
        layers: [point.from_layer, point.to_layer],
        from_layer: point.from_layer,
        to_layer: point.to_layer,
        subcircuit_id: sourceTrace?.subcircuit_id,
      } as AnyCircuitElement)
    }
  }

  return [
    ...baseCircuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
    ...pcbTraces,
    ...pcbVias,
  ]
}
