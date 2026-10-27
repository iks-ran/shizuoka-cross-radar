import { describe, expect, it } from 'vitest'
import formationsJson from '../../public/data/formations.json'
import latestJson from '../../public/data/latest.json'
import formationModelJson from '../../public/data/formation-model.json'
import historyIndexJson from '../../public/data/history-index.json'
import timetableJson from '../../public/data/timetable.json'
import journeyRegressionJson from '../../data/fixtures/journey-763m.sample.json'
import type { FormationModelData, FormationsData, LatestData, TimetableData } from '../types'
import { formationAtStation } from './classification'
import { createScheduledJourneyPlanner } from './journey'
import { searchUpcomingTrains, serviceRunsToday } from './search'
import { stopMinutes } from './time'

const timetable = timetableJson as TimetableData
const formations = formationsJson as FormationsData
const latest = latestJson as LatestData

describe('checked-in static data', () => {
  it('can query every route overlap from Hamamatsu to Shizuoka', () => {
    expect(timetable.isFixture).toBe(false)
    expect(timetable.source.id).toBe('jr-central')
    const results = searchUpcomingTrains(timetable, 'hamamatsu', 'shizuoka', '14:00', false)
    expect(results.length).toBeGreaterThanOrEqual(5)
    const stationOrder = new Map(timetable.stations.map((station) => [station.id, station.order]))
    const originOrder = stationOrder.get('hamamatsu') ?? -1
    const destinationOrder = stationOrder.get('shizuoka') ?? -1
    expect(results.every((result) => {
      const start = stationOrder.get(result.segmentStartStop.stationId) ?? -1
      const end = stationOrder.get(result.segmentEndStop.stationId) ?? -1
      return start >= originOrder && end <= destinationOrder && end > start
    })).toBe(true)
    expect(results.some((result) => result.matchType === 'intermediate_overlap')).toBe(true)
  })

  it('classifies every service in the changing daily snapshot', () => {
    const validStatuses = new Set([
      'full_convertible',
      'reclining',
      'partial_cross',
      'box_fixed',
      'all_longitudinal',
      'unknown',
    ])
    const summaries = timetable.services.map((service) =>
      formationAtStation(
        service,
        service.stops[0].stationId,
        timetable.stations,
        latest,
        formations.formations,
      ),
    )

    expect(summaries.some((summary) => summary.status !== 'unknown')).toBe(true)
    for (const summary of summaries) {
      expect(validStatuses.has(summary.status)).toBe(true)
      if (summary.status === 'unknown') {
        expect(summary.crossSeatCarCount).toBeNull()
        expect(summary.totalCarCount).toBeNull()
      } else {
        expect(summary.crossSeatCarCount).not.toBeNull()
        expect(summary.totalCarCount).not.toBeNull()
        expect(summary.crossSeatCarCount ?? 0).toBeLessThanOrEqual(summary.totalCarCount ?? 0)
      }
    }
  })

  it('attaches checked-in archive estimates only to unknown diagrammed segments', () => {
    const model = formationModelJson as FormationModelData
    expect(model.trainingDates).toEqual(historyIndexJson.dates.map((entry) => entry.serviceDate).sort())
    for (const service of timetable.services) {
      for (const segment of service.operationSegments) {
        const summary = formationAtStation(
          service, segment.fromStationId, timetable.stations, latest, formations.formations, model,
        )
        if (!summary.prediction) continue
        expect(summary.status).toBe('unknown')
        expect(segment.diagramIds.length).toBeGreaterThan(0)
        expect(summary.prediction.crossSeatProbability).toBeGreaterThanOrEqual(0)
        expect(summary.prediction.crossSeatProbability).toBeLessThanOrEqual(1)
        expect(summary.prediction.observedDays).toBeGreaterThanOrEqual(model.minimumObservedDays)
        expect(summary.prediction.likelyFamilies.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps JR Central times while carrying conservative planned operation metadata', () => {
    const service = timetable.services.find((candidate) => candidate.trainNumber === '1420M')
    expect(service).toBeDefined()

    const numazu = service?.stops.find((stop) => stop.stationId === 'numazu')
    expect(numazu?.departure).toBe('04:56')
    expect(service?.operationSegments).toContainEqual({
      fromStationId: 'numazu',
      toStationId: 'atami',
      diagramIds: ['A75'],
      plannedFormations: [{ diagramId: 'A75', family: 'U' }],
    })

    const mixedService = timetable.services.find((candidate) => candidate.trainNumber === '1422M')
    expect(mixedService?.operationSegments[0]?.diagramIds).toEqual(['A27', 'A41'])
    expect(mixedService?.operationSegments[0]?.plannedFormations).toEqual([])
  })

  it('finds a complete checked-in route that includes an indirect result', () => {
    const results = searchUpcomingTrains(timetable, 'hamamatsu', 'shizuoka', '14:00', false)
    const planner = createScheduledJourneyPlanner(timetable, false)
    const planned = results
      .filter((result) => result.matchType !== 'direct')
      .map((result) => ({
        result,
        journey: planner.findFastestIncluding(
          'hamamatsu',
          'shizuoka',
          '14:00',
          result.service.id,
          result.segmentStartStop.stationId,
        ),
      }))
      .find(({ journey }) => journey !== null)

    expect(planned).toBeDefined()
    expect(planned?.journey?.legs[0].fromStop.stationId).toBe('hamamatsu')
    expect(planned?.journey?.legs.at(-1)?.toStop.stationId).toBe('shizuoka')
    expect(
      planned?.journey?.legs.some((leg) => leg.service.id === planned.result.service.id),
    ).toBe(true)
  })

  it('uses the latest practical feeder for 763M from Atami to Toyohashi', () => {
    const regressionTimetable = journeyRegressionJson.timetable as TimetableData
    const featured = regressionTimetable.services.find(
      (service) =>
        service.trainNumber === '763M' &&
        service.stops.some(
          (stop) => stop.stationId === 'mishima' && stop.departure === '09:05',
        ),
    )
    expect(featured).toBeDefined()

    const journey = createScheduledJourneyPlanner(regressionTimetable, false).findFastestIncluding(
      'atami',
      'toyohashi',
      '06:00',
      featured!.id,
      'mishima',
    )

    expect(journey?.legs.map((leg) => leg.service.trainNumber)).toEqual([
      '1425M',
      '763M',
      '957M',
    ])
    expect(journey?.legs[0].fromStop.departure).toBe('08:47')
    expect(journey?.legs[0].toStop.arrival).toBe('09:00')
    expect(journey?.arrivalMinutes).toBe(12 * 60)
    expect(journey?.durationMinutes).toBe(193)
  })

  it('keeps every planned indirect Atami-to-Toyohashi itinerary internally consistent', () => {
    const indirectResults = searchUpcomingTrains(
      timetable,
      'atami',
      'toyohashi',
      '06:00',
      false,
    ).filter((result) => result.matchType !== 'direct')
    const planningStartedAt = performance.now()
    const planner = createScheduledJourneyPlanner(timetable, false)
    const planned = indirectResults
      .map((result) => ({
        result,
        journey: planner.findFastestIncluding(
          'atami',
          'toyohashi',
          '06:00',
          result.service.id,
          result.segmentStartStop.stationId,
        ),
      }))
      .filter((candidate) => candidate.journey !== null)
    const planningElapsedMilliseconds = performance.now() - planningStartedAt

    expect(indirectResults.length).toBeGreaterThan(0)
    expect(planned.length).toBeGreaterThan(0)
    expect(planningElapsedMilliseconds).toBeLessThan(1500)
    for (const { result, journey } of planned) {
      expect(journey?.legs[0].fromStop.stationId).toBe('atami')
      expect(journey?.legs.at(-1)?.toStop.stationId).toBe('toyohashi')
      const featuredLegs = journey?.legs.filter(
        (leg) => leg.service.id === result.service.id,
      ) ?? []
      expect(featuredLegs).toHaveLength(1)
      expect(featuredLegs[0].fromStop.stationId).toBe(result.segmentStartStop.stationId)
      if (result.segmentStartStop.stationId !== 'atami') {
        const latestDirectFeederDeparture = timetable.services.reduce<number | null>(
          (latestDeparture, service) => {
            if (
              service.id === result.service.id ||
              service.direction !== result.service.direction ||
              !serviceRunsToday(service, false)
            ) {
              return latestDeparture
            }
            const originIndex = service.stops.findIndex((stop) => stop.stationId === 'atami')
            const boardIndex = service.stops.findIndex(
              (stop, index) =>
                index > originIndex &&
                stop.stationId === result.segmentStartStop.stationId,
            )
            if (originIndex < 0 || boardIndex < 0) return latestDeparture
            const departureMinutes = stopMinutes(service.stops[originIndex], 'departure')
            const arrivalMinutes = stopMinutes(service.stops[boardIndex], 'arrival')
            if (
              Number.isNaN(departureMinutes) ||
              Number.isNaN(arrivalMinutes) ||
              departureMinutes < 6 * 60 ||
              arrivalMinutes > result.departureMinutes
            ) {
              return latestDeparture
            }
            return Math.max(latestDeparture ?? Number.NEGATIVE_INFINITY, departureMinutes)
          },
          null,
        )
        if (latestDirectFeederDeparture !== null) {
          expect(journey!.departureMinutes).toBeGreaterThanOrEqual(latestDirectFeederDeparture)
        }
      }
      for (let index = 1; index < (journey?.legs.length ?? 0); index += 1) {
        const previous = journey!.legs[index - 1]
        const next = journey!.legs[index]
        expect(previous.toStop.stationId).toBe(next.fromStop.stationId)
        expect(previous.arrivalMinutes).toBeLessThanOrEqual(next.departureMinutes)
      }
    }
  })
})
