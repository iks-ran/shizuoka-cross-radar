import { describe, expect, it } from 'vitest'
import type {
  FormationDefinition,
  FormationModelData,
  LatestData,
  OperationSegment,
  Station,
  TrainService,
} from '../types'
import {
  classifyFormation,
  DEFAULT_RESULT_VISIBILITY,
  formationAtStation,
  predictSegmentFormation,
  shouldDisplayRouteResult,
} from './classification'

const stations: Station[] = [
  { id: 'numazu', order: 0, name: { ja: '沼津', en: 'Numazu', zhCN: '沼津' } },
  { id: 'atami', order: 1, name: { ja: '熱海', en: 'Atami', zhCN: '热海' } },
]

const definitions: FormationDefinition[] = [
  {
    family: 'K',
    series: '313',
    carCount: 2,
    crossSeatCarCount: 2,
    layout: 'convertible',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'L',
    series: '313',
    carCount: 2,
    crossSeatCarCount: 2,
    layout: 'convertible',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'S',
    series: '313-8000',
    carCount: 3,
    crossSeatCarCount: 3,
    layout: 'convertible',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'V',
    series: '313',
    carCount: 2,
    crossSeatCarCount: 2,
    layout: 'box_fixed',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'W',
    series: '313',
    carCount: 2,
    crossSeatCarCount: 0,
    layout: 'longitudinal',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'T',
    series: '313-2500',
    carCount: 3,
    crossSeatCarCount: 0,
    layout: 'longitudinal',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'N',
    series: '313',
    carCount: 3,
    crossSeatCarCount: 0,
    layout: 'longitudinal',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'U',
    series: '315-3000',
    carCount: 4,
    crossSeatCarCount: 0,
    layout: 'longitudinal',
    verified: true,
    evidenceUrl: null,
  },
  {
    family: 'F',
    series: '373',
    carCount: null,
    crossSeatCarCount: null,
    layout: 'unknown',
    verified: false,
    evidenceUrl: null,
  },
]

const service = (segment: OperationSegment): TrainService => ({
  id: 'test-service',
  trainNumber: '1420M',
  destinationStationId: 'atami',
  destinationName: stations[1].name,
  direction: 'eastbound',
  serviceDays: ['all'],
  stops: [
    { stationId: 'numazu', arrival: null, departure: '04:56', dayOffset: 0 },
    { stationId: 'atami', arrival: '05:15', departure: null, dayOffset: 0 },
  ],
  operationSegments: [segment],
})

const latest = (assignments: LatestData['assignments']): LatestData => ({
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate: '2026-08-26',
  updatedAt: '2026-08-26T19:00:02+09:00',
  source: { id: 'tokaido-shizuoka', label: 'Unyo', url: null, isMock: false },
  assignments,
})

describe('classifyFormation', () => {
  it('classifies K + L as fully convertible with 4 of 4 cars', () => {
    expect(classifyFormation(['K8', 'L4'], definitions)).toMatchObject({
      status: 'full_convertible',
      basis: 'current',
      crossSeatCarCount: 4,
      totalCarCount: 4,
    })
  })

  it('classifies S as fully convertible', () => {
    expect(classifyFormation(['S6'], definitions)).toMatchObject({
      status: 'full_convertible',
      crossSeatCarCount: 3,
      totalCarCount: 3,
    })
  })

  it('classifies V as box/fixed seating', () => {
    expect(classifyFormation(['V13'], definitions).status).toBe('box_fixed')
  })

  it.each(['W3', 'T6', 'N5', 'U13'])('classifies %s as longitudinal', (unit) => {
    expect(classifyFormation([unit], definitions).status).toBe('all_longitudinal')
  })

  it('classifies cross and longitudinal units as partial', () => {
    expect(classifyFormation(['K3', 'W4'], definitions)).toMatchObject({
      status: 'partial_cross',
      crossSeatCarCount: 2,
      totalCarCount: 4,
    })
  })

  it('classifies convertible and box units as partial', () => {
    expect(classifyFormation(['K3', 'V4'], definitions).status).toBe('partial_cross')
  })

  it('keeps unknown families unknown without car counts', () => {
    expect(classifyFormation(['F4'], definitions)).toMatchObject({
      status: 'unknown',
      crossSeatCarCount: null,
      totalCarCount: null,
    })
    expect(classifyFormation(['ZZ1'], definitions).status).toBe('unknown')
  })
})

describe('shouldDisplayRouteResult', () => {
  const crossSeats = classifyFormation(['K8'], definitions)
  const longitudinal = classifyFormation(['U13'], definitions)
  const possibleCrossSeats = classifyFormation(['ZZ1'], definitions)

  it('always keeps direct trains', () => {
    expect(shouldDisplayRouteResult('direct', longitudinal)).toBe(true)
  })

  it.each(['first_leg', 'intermediate_overlap'] as const)(
    'hides confirmed longitudinal %s trains',
    (matchType) => {
      expect(shouldDisplayRouteResult(matchType, longitudinal)).toBe(false)
    },
  )

  it.each(['first_leg', 'intermediate_overlap'] as const)(
    'keeps known and possible cross-seat %s trains',
    (matchType) => {
      expect(shouldDisplayRouteResult(matchType, crossSeats)).toBe(true)
      expect(shouldDisplayRouteResult(matchType, possibleCrossSeats)).toBe(true)
    },
  )

  it('applies each configurable visibility category independently', () => {
    expect(shouldDisplayRouteResult('direct', longitudinal, null, {
      ...DEFAULT_RESULT_VISIBILITY,
      showDirectLongitudinal: false,
    })).toBe(false)
    expect(shouldDisplayRouteResult('direct', possibleCrossSeats, null, {
      ...DEFAULT_RESULT_VISIBILITY,
      showDirectUnknown: false,
    })).toBe(false)
    expect(shouldDisplayRouteResult('first_leg', possibleCrossSeats, 30, {
      ...DEFAULT_RESULT_VISIBILITY,
      showIndirectUnknown: false,
    })).toBe(false)
    expect(shouldDisplayRouteResult('direct', crossSeats, null, {
      ...DEFAULT_RESULT_VISIBILITY,
      showDirectLongitudinal: false,
      showDirectUnknown: false,
    })).toBe(true)
  })

  it('applies minimum featured-train time only to indirect results', () => {
    const settings = {
      ...DEFAULT_RESULT_VISIBILITY,
      requireMinimumIndirectMinutes: true,
      minimumIndirectMinutes: 30,
    }

    expect(shouldDisplayRouteResult('first_leg', crossSeats, 29, settings)).toBe(false)
    expect(shouldDisplayRouteResult('intermediate_overlap', crossSeats, 30, settings)).toBe(true)
    expect(shouldDisplayRouteResult('direct', crossSeats, null, settings)).toBe(true)
  })
})

describe('formationAtStation', () => {
  it('prefers a complete current assignment over the planned family', () => {
    const summary = formationAtStation(
      service({
        fromStationId: 'numazu',
        toStationId: 'atami',
        diagramIds: ['A75'],
        plannedFormations: [{ diagramId: 'A75', family: 'U' }],
      }),
      'numazu',
      stations,
      latest([
        { diagramId: 'A75', rawFormation: 'S1', currentUnits: ['S1'], parseStatus: 'parsed' },
      ]),
      definitions,
    )

    expect(summary.basis).toBe('current')
    expect(summary.status).toBe('full_convertible')
    expect(summary.currentUnits).toEqual(['S1'])
    expect(summary.plannedFamilies).toEqual([])
  })

  it('uses a unique planned family when no current assignment exists', () => {
    const summary = formationAtStation(
      service({
        fromStationId: 'numazu',
        toStationId: 'atami',
        diagramIds: ['A75'],
        plannedFormations: [{ diagramId: 'A75', family: 'U' }],
      }),
      'numazu',
      stations,
      latest([]),
      definitions,
    )

    expect(summary.basis).toBe('planned')
    expect(summary.status).toBe('all_longitudinal')
    expect(summary.currentUnits).toEqual([])
    expect(summary.plannedFamilies).toEqual(['U'])
    expect(summary.totalCarCount).toBe(4)
  })

  it('keeps partial current coverage unknown instead of mixing sources', () => {
    const summary = formationAtStation(
      service({
        fromStationId: 'numazu',
        toStationId: 'atami',
        diagramIds: ['A27', 'A41'],
        plannedFormations: [
          { diagramId: 'A27', family: 'U' },
          { diagramId: 'A41', family: 'U' },
        ],
      }),
      'numazu',
      stations,
      latest([
        { diagramId: 'A27', rawFormation: 'T12', currentUnits: ['T12'], parseStatus: 'parsed' },
      ]),
      definitions,
    )

    expect(summary.basis).toBe('unknown')
    expect(summary.status).toBe('unknown')
    expect(summary.rawFormation).toBe('T12')
  })

  it('does not replace a malformed current report with planned data', () => {
    const summary = formationAtStation(
      service({
        fromStationId: 'numazu',
        toStationId: 'atami',
        diagramIds: ['A75'],
        plannedFormations: [{ diagramId: 'A75', family: 'U' }],
      }),
      'numazu',
      stations,
      latest([
        { diagramId: 'A75', rawFormation: 'U?', currentUnits: [], parseStatus: 'unknown' },
      ]),
      definitions,
    )

    expect(summary.basis).toBe('unknown')
    expect(summary.status).toBe('unknown')
    expect(summary.rawFormation).toBe('U?')
  })

  it('shows an exact but unverified planned family without classifying its seats', () => {
    const summary = formationAtStation(
      service({
        fromStationId: 'numazu',
        toStationId: 'atami',
        diagramIds: ['A701'],
        plannedFormations: [{ diagramId: 'A701', family: 'F' }],
      }),
      'numazu',
      stations,
      null,
      definitions,
    )

    expect(summary.basis).toBe('planned')
    expect(summary.status).toBe('unknown')
    expect(summary.plannedFamilies).toEqual(['F'])
    expect(summary.totalCarCount).toBeNull()
  })
})

describe('rotating reclining formations', () => {
  const reclining: FormationDefinition[] = definitions.map((definition) =>
    definition.family === 'F'
      ? { ...definition, carCount: 3, crossSeatCarCount: 3, layout: 'reclining', verified: true }
      : definition,
  )

  it('classifies verified 373-series units as rotating reclining seats', () => {
    expect(classifyFormation(['F4'], reclining)).toMatchObject({
      status: 'reclining',
      crossSeatCarCount: 3,
      totalCarCount: 3,
    })
    expect(classifyFormation(['F1', 'F2'], reclining).status).toBe('reclining')
  })

  it('counts reclining cars as cross seats when coupled to longitudinal units', () => {
    expect(classifyFormation(['F1', 'U3'], reclining)).toMatchObject({
      status: 'partial_cross',
      crossSeatCarCount: 3,
      totalCarCount: 7,
    })
  })

  it('treats reclining outcomes as cross seats in predictions and filters', () => {
    const prediction = predictSegmentFormation(
      { fromStationId: 'numazu', toStationId: 'atami', diagramIds: ['A701'] },
      null,
      reclining,
      {
        schemaVersion: 1,
        timeZone: 'Asia/Tokyo',
        method: 'diagram-frequency',
        minimumObservedDays: 3,
        trainingDates: ['2026-10-25', '2026-10-26', '2026-10-27'],
        diagrams: [{ diagramId: 'A701', observedDays: 3, outcomes: [{ families: ['F'], days: 3 }] }],
      },
    )
    expect(prediction?.crossSeatProbability).toBe(1)
    expect(shouldDisplayRouteResult('first_leg', classifyFormation(['F1'], reclining))).toBe(true)
  })
})

describe('archive formation predictions', () => {
  const model = (diagrams: FormationModelData['diagrams']): FormationModelData => ({
    schemaVersion: 1,
    timeZone: 'Asia/Tokyo',
    method: 'diagram-frequency',
    minimumObservedDays: 3,
    trainingDates: ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
    diagrams,
  })
  const mixed313 = model([
    { diagramId: 'A21', observedDays: 4, outcomes: [{ families: ['T'], days: 3 }, { families: ['S'], days: 1 }] },
    { diagramId: 'A41', observedDays: 4, outcomes: [{ families: ['K'], days: 3 }, { families: ['W'], days: 1 }] },
    { diagramId: 'A50', observedDays: 2, outcomes: [{ families: ['S'], days: 2 }] },
    { diagramId: 'A701', observedDays: 4, outcomes: [{ families: ['F'], days: 4 }] },
    { diagramId: 'A702', observedDays: 4, outcomes: [{ families: ['S'], days: 3 }, { families: ['F'], days: 1 }] },
    { diagramId: 'A703', observedDays: 4, outcomes: [{ families: ['F'], days: 3 }, { families: ['S'], days: 1 }] },
  ])
  const segment = (diagramIds: string[], plannedFormations: OperationSegment['plannedFormations'] = []) => ({
    fromStationId: 'numazu', toStationId: 'atami', diagramIds, plannedFormations,
  })

  it('estimates an unassigned diagram from its archived family frequencies', () => {
    const summary = formationAtStation(service(segment(['A21'])), 'numazu', stations, latest([]), definitions, mixed313)

    expect(summary.status).toBe('unknown')
    expect(summary.basis).toBe('unknown')
    expect(summary.prediction).toEqual({
      crossSeatProbability: 0.25,
      likelyFamilies: ['T'],
      observedDays: 4,
      trainingFrom: '2026-10-24',
      trainingTo: '2026-10-27',
    })
  })

  it('combines a diagram reported today with an estimate for its unreported partner', () => {
    const summary = formationAtStation(
      service(segment(['A27', 'A41'])),
      'numazu',
      stations,
      latest([{ diagramId: 'A27', rawFormation: 'T12', currentUnits: ['T12'], parseStatus: 'parsed' }]),
      definitions,
      model([...mixed313.diagrams]),
    )

    // T + K is partial cross seating (3/4); T + W is longitudinal (1/4).
    expect(summary.status).toBe('unknown')
    expect(summary.rawFormation).toBe('T12')
    expect(summary.prediction?.crossSeatProbability).toBe(0.75)
    expect(summary.prediction?.likelyFamilies).toEqual(['T', 'K'])
    expect(summary.prediction?.observedDays).toBe(4)
  })

  it('estimates a diagram whose current report could not be parsed', () => {
    const prediction = predictSegmentFormation(
      segment(['A21']),
      latest([{ diagramId: 'A21', rawFormation: 'T?', currentUnits: [], parseStatus: 'unknown' }]),
      definitions,
      mixed313,
    )
    expect(prediction?.crossSeatProbability).toBe(0.25)
  })

  it('withholds an estimate without enough history for every unreported diagram', () => {
    expect(predictSegmentFormation(segment(['A50']), null, definitions, mixed313)).toBeNull()
    expect(predictSegmentFormation(segment(['A21', 'A999']), null, definitions, mixed313)).toBeNull()
    expect(predictSegmentFormation(segment([]), null, definitions, mixed313)).toBeNull()
    expect(predictSegmentFormation(segment(['A21']), null, definitions, model([]))).toBeNull()
  })

  it('does not turn unverified families into seating estimates', () => {
    const reportedF = formationAtStation(
      service(segment(['A701'])),
      'numazu',
      stations,
      latest([{ diagramId: 'A701', rawFormation: 'F4', currentUnits: ['F4'], parseStatus: 'parsed' }]),
      definitions,
      mixed313,
    )
    expect(reportedF.status).toBe('unknown')
    expect(reportedF.prediction).toBeUndefined()

    const plannedF = formationAtStation(
      service(segment(['A701'], [{ diagramId: 'A701', family: 'F' }])), 'numazu', stations, null, definitions, mixed313,
    )
    expect(plannedF.prediction).toBeUndefined()
    expect(predictSegmentFormation(segment(['A703']), null, definitions, mixed313)).toBeNull()
    // Classifiable history outweighs the unverified days and is normalized over them.
    expect(predictSegmentFormation(segment(['A702']), null, definitions, mixed313)?.crossSeatProbability).toBe(1)
  })

  it('never attaches an estimate to a confirmed current or planned formation', () => {
    const current = formationAtStation(
      service(segment(['A21'])),
      'numazu',
      stations,
      latest([{ diagramId: 'A21', rawFormation: 'S1', currentUnits: ['S1'], parseStatus: 'parsed' }]),
      definitions,
      mixed313,
    )
    const planned = formationAtStation(
      service(segment(['A21'], [{ diagramId: 'A21', family: 'U' }])), 'numazu', stations, null, definitions, mixed313,
    )
    expect(current.status).toBe('full_convertible')
    expect(current.prediction).toBeUndefined()
    expect(planned.basis).toBe('planned')
    expect(planned.prediction).toBeUndefined()
  })

  it('keeps result filtering on the confirmed status', () => {
    const summary = formationAtStation(service(segment(['A21'])), 'numazu', stations, latest([]), definitions, mixed313)
    expect(shouldDisplayRouteResult('first_leg', summary)).toBe(true)
    expect(shouldDisplayRouteResult('direct', summary, null, { ...DEFAULT_RESULT_VISIBILITY, showDirectUnknown: false })).toBe(false)
  })
})
