import type {
  FormationDefinition,
  FormationModelData,
  FormationPrediction,
  FormationSummary,
  LatestData,
  OperationSegment,
  RouteMatchType,
  SeatStatus,
  Station,
  TrainService,
} from '../types'

const unknownSummary = (rawFormation: string | null = null): FormationSummary => ({
  status: 'unknown',
  basis: 'unknown',
  currentUnits: [],
  plannedFamilies: [],
  rawFormation,
  crossSeatCarCount: null,
  totalCarCount: null,
})

export interface ResultVisibilitySettings {
  showDirectLongitudinal: boolean
  showDirectUnknown: boolean
  showIndirectUnknown: boolean
  requireMinimumIndirectMinutes: boolean
  minimumIndirectMinutes: number
}

export const DEFAULT_RESULT_VISIBILITY: ResultVisibilitySettings = {
  showDirectLongitudinal: true,
  showDirectUnknown: true,
  showIndirectUnknown: true,
  requireMinimumIndirectMinutes: false,
  minimumIndirectMinutes: 20,
}

export const shouldDisplayRouteResult = (
  matchType: RouteMatchType,
  summary: FormationSummary,
  featuredDurationMinutes: number | null = null,
  settings: ResultVisibilitySettings = DEFAULT_RESULT_VISIBILITY,
): boolean => {
  if (matchType === 'direct') {
    if (summary.status === 'all_longitudinal') return settings.showDirectLongitudinal
    if (summary.status === 'unknown') return settings.showDirectUnknown
    return true
  }

  if (summary.status === 'all_longitudinal') return false
  if (summary.status === 'unknown' && !settings.showIndirectUnknown) return false
  if (!settings.requireMinimumIndirectMinutes) return true
  return (
    featuredDurationMinutes !== null &&
    featuredDurationMinutes >= Math.max(0, settings.minimumIndirectMinutes)
  )
}

export const classifyFormation = (
  formationCodes: string[],
  definitions: FormationDefinition[],
  rawFormation: string | null = null,
  basis: 'current' | 'planned' = 'current',
): FormationSummary => {
  if (formationCodes.length === 0) return unknownSummary(rawFormation)
  const byFamily = new Map(definitions.map((definition) => [definition.family, definition]))
  const resolved = formationCodes.map((code) => {
    const family = /^([A-Z]+)/.exec(code)?.[1]
    return family ? byFamily.get(family) : undefined
  })
  const basisFields = basis === 'current'
    ? { basis, currentUnits: formationCodes, plannedFamilies: [] }
    : { basis, currentUnits: [], plannedFamilies: formationCodes }

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
    return { ...unknownSummary(rawFormation), ...basisFields }
  }

  const known = resolved as FormationDefinition[]
  const totalCarCount = known.reduce((total, definition) => total + (definition.carCount ?? 0), 0)
  const crossSeatCarCount = known.reduce((total, definition) => total + (definition.crossSeatCarCount ?? 0), 0)
  const layouts = known.map((definition) => definition.layout)
  let status: FormationSummary['status']
  if (layouts.every((layout) => layout === 'convertible')) status = 'full_convertible'
  else if (layouts.every((layout) => layout === 'reclining')) status = 'reclining'
  else if (layouts.every((layout) => layout === 'box_fixed')) status = 'box_fixed'
  else if (layouts.every((layout) => layout === 'longitudinal')) status = 'all_longitudinal'
  else status = crossSeatCarCount > 0 ? 'partial_cross' : 'all_longitudinal'

  return { status, ...basisFields, rawFormation, crossSeatCarCount, totalCarCount }
}

const segmentAtStation = (
  service: TrainService,
  stationId: string,
  stations: Station[],
): OperationSegment | undefined => {
  const stationOrder = new Map(stations.map((station) => [station.id, station.order]))
  const targetOrder = stationOrder.get(stationId)
  if (targetOrder === undefined) return undefined

  return service.operationSegments.find((candidate) => {
    const from = stationOrder.get(candidate.fromStationId)
    const to = stationOrder.get(candidate.toStationId)
    return from !== undefined && to !== undefined && targetOrder >= Math.min(from, to) && targetOrder <= Math.max(from, to)
  })
}

const formationForSegment = (
  segment: OperationSegment,
  latest: LatestData | null,
  definitions: FormationDefinition[],
): FormationSummary => {
  if (segment.diagramIds.length === 0) return unknownSummary()

  const assignmentMap = new Map((latest?.assignments ?? []).map((assignment) => [assignment.diagramId, assignment]))
  const assignments = segment.diagramIds.map((diagramId) => assignmentMap.get(diagramId))
  const currentAssignmentCount = assignments.filter(Boolean).length
  const hasCompleteCurrentAssignment = assignments.every(
    (assignment) => assignment?.parseStatus === 'parsed',
  )

  if (hasCompleteCurrentAssignment) {
    const currentUnits = assignments.flatMap((assignment) => assignment?.currentUnits ?? [])
    const rawFormation = assignments.map((assignment) => assignment?.rawFormation).join(' + ')
    return classifyFormation(currentUnits, definitions, rawFormation, 'current')
  }

  if (currentAssignmentCount > 0) {
    const raw = assignments.filter(Boolean).map((assignment) => assignment?.rawFormation).join(' + ') || null
    return unknownSummary(raw)
  }

  const plannedMap = new Map(
    (segment.plannedFormations ?? []).map((planned) => [planned.diagramId, planned.family]),
  )
  const plannedFamilies = segment.diagramIds.map((diagramId) => plannedMap.get(diagramId))
  if (plannedFamilies.some((family) => family === undefined)) return unknownSummary()

  const resolvedPlannedFamilies = plannedFamilies as string[]
  return classifyFormation(
    resolvedPlannedFamilies,
    definitions,
    resolvedPlannedFamilies.join(' + '),
    'planned',
  )
}

const CROSS_SEAT_STATUSES = new Set<SeatStatus>(['full_convertible', 'reclining', 'partial_cross', 'box_fixed'])

const familyOf = (code: string): string => /^([A-Z]+)/.exec(code)?.[1] ?? code

/**
 * Estimates the chance of cross seats from how often each unassigned diagram ran
 * with each formation family in the archive. Diagrams reported today keep their
 * reported family. Diagrams are treated as independent of one another.
 */
export const predictSegmentFormation = (
  segment: OperationSegment,
  latest: LatestData | null,
  definitions: FormationDefinition[],
  model: FormationModelData,
): FormationPrediction | null => {
  if (segment.diagramIds.length === 0 || model.trainingDates.length === 0) return null
  const assignmentMap = new Map((latest?.assignments ?? []).map((assignment) => [assignment.diagramId, assignment]))
  const history = new Map(model.diagrams.map((diagram) => [diagram.diagramId, diagram]))
  const choices: Array<Array<{ families: string[]; probability: number }>> = []
  let observedDays = Number.POSITIVE_INFINITY
  for (const diagramId of segment.diagramIds) {
    const current = assignmentMap.get(diagramId)
    if (current?.parseStatus === 'parsed') {
      choices.push([{ families: current.currentUnits.map(familyOf), probability: 1 }])
      continue
    }
    const record = history.get(diagramId)
    if (!record || record.observedDays < model.minimumObservedDays) return null
    observedDays = Math.min(observedDays, record.observedDays)
    choices.push(record.outcomes.map((outcome) => ({
      families: outcome.families,
      probability: outcome.days / record.observedDays,
    })))
  }
  // Nothing needed predicting: the segment is fully reported, e.g. with unverified F units.
  if (!Number.isFinite(observedDays)) return null

  let cross = 0
  let classified = 0
  let likely = { families: [] as string[], probability: 0 }
  const visit = (index: number, families: string[], probability: number): void => {
    if (index === choices.length) {
      const { status } = classifyFormation(families, definitions)
      if (status === 'unknown') return
      classified += probability
      if (CROSS_SEAT_STATUSES.has(status)) cross += probability
      if (probability > likely.probability) likely = { families, probability }
      return
    }
    for (const choice of choices[index]) {
      visit(index + 1, [...families, ...choice.families], probability * choice.probability)
    }
  }
  visit(0, [], 1)
  // Mostly unclassifiable history, such as unverified F units, gives no estimate.
  if (classified <= 0.5) return null

  return {
    crossSeatProbability: cross / classified,
    likelyFamilies: likely.families,
    observedDays,
    trainingFrom: model.trainingDates[0],
    trainingTo: model.trainingDates[model.trainingDates.length - 1],
  }
}

export const formationAtStation = (
  service: TrainService,
  stationId: string,
  stations: Station[],
  latest: LatestData | null,
  definitions: FormationDefinition[],
  model: FormationModelData | null = null,
): FormationSummary => {
  const segment = segmentAtStation(service, stationId, stations)
  if (!segment) return unknownSummary()

  const summary = formationForSegment(segment, latest, definitions)
  if (summary.status !== 'unknown' || !model) return summary
  const prediction = predictSegmentFormation(segment, latest, definitions, model)
  return prediction ? { ...summary, prediction } : summary
}
