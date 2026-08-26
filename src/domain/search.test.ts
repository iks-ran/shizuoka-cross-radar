import { describe, expect, it } from 'vitest'
import type { TimetableData, TrainService } from '../types'
import { searchUpcomingTrains } from './search'

const stations = ['a', 'b', 'c', 'd'].map((id, order) => ({
  id,
  order,
  name: { ja: id, en: id, zhCN: id },
}))

const service = (
  id: string,
  direction: 'eastbound' | 'westbound',
  stationIds: string[],
  departure: string,
): TrainService => {
  const startMinutes = Number(departure.slice(0, 2)) * 60 + Number(departure.slice(3))
  return {
    id,
    trainNumber: id,
    destinationStationId: stationIds.at(-1)!,
    destinationName: { ja: '終点', en: 'Terminal', zhCN: '终点' },
    direction,
    serviceDays: ['all'],
    stops: stationIds.map((stationId, index) => {
      const minutes = startMinutes + index * 10
      const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      return {
        stationId,
        arrival: index === 0 ? null : clock,
        departure: index === stationIds.length - 1 ? null : clock,
        dayOffset: 0,
      }
    }),
    operationSegments: [{ fromStationId: stationIds[0], toStationId: stationIds.at(-1)!, diagramIds: ['A1'] }],
  }
}

const timetable: TimetableData = {
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate: null,
  updatedAt: null,
  source: { id: 'fixture', label: 'Fixture timetable', url: null, isMock: true },
  isFixture: true,
  stations,
  services: [
    service('through-later', 'eastbound', ['a', 'b', 'c', 'd'], '10:30'),
    service('short-first', 'eastbound', ['a', 'b', 'c'], '10:10'),
    service('too-early', 'eastbound', ['a', 'b', 'c', 'd'], '09:30'),
    service('wrong-way', 'westbound', ['d', 'c', 'b', 'a'], '10:00'),
  ],
}

describe('searchUpcomingTrains', () => {
  it('sorts upcoming direct and first-leg trains', () => {
    const results = searchUpcomingTrains(timetable, 'a', 'd', '10:00', false)
    expect(results.map((result) => result.service.id)).toEqual(['short-first', 'through-later'])
    expect(results[0].transferRequired).toBe(true)
    expect(results[0].arrivalStop.stationId).toBe('c')
    expect(results[1].transferRequired).toBe(false)
    expect(results[1].arrivalStop.stationId).toBe('d')
  })

  it('rejects an identical origin and destination', () => {
    expect(searchUpcomingTrains(timetable, 'a', 'a', '10:00', false)).toEqual([])
  })

  it('filters by travel direction', () => {
    const results = searchUpcomingTrains(timetable, 'd', 'a', '09:00', false)
    expect(results.map((result) => result.service.id)).toEqual(['wrong-way'])
  })
})
