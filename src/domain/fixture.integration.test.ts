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

describe('checked-in fixture data', () => {
  it('can query a Hamamatsu to Shizuoka first leg', () => {
    const results = searchUpcomingTrains(timetable, 'hamamatsu', 'shizuoka', '14:00', false)
    expect(results.length).toBeGreaterThanOrEqual(5)
    expect(results.every((result) => result.originStop.stationId === 'hamamatsu')).toBe(true)
  })

  it('exercises all known seat status groups', () => {
    const statuses = new Set(
      timetable.services.map((service) =>
        formationAtStation(
          service,
          service.stops[0].stationId,
          timetable.stations,
          latest,
          formations.formations,
        ).status,
      ),
    )
    expect(statuses).toEqual(
      new Set(['full_convertible', 'partial_cross', 'box_fixed', 'all_longitudinal']),
    )
  })
})
