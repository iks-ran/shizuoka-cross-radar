import { describe, expect, it } from 'vitest'
import type { TimetableData, TrainService } from '../types'
import { searchUpcomingTrains } from './search'

const stations = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({
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
    service('intermediate', 'eastbound', ['b', 'c', 'd', 'e'], '10:20'),
    service('touches-origin', 'eastbound', ['a', 'b'], '09:00'),
    service('touches-destination', 'eastbound', ['d', 'e'], '10:00'),
    service('too-early', 'eastbound', ['a', 'b', 'c', 'd'], '09:30'),
    service('west-intermediate', 'westbound', ['c', 'b', 'a'], '09:40'),
    service('wrong-way', 'westbound', ['d', 'c', 'b', 'a'], '10:00'),
  ],
}

describe('searchUpcomingTrains', () => {
  it('sorts direct, first-leg, and intermediate-overlap trains by usable departure time', () => {
    const results = searchUpcomingTrains(timetable, 'a', 'd', '10:00', false)
    expect(results.map((result) => result.service.id)).toEqual([
      'short-first',
      'intermediate',
      'through-later',
    ])
    expect(results.map((result) => result.matchType)).toEqual([
      'first_leg',
      'intermediate_overlap',
      'direct',
    ])
    expect(results[0].segmentStartStop.stationId).toBe('a')
    expect(results[0].segmentEndStop.stationId).toBe('c')
    expect(results[1].segmentStartStop.stationId).toBe('b')
    expect(results[1].segmentEndStop.stationId).toBe('d')
    expect(results.map((result) => result.departureMinutes)).toEqual([610, 620, 630])
  })

  it('requires overlap of a full line segment rather than one touched station', () => {
    const results = searchUpcomingTrains(timetable, 'b', 'd', '09:00', false)
    expect(results.map((result) => result.service.id)).not.toContain('touches-origin')
    expect(results.map((result) => result.service.id)).not.toContain('touches-destination')
  })

  it('does not use arrival time as a secondary sort key', () => {
    const tiedTimetable = {
      ...timetable,
      services: [
        service('longer-first', 'eastbound', ['a', 'b', 'c', 'd'], '11:00'),
        service('shorter-second', 'eastbound', ['a', 'b'], '11:00'),
      ],
    }
    const results = searchUpcomingTrains(tiedTimetable, 'a', 'd', '10:00', false)
    expect(results.map((result) => result.service.id)).toEqual(['longer-first', 'shorter-second'])
  })

  it('rejects an identical origin and destination', () => {
    expect(searchUpcomingTrains(timetable, 'a', 'a', '10:00', false)).toEqual([])
  })

  it('filters by travel direction', () => {
    const results = searchUpcomingTrains(timetable, 'd', 'a', '09:00', false)
    expect(results.map((result) => result.service.id)).toEqual(['west-intermediate', 'wrong-way'])
    expect(results.map((result) => result.matchType)).toEqual(['intermediate_overlap', 'direct'])
    expect(results[0].segmentStartStop.stationId).toBe('c')
    expect(results[0].segmentEndStop.stationId).toBe('a')
  })
})
