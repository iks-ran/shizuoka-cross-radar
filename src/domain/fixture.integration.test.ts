import { describe, expect, it } from 'vitest'
import formationsJson from '../../public/data/formations.json'
import latestJson from '../../public/data/latest.json'
import timetableJson from '../../public/data/timetable.json'
import type { FormationsData, LatestData, TimetableData } from '../types'
import { formationAtStation } from './classification'
import { searchUpcomingTrains } from './search'

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
})
