import { describe, expect, it } from 'vitest'
import type { TimetableData, TrainService } from '../types'
import { createScheduledJourneyPlanner } from './journey'

const stations = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({
  id,
  order,
  name: { ja: id, en: id, zhCN: id },
}))

const service = (
  id: string,
  stops: Array<[
    stationId: string,
    arrival: string | null,
    departure: string | null,
    dayOffset?: number,
  ]>,
  direction: TrainService['direction'] = 'eastbound',
): TrainService => ({
  id,
  trainNumber: id,
  destinationStationId: stops.at(-1)![0],
  destinationName: { ja: '終点', en: 'Terminal', zhCN: '终点' },
  direction,
  serviceDays: ['all'],
  stops: stops.map(([stationId, arrival, departure, dayOffset = 0]) => ({
    stationId,
    arrival,
    departure,
    dayOffset,
  })),
  operationSegments: [{
    fromStationId: stops[0][0],
    toStationId: stops.at(-1)![0],
    diagramIds: [],
  }],
})

const timetable = (services: TrainService[]): TimetableData => ({
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate: null,
  updatedAt: null,
  source: { id: 'fixture', label: 'Fixture', url: null, isMock: true },
  isFixture: true,
  stations,
  services,
})

describe('createScheduledJourneyPlanner', () => {
  it('finds the earliest complete first-leg itinerary that includes the featured train', () => {
    const featured = service('featured', [
      ['a', null, '10:00'],
      ['b', '10:20', null],
    ])
    const slowerConnection = service('slow', [
      ['b', null, '10:21'],
      ['d', '11:00', null],
    ])
    const fasterConnection = service('fast', [
      ['b', null, '10:25'],
      ['d', '10:50', null],
    ])
    const unrelatedDirect = service('direct', [
      ['a', null, '09:30'],
      ['d', '10:30', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured, slowerConnection, fasterConnection, unrelatedDirect]),
      false,
    ).findFastestIncluding('a', 'd', '09:00', featured.id, 'a')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['featured', 'fast'])
    expect(journey?.arrivalMinutes).toBe(10 * 60 + 50)
    expect(journey?.transferCount).toBe(1)
    expect(journey?.featuredDurationMinutes).toBe(20)
  })

  it('chooses the latest feasible feeder when the completed arrival is unchanged', () => {
    const earlyFeeder = service('early-feeder', [
      ['a', null, '06:18'],
      ['b', '06:30', null],
    ])
    const lateFeeder = service('late-feeder', [
      ['a', null, '08:47'],
      ['b', '09:00', null],
    ])
    const featured = service('featured', [
      ['b', null, '09:05'],
      ['d', '11:21', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([earlyFeeder, lateFeeder, featured]),
      false,
    ).findFastestIncluding('a', 'd', '06:00', featured.id, 'b')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['late-feeder', 'featured'])
    expect(journey?.departureMinutes).toBe(8 * 60 + 47)
    expect(journey?.durationMinutes).toBe(154)
  })

  it('uses fewer transfers when arrival and origin departure are tied', () => {
    const directFeeder = service('direct-feeder', [
      ['a', null, '10:00'],
      ['c', '10:30', null],
    ])
    const splitOne = service('split-one', [
      ['a', null, '10:00'],
      ['b', '10:10', null],
    ])
    const splitTwo = service('split-two', [
      ['b', null, '10:10'],
      ['c', '10:30', null],
    ])
    const featured = service('featured', [
      ['c', null, '10:35'],
      ['d', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([splitOne, splitTwo, directFeeder, featured]),
      false,
    ).findFastestIncluding('a', 'd', '09:50', featured.id, 'c')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['direct-feeder', 'featured'])
    expect(journey?.transferCount).toBe(1)
  })

  it('retains a lower-transfer feeder when another route leaves an intermediate station later', () => {
    const commonStart = service('common-start', [
      ['a', null, '09:50'],
      ['b', '10:10', null],
    ])
    const earlierDirect = service('earlier-direct', [
      ['b', null, '10:20'],
      ['d', '10:40', null],
    ])
    const laterSplitOne = service('later-split-one', [
      ['b', null, '10:30'],
      ['c', '10:35', null],
    ])
    const laterSplitTwo = service('later-split-two', [
      ['c', null, '10:35'],
      ['d', '10:40', null],
    ])
    const featured = service('featured', [
      ['d', null, '10:45'],
      ['e', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([commonStart, laterSplitOne, laterSplitTwo, earlierDirect, featured]),
      false,
    ).findFastestIncluding('a', 'e', '09:40', featured.id, 'd')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual([
      'common-start',
      'earlier-direct',
      'featured',
    ])
  })

  it('uses less transfer waiting after arrival, departure, and transfer count tie', () => {
    const routeOneStart = service('route-one-start', [
      ['a', null, '10:00'],
      ['b', '10:05', null],
    ])
    const routeOneEnd = service('route-one-end', [
      ['b', null, '10:25'],
      ['d', '10:30', null],
    ])
    const routeTwoStart = service('route-two-start', [
      ['a', null, '10:00'],
      ['c', '10:15', null],
    ])
    const routeTwoEnd = service('route-two-end', [
      ['c', null, '10:20'],
      ['d', '10:30', null],
    ])
    const featured = service('featured', [
      ['d', null, '10:35'],
      ['e', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([routeOneStart, routeOneEnd, routeTwoStart, routeTwoEnd, featured]),
      false,
    ).findFastestIncluding('a', 'e', '09:50', featured.id, 'd')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual([
      'route-two-start',
      'route-two-end',
      'featured',
    ])
  })

  it('builds feeder and onward legs around an intermediate featured train', () => {
    const feeder = service('feeder', [
      ['a', null, '10:00'],
      ['b', '10:15', null],
    ])
    const featured = service('featured', [
      ['b', null, '10:20'],
      ['c', '10:35', null],
    ])
    const onward = service('onward', [
      ['c', null, '10:40'],
      ['d', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([feeder, featured, onward]),
      false,
    ).findFastestIncluding('a', 'd', '09:50', featured.id, 'b')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['feeder', 'featured', 'onward'])
    expect(journey?.transferCount).toBe(2)
    expect(journey?.durationMinutes).toBe(60)
  })

  it('can leave the featured train early for a faster arrival', () => {
    const featured = service('featured', [
      ['a', null, '10:00'],
      ['b', '10:15', '10:16'],
      ['c', '10:40', null],
    ])
    const fast = service('fast', [
      ['b', null, '10:16'],
      ['d', '10:45', null],
    ])
    const slow = service('slow', [
      ['c', null, '10:45'],
      ['d', '11:10', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured, fast, slow]),
      false,
    ).findFastestIncluding('a', 'd', '09:50', featured.id, 'a')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['featured', 'fast'])
    expect(journey?.legs[0].toStop.stationId).toBe('b')
    expect(journey?.arrivalMinutes).toBe(10 * 60 + 45)
  })

  it('uses fewer onward transfers when complete arrival times tie', () => {
    const featured = service('featured', [
      ['a', null, '10:00'],
      ['b', '10:10', null],
    ])
    const direct = service('direct-onward', [
      ['b', null, '10:20'],
      ['e', '11:00', null],
    ])
    const splitOne = service('split-onward-one', [
      ['b', null, '10:20'],
      ['c', '10:30', null],
    ])
    const splitTwo = service('split-onward-two', [
      ['c', null, '10:30'],
      ['e', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured, splitOne, splitTwo, direct]),
      false,
    ).findFastestIncluding('a', 'e', '09:50', featured.id, 'a')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual([
      'featured',
      'direct-onward',
    ])
  })

  it('uses less onward transfer waiting after arrival and transfer count tie', () => {
    const featured = service('featured', [
      ['a', null, '10:00'],
      ['b', '10:10', null],
    ])
    const slowStart = service('slow-wait-start', [
      ['b', null, '10:30'],
      ['c', '10:40', null],
    ])
    const slowEnd = service('slow-wait-end', [
      ['c', null, '10:50'],
      ['e', '11:00', null],
    ])
    const quickStart = service('quick-wait-start', [
      ['b', null, '10:10'],
      ['d', '10:30', null],
    ])
    const quickEnd = service('quick-wait-end', [
      ['d', null, '10:40'],
      ['e', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured, slowStart, slowEnd, quickStart, quickEnd]),
      false,
    ).findFastestIncluding('a', 'e', '09:50', featured.id, 'a')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual([
      'featured',
      'quick-wait-start',
      'quick-wait-end',
    ])
  })

  it('returns null when no scheduled path can catch the featured train', () => {
    const lateFeeder = service('late-feeder', [
      ['a', null, '10:00'],
      ['b', '10:21', null],
    ])
    const featured = service('featured', [
      ['b', null, '10:20'],
      ['c', '10:40', '10:41'],
      ['d', '11:00', null],
    ])
    const overtakingFeeder = service('overtaking-feeder', [
      ['a', null, '10:00'],
      ['b', null, null],
      ['c', '10:35', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([lateFeeder, featured, overtakingFeeder]),
      false,
    ).findFastestIncluding('a', 'd', '09:50', featured.id, 'b')

    expect(journey).toBeNull()
  })

  it('returns null when the featured train cannot connect to the destination', () => {
    const featured = service('dead-end-featured', [
      ['a', null, '10:00'],
      ['b', '10:20', null],
    ])
    const unrelated = service('unrelated-onward', [
      ['c', null, '10:30'],
      ['e', '11:00', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured, unrelated]),
      false,
    ).findFastestIncluding('a', 'e', '09:50', featured.id, 'a')

    expect(journey).toBeNull()
  })

  it('plans the complete route in the reverse corridor direction', () => {
    const featured = service('featured-west', [
      ['d', null, '10:00'],
      ['c', '10:20', null],
    ], 'westbound')
    const onward = service('onward-west', [
      ['c', null, '10:25'],
      ['a', '11:00', null],
    ], 'westbound')

    const journey = createScheduledJourneyPlanner(
      timetable([featured, onward]),
      false,
    ).findFastestIncluding('d', 'a', '09:50', featured.id, 'd')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual(['featured-west', 'onward-west'])
    expect(journey?.legs.at(-1)?.toStop.stationId).toBe('a')
  })

  it('uses day offsets for a featured connection after midnight', () => {
    const feeder = service('overnight-feeder', [
      ['a', null, '23:40', 0],
      ['b', '00:00', null, 1],
    ])
    const featured = service('overnight-featured', [
      ['b', null, '00:10', 1],
      ['d', '01:00', null, 1],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([feeder, featured]),
      false,
    ).findFastestIncluding('a', 'd', '23:30', featured.id, 'b')

    expect(journey?.legs.map((leg) => leg.service.id)).toEqual([
      'overnight-feeder',
      'overnight-featured',
    ])
    expect(journey?.arrivalMinutes).toBe(25 * 60)
    expect(journey?.durationMinutes).toBe(80)
  })

  it('rejects a featured boarding outside the selected corridor', () => {
    const featured = service('featured-outside', [
      ['d', null, '10:00'],
      ['e', '10:20', null],
    ])

    const journey = createScheduledJourneyPlanner(
      timetable([featured]),
      false,
    ).findFastestIncluding('a', 'c', '09:00', featured.id, 'd')

    expect(journey).toBeNull()
  })
})
