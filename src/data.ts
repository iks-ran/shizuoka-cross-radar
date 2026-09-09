import type { FormationsData, LatestData, TimetableData } from './types'
import { getTokyoDate } from './domain/time'

export interface StaticData {
  timetable: TimetableData
  formations: FormationsData
  latest: LatestData | null
  latestLoadFailed: boolean
}

const dataUrl = (filename: string) => `${import.meta.env.BASE_URL}data/${filename}`

const loadJson = async <T>(filename: string, fetcher: typeof fetch): Promise<T> => {
  const response = await fetcher(dataUrl(filename))
  if (!response.ok) throw new Error(`${filename} returned ${response.status}`)
  return (await response.json()) as T
}

const validateRoot = (value: unknown, filename: string): void => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('timeZone' in value) ||
    value.timeZone !== 'Asia/Tokyo'
  ) {
    throw new Error(`${filename} has an unsupported schema`)
  }
}

export interface HistoryEntry {
  serviceDate: string
  path: string
  firstObservedAt: string | null
}

export interface HistoryIndex {
  schemaVersion: 1
  timeZone: 'Asia/Tokyo'
  dates: HistoryEntry[]
}

export const loadHistoryIndex = async (fetcher: typeof fetch = fetch): Promise<HistoryIndex | null> => {
  try {
    const index = await loadJson<HistoryIndex>('history-index.json', fetcher)
    validateRoot(index, 'history-index.json')
    if (!Array.isArray(index.dates)) throw new Error('Missing history dates')
    const dates = new Set<string>()
    for (const entry of index.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.serviceDate) || dates.has(entry.serviceDate) ||
          !new RegExp(`^history/${entry.serviceDate}-[a-f0-9]{16}\\.json$`).test(entry.path) ||
          getTokyoDate(new Date(`${entry.serviceDate}T12:00:00+09:00`)) !== entry.serviceDate ||
          (entry.firstObservedAt !== null && getTokyoDate(new Date(entry.firstObservedAt)) !== entry.serviceDate)) {
        throw new Error('Invalid history index')
      }
      dates.add(entry.serviceDate)
    }
    return index
  } catch {
    // Older deployments continue to work without an archive.
    return null
  }
}

export const loadHistoricalData = async (entry: HistoryEntry, formations: FormationsData, fetcher: typeof fetch = fetch): Promise<StaticData> => {
  const bundle = await loadJson<{ timetable: TimetableData; latest: LatestData }>(entry.path, fetcher)
  validateRoot(bundle, entry.path)
  validateRoot(bundle.timetable, entry.path)
  validateRoot(bundle.latest, entry.path)
  if (bundle.timetable.serviceDate !== entry.serviceDate || bundle.latest.serviceDate !== entry.serviceDate ||
      bundle.timetable.isFixture || bundle.timetable.source.isMock || bundle.latest.source.isMock ||
      !Array.isArray(bundle.timetable.stations) || !Array.isArray(bundle.timetable.services) || !Array.isArray(bundle.latest.assignments)) {
    throw new Error('Invalid historical snapshot pair')
  }
  return { ...bundle, formations, latestLoadFailed: false }
}

export const loadStaticData = async (fetcher: typeof fetch = fetch): Promise<StaticData> => {
  const [timetable, formations] = await Promise.all([
    loadJson<TimetableData>('timetable.json', fetcher),
    loadJson<FormationsData>('formations.json', fetcher),
  ])
  validateRoot(timetable, 'timetable.json')
  validateRoot(formations, 'formations.json')

  try {
    const latest = await loadJson<LatestData>('latest.json', fetcher)
    validateRoot(latest, 'latest.json')
    return { timetable, formations, latest, latestLoadFailed: false }
  } catch {
    return { timetable, formations, latest: null, latestLoadFailed: true }
  }
}
