import type {
  FormationDefinition,
  FormationSummary,
  LatestData,
  Station,
  TrainService,
} from '../types'

const unknownSummary = (rawFormation: string | null = null): FormationSummary => ({
  status: 'unknown',
  currentUnits: [],
  rawFormation,
  crossSeatCarCount: null,
  totalCarCount: null,
})

export const classifyFormation = (
  currentUnits: string[],
  definitions: FormationDefinition[],
  rawFormation: string | null = null,
): FormationSummary => {
  if (currentUnits.length === 0) return unknownSummary(rawFormation)
  const byFamily = new Map(definitions.map((definition) => [definition.family, definition]))
  const resolved = currentUnits.map((unit) => {
    const family = /^([A-Z]+)/.exec(unit)?.[1]
    return family ? byFamily.get(family) : undefined
  })

  if (
    resolved.some(
      (definition) =>
        !definition ||
        !definition.verified ||
        definition.layout === 'unknown' ||
        definition.carCount === null ||
        definition.crossSeatCarCount === null,
    )
  ) {
    return { ...unknownSummary(rawFormation), currentUnits }
  }

  const known = resolved as FormationDefinition[]
  const totalCarCount = known.reduce((total, definition) => total + (definition.carCount ?? 0), 0)
  const crossSeatCarCount = known.reduce((total, definition) => total + (definition.crossSeatCarCount ?? 0), 0)
  const layouts = known.map((definition) => definition.layout)
  let status: FormationSummary['status']
  if (layouts.every((layout) => layout === 'convertible')) status = 'full_convertible'
  else if (layouts.every((layout) => layout === 'box_fixed')) status = 'box_fixed'
  else if (layouts.every((layout) => layout === 'longitudinal')) status = 'all_longitudinal'
  else status = crossSeatCarCount > 0 ? 'partial_cross' : 'all_longitudinal'

  return { status, currentUnits, rawFormation, crossSeatCarCount, totalCarCount }
}

export const formationAtStation = (
  service: TrainService,
  stationId: string,
  stations: Station[],
  latest: LatestData | null,
  definitions: FormationDefinition[],
): FormationSummary => {
  if (!latest) return unknownSummary()
  const stationOrder = new Map(stations.map((station) => [station.id, station.order]))
  const targetOrder = stationOrder.get(stationId)
  if (targetOrder === undefined) return unknownSummary()

  const segment = service.operationSegments.find((candidate) => {
    const from = stationOrder.get(candidate.fromStationId)
    const to = stationOrder.get(candidate.toStationId)
    return from !== undefined && to !== undefined && targetOrder >= Math.min(from, to) && targetOrder <= Math.max(from, to)
  })
  if (!segment) return unknownSummary()

  const assignmentMap = new Map(latest.assignments.map((assignment) => [assignment.diagramId, assignment]))
  const assignments = segment.diagramIds.map((diagramId) => assignmentMap.get(diagramId))
  if (assignments.some((assignment) => !assignment || assignment.parseStatus === 'unknown')) {
    const raw = assignments.filter(Boolean).map((assignment) => assignment?.rawFormation).join(' + ') || null
    return unknownSummary(raw)
  }

  const currentUnits = assignments.flatMap((assignment) => assignment?.currentUnits ?? [])
  const rawFormation = assignments.map((assignment) => assignment?.rawFormation).join(' + ')
  return classifyFormation(currentUnits, definitions, rawFormation)
}

