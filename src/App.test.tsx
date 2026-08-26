import { cleanup, render, screen } from '@testing-library/react'
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
})
