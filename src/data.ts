import type { FormationsData, LatestData, TimetableData } from './types'

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

