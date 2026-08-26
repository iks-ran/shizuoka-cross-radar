import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { getTokyoDate } from './domain/time'

const timetable = {
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate: null,
  updatedAt: null,
  source: { id: 'fixture', label: 'Fixture timetable', url: null, isMock: true },
  isFixture: true,
  stations: [
    { id: 'hamamatsu', order: 0, name: { ja: '浜松', en: 'Hamamatsu', zhCN: '滨松' } },
    { id: 'shizuoka', order: 1, name: { ja: '静岡', en: 'Shizuoka', zhCN: '静冈' } },
  ],
  services: [],
}

const formations = {
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  verifiedAt: '2026-08-26',
  formations: [],
}

const latest = {
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate: '2026-08-26',
  updatedAt: '2026-08-26T11:20:04+09:00',
  source: { id: 'fixture', label: 'Fixture', url: null, isMock: true },
  assignments: [],
}

describe('App', () => {
  afterEach(cleanup)

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable') ? timetable : url.includes('formations') ? formations : latest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )
  })

  it('renders the disclosed fixture experience and search controls', async () => {
    render(<App />)
    expect(await screen.findByText('Demo data')).toBeInTheDocument()
    expect(screen.getByText('Tokaido Main Line')).toBeInTheDocument()
    expect(screen.getByText('Toyohashi — Atami')).toBeInTheDocument()
    expect(screen.queryByText('Toyohashi ↔ Atami · Tokaido Main Line')).not.toBeInTheDocument()
    expect(screen.getByText('Independent passenger guide · Not an official JR Central service')).toBeInTheDocument()
    expect(screen.getByLabelText('Departure station')).toHaveValue('hamamatsu')
    expect(screen.getByLabelText('Destination station')).toHaveValue('shizuoka')
    expect(screen.getByLabelText('Show direct trains confirmed without cross seats')).toBeChecked()
    expect(screen.getByLabelText('Show direct trains with unknown seating')).toBeChecked()
    expect(screen.getByLabelText('Show indirect trains with unknown seating')).toBeChecked()
    expect(screen.getByLabelText('Require minimum time on the featured indirect train')).not.toBeChecked()
    expect(screen.getByText('No matching trains remain after this time.')).toBeInTheDocument()
  })

  it('does not label aligned live snapshots as fixture data', async () => {
    const serviceDate = getTokyoDate()
    const liveTimetable = {
      ...timetable,
      serviceDate,
      updatedAt: new Date().toISOString(),
      source: {
        id: 'jr-central',
        label: 'JR Central conventional-line train information',
        url: 'https://traininfo.jr-central.co.jp/',
        isMock: false,
      },
      isFixture: false,
    }
    const liveLatest = {
      ...latest,
      serviceDate,
      updatedAt: new Date().toISOString(),
      source: {
        id: 'tokaido-shizuoka',
        label: 'Tokaido Shizuoka',
        url: 'https://tokaido-unyo-shizuoka.com/unyo/',
        isMock: false,
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable')
          ? liveTimetable
          : url.includes('formations')
            ? formations
            : liveLatest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )

    render(<App />)
    expect(await screen.findByLabelText('Departure station')).toBeInTheDocument()
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument()
    expect(screen.getByText(/Timetable: JR Central/)).toBeInTheDocument()
    expect(screen.getByText('Formations: Tokaido Shizuoka')).toBeInTheDocument()
  })

  it('shows the fastest complete scheduled route for an intermediate overlap', async () => {
    const overlapTimetable = {
      ...timetable,
      stations: [
        timetable.stations[0],
        { id: 'kakegawa', order: 1, name: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' } },
        { ...timetable.stations[1], order: 2 },
      ],
      services: [
        {
          id: 'hamamatsu-kakegawa',
          trainNumber: '90M',
          destinationStationId: 'kakegawa',
          destinationName: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' },
          direction: 'eastbound',
          serviceDays: ['all'],
          stops: [
            { stationId: 'hamamatsu', arrival: null, departure: '09:30', dayOffset: 0 },
            { stationId: 'kakegawa', arrival: '09:55', departure: null, dayOffset: 0 },
          ],
          operationSegments: [
            { fromStationId: 'hamamatsu', toStationId: 'kakegawa', diagramIds: ['A2'] },
          ],
        },
        {
          id: 'kakegawa-shizuoka',
          trainNumber: '100M',
          destinationStationId: 'shizuoka',
          destinationName: { ja: '静岡', en: 'Shizuoka', zhCN: '静冈' },
          direction: 'eastbound',
          serviceDays: ['all'],
          stops: [
            { stationId: 'kakegawa', arrival: null, departure: '10:00', dayOffset: 0 },
            { stationId: 'shizuoka', arrival: '10:45', departure: null, dayOffset: 0 },
          ],
          operationSegments: [
            { fromStationId: 'kakegawa', toStationId: 'shizuoka', diagramIds: ['A1'] },
          ],
        },
      ],
    }
    const routeFormations = {
      ...formations,
      formations: [
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
          family: 'U',
          series: '315-3000',
          carCount: 4,
          crossSeatCarCount: 0,
          layout: 'longitudinal',
          verified: true,
          evidenceUrl: null,
        },
      ],
    }
    const routeLatest = {
      ...latest,
      assignments: [
        { diagramId: 'A1', rawFormation: 'K1', currentUnits: ['K1'], parseStatus: 'parsed' },
        { diagramId: 'A2', rawFormation: 'U1', currentUnits: ['U1'], parseStatus: 'parsed' },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable')
          ? overlapTimetable
          : url.includes('formations')
            ? routeFormations
            : routeLatest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Departure time (JST)'), { target: { value: '00:00' } })

    const routeKind = await screen.findByText('Intermediate overlap')
    expect(screen.getByText('Overlap segment: Kakegawa → Shizuoka')).toBeInTheDocument()
    const trainCard = routeKind.closest('article')
    expect(trainCard).not.toBeNull()
    expect(within(trainCard!).getByText('Fastest complete route')).toBeInTheDocument()
    expect(within(trainCard!).getByText('90M')).toBeInTheDocument()
    expect(within(trainCard!).getAllByText('100M')).toHaveLength(2)
    expect(within(trainCard!).getByText('45 min on this train')).toBeInTheDocument()
    expect(within(trainCard!).getByText('Arrive Shizuoka at 10:45')).toBeInTheDocument()
    expect(within(trainCard!).getByText('Transfers: 1')).toBeInTheDocument()
    const journeyLegs = trainCard!.querySelector<HTMLElement>('.journey-legs')
    expect(journeyLegs).not.toBeNull()
    expect(within(journeyLegs!).getByText('All longitudinal seating')).toBeInTheDocument()
    expect(within(journeyLegs!).getByText('U1')).toBeInTheDocument()
    expect(within(journeyLegs!).getByText('Full convertible cross seating')).toBeInTheDocument()
    expect(within(journeyLegs!).getByText('K1')).toBeInTheDocument()
    expect(
      within(trainCard!).getByText(
        'Scheduled-time estimate only; platform walking, delays, and guaranteed connections are not modeled.',
      ),
    ).toBeInTheDocument()

    const minimumToggle = screen.getByLabelText('Require minimum time on the featured indirect train')
    const minimumInput = screen.getByRole('spinbutton', { name: /Minimum featured-train time/ })
    expect(minimumInput).toBeDisabled()
    fireEvent.click(minimumToggle)
    expect(minimumInput).toBeEnabled()
    fireEvent.change(minimumInput, { target: { value: '50' } })
    expect(await screen.findByText('No matching trains remain after this time.')).toBeInTheDocument()
    expect(screen.queryByText('100M')).not.toBeInTheDocument()
  })

  it('hides an intermediate overlap that has no complete scheduled route', async () => {
    const unreachableTimetable = {
      ...timetable,
      stations: [
        timetable.stations[0],
        { id: 'kakegawa', order: 1, name: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' } },
        { ...timetable.stations[1], order: 2 },
      ],
      services: [
        {
          id: 'unreachable-intermediate',
          trainNumber: '300M',
          destinationStationId: 'shizuoka',
          destinationName: { ja: '静岡', en: 'Shizuoka', zhCN: '静冈' },
          direction: 'eastbound',
          serviceDays: ['all'],
          stops: [
            { stationId: 'kakegawa', arrival: null, departure: '10:00', dayOffset: 0 },
            { stationId: 'shizuoka', arrival: '10:45', departure: null, dayOffset: 0 },
          ],
          operationSegments: [
            { fromStationId: 'kakegawa', toStationId: 'shizuoka', diagramIds: ['A3'] },
          ],
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable')
          ? unreachableTimetable
          : url.includes('formations')
            ? formations
            : latest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Departure time (JST)'), { target: { value: '00:00' } })

    expect(await screen.findByText('No matching trains remain after this time.')).toBeInTheDocument()
    expect(screen.queryByText('300M')).not.toBeInTheDocument()
  })

  it('hides a first-leg train whose overlap formation is confirmed longitudinal', async () => {
    const firstLegTimetable = {
      ...timetable,
      stations: [
        timetable.stations[0],
        { id: 'kakegawa', order: 1, name: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' } },
        { ...timetable.stations[1], order: 2 },
      ],
      services: [
        {
          id: 'longitudinal-first-leg',
          trainNumber: '200M',
          destinationStationId: 'kakegawa',
          destinationName: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' },
          direction: 'eastbound',
          serviceDays: ['all'],
          stops: [
            { stationId: 'hamamatsu', arrival: null, departure: '10:00', dayOffset: 0 },
            { stationId: 'kakegawa', arrival: '10:30', departure: null, dayOffset: 0 },
          ],
          operationSegments: [
            {
              fromStationId: 'hamamatsu',
              toStationId: 'kakegawa',
              diagramIds: ['A75'],
              plannedFormations: [{ diagramId: 'A75', family: 'U' }],
            },
          ],
        },
      ],
    }
    const longitudinalFormations = {
      ...formations,
      formations: [
        {
          family: 'U',
          series: '315-3000',
          carCount: 4,
          crossSeatCarCount: 0,
          layout: 'longitudinal',
          verified: true,
          evidenceUrl: null,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable')
          ? firstLegTimetable
          : url.includes('formations')
            ? longitudinalFormations
            : latest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Departure time (JST)'), { target: { value: '00:00' } })

    expect(await screen.findByText('No matching trains remain after this time.')).toBeInTheDocument()
    expect(screen.queryByText('200M')).not.toBeInTheDocument()
  })

  it('shows a disclosed planned formation when the current snapshot cannot be loaded', async () => {
    const plannedTimetable = {
      ...timetable,
      serviceDate: getTokyoDate(),
      updatedAt: new Date().toISOString(),
      source: {
        id: 'jr-central',
        label: 'JR Central conventional-line train information',
        url: 'https://traininfo.jr-central.co.jp/',
        isMock: false,
      },
      isFixture: false,
      services: [
        {
          id: 'planned-u-service',
          trainNumber: '1420M',
          destinationStationId: 'shizuoka',
          destinationName: timetable.stations[1].name,
          direction: 'eastbound',
          serviceDays: ['all'],
          stops: [
            { stationId: 'hamamatsu', arrival: null, departure: '04:56', dayOffset: 0 },
            { stationId: 'shizuoka', arrival: '06:10', departure: null, dayOffset: 0 },
          ],
          operationSegments: [
            {
              fromStationId: 'hamamatsu',
              toStationId: 'shizuoka',
              diagramIds: ['A75'],
              plannedFormations: [{ diagramId: 'A75', family: 'U' }],
            },
          ],
        },
      ],
    }
    const plannedFormations = {
      ...formations,
      formations: [
        {
          family: 'U',
          series: '315-3000',
          carCount: 4,
          crossSeatCarCount: 0,
          layout: 'longitudinal',
          verified: true,
          evidenceUrl: null,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('timetable')) {
          return Promise.resolve(new Response(JSON.stringify(plannedTimetable), { status: 200 }))
        }
        if (url.includes('formations')) {
          return Promise.resolve(new Response(JSON.stringify(plannedFormations), { status: 200 }))
        }
        return Promise.resolve(new Response('unavailable', { status: 503 }))
      }),
    )

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Departure time (JST)'), { target: { value: '00:00' } })

    expect(await screen.findByText('All longitudinal seating')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText('Planned formation; substitutions may not be reflected.')).toBeInTheDocument()
    expect(
      screen.getByText('Current formation data could not be loaded; verified planned formations may still be shown.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show direct trains confirmed without cross seats'))
    expect(await screen.findByText('No matching trains remain after this time.')).toBeInTheDocument()
    expect(screen.queryByText('1420M')).not.toBeInTheDocument()
  })
})
