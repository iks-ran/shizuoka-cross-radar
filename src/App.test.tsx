import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByLabelText('Departure station')).toHaveValue('hamamatsu')
    expect(screen.getByLabelText('Destination station')).toHaveValue('shizuoka')
    expect(screen.getByText('No matching trains remain after this time.')).toBeInTheDocument()
  })

  it('does not label aligned JR Central and Yulog snapshots as fixture data', async () => {
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
      source: { id: 'yulog', label: 'Yulog', url: 'https://yulog.app/unyo/', isMock: false },
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
    expect(screen.getByText('Formations: Yulog')).toBeInTheDocument()
  })

  it('labels an intermediate overlap and warns that catchability is not calculated', async () => {
    const overlapTimetable = {
      ...timetable,
      stations: [
        timetable.stations[0],
        { id: 'kakegawa', order: 1, name: { ja: '掛川', en: 'Kakegawa', zhCN: '挂川' } },
        { ...timetable.stations[1], order: 2 },
      ],
      services: [
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
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        const payload = url.includes('timetable')
          ? overlapTimetable
          : url.includes('formations')
            ? formations
            : latest
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }),
    )

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Departure time (JST)'), { target: { value: '00:00' } })

    expect(await screen.findByText('Intermediate overlap')).toBeInTheDocument()
    expect(screen.getByText('Overlap segment: Kakegawa → Shizuoka')).toBeInTheDocument()
    expect(
      screen.getByText('Connection feasibility is not calculated. This does not mean you can catch this train.'),
    ).toBeInTheDocument()
  })
})
