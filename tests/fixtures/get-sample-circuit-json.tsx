import Sample001Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample001/sample001.circuit"
import Sample002Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample002/sample002.circuit"
import Sample003Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample003/sample003.circuit"
import Sample004Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample004/sample004.circuit"
import Sample005Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample005/sample005.circuit"
import Sample006Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample006/sample006.circuit"
import Sample007Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample007/sample007.circuit"
import Sample008Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample008/sample008.circuit"
import Sample009Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample009/sample009.circuit"
import Sample010Circuit from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample010/sample010.circuit"
import type { AnyCircuitElement } from "circuit-json"
import type { ComponentType } from "react"
import { Circuit } from "tscircuit"

const sampleCircuits: Record<string, ComponentType> = {
  sample001: Sample001Circuit,
  sample002: Sample002Circuit,
  sample003: Sample003Circuit,
  sample004: Sample004Circuit,
  sample005: Sample005Circuit,
  sample006: Sample006Circuit,
  sample007: Sample007Circuit,
  sample008: Sample008Circuit,
  sample009: Sample009Circuit,
  sample010: Sample010Circuit,
}

export const getSampleCircuitJson = async (sampleName: string) => {
  const SampleCircuit = sampleCircuits[sampleName]
  if (!SampleCircuit) throw new Error(`Unknown dataset sample: ${sampleName}`)

  const circuit = new Circuit()
  circuit.add(<SampleCircuit />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson() as AnyCircuitElement[]
}
