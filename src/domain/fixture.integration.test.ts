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
  it('can query a Hamamatsu to Shizuoka first leg', () => {
    expect(timetable.isFixture).toBe(false)
    expect(timetable.source.id).toBe('jr-central')
    const results = searchUpcomingTrains(timetable, 'hamamatsu', 'shizuoka', '14:00', false)
    expect(results.length).toBeGreaterThanOrEqual(5)
    expect(results.every((result) => result.originStop.stationId === 'hamamatsu')).toBe(true)
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
