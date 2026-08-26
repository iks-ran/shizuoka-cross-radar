import type {
  FormationDefinition,
  FormationSummary,
  LatestData,
  RouteMatchType,
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
  else if (layouts.every((layout) => layout === 'box_fixed')) status = 'box_fixed'
  else if (layouts.every((layout) => layout === 'longitudinal')) status = 'all_longitudinal'
  else status = crossSeatCarCount > 0 ? 'partial_cross' : 'all_longitudinal'

  return { status, ...basisFields, rawFormation, crossSeatCarCount, totalCarCount }
}

export const formationAtStation = (
  service: TrainService,
  stationId: string,
  stations: Station[],
  latest: LatestData | null,
  definitions: FormationDefinition[],
): FormationSummary => {
  const stationOrder = new Map(stations.map((station) => [station.id, station.order]))
  const targetOrder = stationOrder.get(stationId)
  if (targetOrder === undefined) return unknownSummary()

  const segment = service.operationSegments.find((candidate) => {
    const from = stationOrder.get(candidate.fromStationId)
    const to = stationOrder.get(candidate.toStationId)
    return from !== undefined && to !== undefined && targetOrder >= Math.min(from, to) && targetOrder <= Math.max(from, to)
  })
  if (!segment) return unknownSummary()
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
