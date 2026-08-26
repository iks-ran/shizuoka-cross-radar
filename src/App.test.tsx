import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const timetable = {
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
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
    expect(screen.getByText('No matching fixture trains remain after this time.')).toBeInTheDocument()
  })
})
