import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { loadHistoricalData, loadHistoryIndex } from './data'
import { nextScheduledCheck, shiftServiceDate } from './domain/time'
import type { FormationsData } from './types'

const root = { schemaVersion: 1, timeZone: 'Asia/Tokyo' }
const source = { id: 'test', label: 'Test source', url: null, isMock: false }
const formations: FormationsData = { schemaVersion: 1, timeZone: 'Asia/Tokyo', verifiedAt: '2026-09-09', formations: [] }
const name = { ja: '静岡', en: 'Shizuoka', zhCN: '静冈' }
const bundle = (day: string, train = '123M') => ({
  ...root,
  timetable: {
    ...root, source, isFixture: false, serviceDate: day, updatedAt: `${day}T04:30:00+09:00`,
    stations: [
      { id: 'hamamatsu', order: 0, name: { ja: '浜松', en: 'Hamamatsu', zhCN: '滨松' } },
      { id: 'shizuoka', order: 1, name },
    ],
    services: [{
      id: train, trainNumber: train, destinationStationId: 'shizuoka', destinationName: name,
      direction: 'eastbound', serviceDays: ['weekday'],
      stops: [
        { stationId: 'hamamatsu', arrival: null, departure: '06:00', dayOffset: 0 },
        { stationId: 'shizuoka', arrival: '07:00', departure: null, dayOffset: 0 },
      ],
      operationSegments: [{ fromStationId: 'hamamatsu', toStationId: 'shizuoka', diagramIds: ['A1'] }],
    }],
  },
  latest: { ...root, source, serviceDate: day, updatedAt: `${day}T23:00:00+09:00`, assignments: [] },
})
const entry = (day: string, firstObservedAt: string | null = null) => ({ serviceDate: day, path: `history/${day}-0123456789abcdef.json`, firstObservedAt })
const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })

function mockData(first: string | null = null, baseDay = '2026-09-09') {
  const base = bundle(baseDay)
  const index = { ...root, dates: [entry('2026-09-09', first), entry('2026-09-08')] }
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('history-index.json')) return response(index)
    if (url.includes('history/')) return response(bundle('2026-09-08', '456M'))
    if (url.endsWith('timetable.json')) return response(base.timetable)
    if (url.endsWith('formations.json')) return response(formations)
    return response(base.latest)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T00:30:00+09:00'))
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('shows yesterday at 00:30 with a release estimate and historical observations', async () => {
  const fetcher = mockData('2026-09-09T04:32:00+09:00')
  render(<App />)
  expect(await screen.findByLabelText('Schedule date (JST)')).toHaveValue('2026-09-09')
  expect(screen.getByText('123M')).toBeInTheDocument()
  expect(screen.getByText(/Estimated availability today: around 04:32 JST/)).toBeInTheDocument()
  expect(screen.queryByText(/Next scheduled data check/)).not.toBeInTheDocument()
  expect(screen.getByText('Historical observation')).toBeInTheDocument()
  expect(screen.getByText(/Showing historical data for 2026-09-09/)).toBeInTheDocument()
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('/data/'))).toBe(true)
})

it('uses distinct next-check copy and preserves inputs when choosing history or unavailable today', async () => {
  mockData()
  render(<App />)
  await screen.findByText('123M')
  expect(screen.getByText('2 of the last 30 dates have recorded data. Unrecorded dates are unavailable.')).toBeInTheDocument()
  expect(screen.getByLabelText('Schedule date (JST)').querySelectorAll('option')).toHaveLength(30)
  expect(screen.getByRole('option', { name: '2026-09-07 · Not recorded' })).toBeDisabled()
  expect(screen.getByRole('option', { name: '2026-09-08' })).not.toBeDisabled()
  expect(screen.getByText(/Next scheduled data check: 01:00 JST/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Departure time (JST)'), { target: { value: '05:00' } })
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-08' } })
  expect(await screen.findByText('456M')).toBeInTheDocument()
  expect(screen.getByLabelText('Departure time (JST)')).toHaveValue('05:00')
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-10' } })
  expect(await screen.findByText('No timetable is available for the selected date.')).toBeInTheDocument()
  expect(screen.queryByText('456M')).not.toBeInTheDocument()
})

it('does not allow a late history response to replace the latest selection', async () => {
  const fetcher = mockData()
  render(<App />)
  await screen.findByText('123M')
  let resolve!: (value: Response) => void
  fetcher.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-08' } })
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-09' } })
  await act(async () => resolve(response(bundle('2026-09-08', '456M'))))
  expect(screen.getByText('123M')).toBeInTheDocument()
  expect(screen.queryByText('456M')).not.toBeInTheDocument()
})

it('shows a recoverable error instead of another date’s trains on a failed history load', async () => {
  const fetcher = mockData()
  render(<App />)
  await screen.findByText('123M')
  fetcher.mockImplementationOnce(async () => new Response('', { status: 404 }))
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-08' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('This historical snapshot could not be loaded')
  expect(screen.queryByText('123M')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Schedule date (JST)'), { target: { value: '2026-09-09' } })
  expect(await screen.findByText('123M')).toBeInTheDocument()
})

it('defaults to today on reload when today has become available', async () => {
  mockData(null, '2026-09-10')
  render(<App />)
  expect(await screen.findByLabelText('Schedule date (JST)')).toHaveValue('2026-09-10')
  expect(screen.queryByText(/Today’s timetable is not available yet/)).not.toBeInTheDocument()
  expect(screen.queryByText('Historical observation')).not.toBeInTheDocument()
})

it('labels an unknown formation with an archive estimate without changing its status', async () => {
  const seating: FormationsData = { ...formations, formations: [
    { family: 'S', series: '313-8000', carCount: 3, crossSeatCarCount: 3, layout: 'convertible', verified: true, evidenceUrl: null },
    { family: 'T', series: '313-2500', carCount: 3, crossSeatCarCount: 0, layout: 'longitudinal', verified: true, evidenceUrl: null },
  ] }
  const model = {
    ...root, method: 'diagram-frequency', minimumObservedDays: 3,
    trainingDates: ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'],
    diagrams: [{ diagramId: 'A1', observedDays: 4, outcomes: [{ families: ['S'], days: 3 }, { families: ['T'], days: 1 }] }],
  }
  const fetcher = mockData(null, '2026-09-10')
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('formation-model.json')) return response(model)
    if (url.endsWith('formations.json')) return response(seating)
    return original(input)
  })
  render(<App />)
  expect(await screen.findByText('123M')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Formation unknown' })).toBeInTheDocument()
  expect(screen.getByText('Prediction')).toBeInTheDocument()
  expect(screen.getByText('Likely cross seats · 75%')).toBeInTheDocument()
  expect(screen.getByText(/Estimated from 4 recorded days \(2026-09-06 – 2026-09-09\); most often S\./)).toBeInTheDocument()
  expect(screen.getByText(/Predictions for unknown formations count how often/)).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Show direct trains with unknown seating'))
  expect(screen.queryByText('123M')).not.toBeInTheDocument()
})

it('labels surcharge trains and explains that routes avoid them as connections', async () => {
  const fetcher = mockData(null, '2026-09-10')
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (input) => {
    if (!String(input).endsWith('timetable.json')) return original(input)
    const base = bundle('2026-09-10', '4001M').timetable
    base.services[0] = {
      ...base.services[0],
      trainType: { code: 'limited_express', name: { ja: '特急', en: 'Ltd. Exp.', zhCN: 'Ltd. Exp.' } },
    } as typeof base.services[0]
    return response(base)
  })
  render(<App />)
  expect(await screen.findByText('4001M')).toBeInTheDocument()
  expect(screen.getByText('Ltd. Exp. · limited express ticket required')).toBeInTheDocument()
  expect(screen.getByText(/complete routes never use them as connecting trains/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '日本語' }))
  expect(screen.getByText('特急・特急券が必要です')).toBeInTheDocument()
})

it('shows no estimate when the model cannot be loaded', async () => {
  mockData(null, '2026-09-10')
  render(<App />)
  expect(await screen.findByText('123M')).toBeInTheDocument()
  expect(screen.queryByText('Prediction')).not.toBeInTheDocument()
  expect(screen.queryByText(/Predictions for unknown formations/)).not.toBeInTheDocument()
})

it('searches Friday’s historical weekday schedule on Saturday', async () => {
  vi.setSystemTime(new Date('2026-09-12T00:30:00+09:00'))
  mockData(null, '2026-09-11')
  render(<App />)
  expect(await screen.findByText('123M')).toBeInTheDocument()
})

it('handles an empty archive and an expired last-good timetable', async () => {
  const fetcher = mockData(null, '2026-07-01')
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (input) => String(input).endsWith('history-index.json')
    ? response({ ...root, dates: [] }) : original(input))
  render(<App />)
  expect(await screen.findByText('No timetable is available for the selected date.')).toBeInTheDocument()
  expect(screen.queryByText('123M')).not.toBeInTheDocument()
})

it('rejects date-mismatched bundles and unsafe index paths', async () => {
  await expect(loadHistoricalData(entry('2026-09-09'), { formations, formationModel: null },
    vi.fn(async () => response(bundle('2026-09-08'))))).rejects.toThrow('Invalid historical')
  expect(await loadHistoryIndex(vi.fn(async () => response({ ...root, dates: [{ ...entry('2026-09-09'), path: '../other.json' }] })))).toBeNull()
  await expect(loadHistoricalData(entry('2026-09-09'), { formations, formationModel: null },
    vi.fn(async () => new Response('{broken')))).rejects.toThrow()
})

it('calculates half-hour checks and previous dates across JST year boundaries', () => {
  expect(nextScheduledCheck(new Date('2026-12-31T23:59:00+09:00'))).toBe('00:00')
  expect(nextScheduledCheck(new Date('2026-09-10T00:29:00+09:00'))).toBe('00:30')
  expect(shiftServiceDate('2027-01-01', -1)).toBe('2026-12-31')
})
