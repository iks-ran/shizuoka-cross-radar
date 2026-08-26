import type { SearchResult, Station, TimetableData, TrainService } from '../types'
import { parseClockMinutes, stopMinutes } from './time'

const runsToday = (service: TrainService, weekend: boolean): boolean =>
  service.serviceDays.includes('all') ||
  (weekend ? service.serviceDays.includes('weekend') : service.serviceDays.includes('weekday'))

export const searchUpcomingTrains = (
  timetable: TimetableData,
  originStationId: string,
  destinationStationId: string,
  departureTime: string,
  weekend: boolean,
): SearchResult[] => {
  if (originStationId === destinationStationId) return []
  const selectedMinutes = parseClockMinutes(departureTime)
  if (Number.isNaN(selectedMinutes)) return []

  const stationOrder = new Map<string, number>(timetable.stations.map((station) => [station.id, station.order]))
  const originOrder = stationOrder.get(originStationId)
  const destinationOrder = stationOrder.get(destinationStationId)
  if (originOrder === undefined || destinationOrder === undefined) return []
  const desiredStep = destinationOrder > originOrder ? 1 : -1

  const results: SearchResult[] = []
  for (const service of timetable.services) {
    if (!runsToday(service, weekend)) continue
    if ((service.direction === 'eastbound' ? 1 : -1) !== desiredStep) continue

    const originIndex = service.stops.findIndex((stop) => stop.stationId === originStationId)
    if (originIndex < 0) continue
    const originStop = service.stops[originIndex]
    const departureMinutes = stopMinutes(originStop, 'departure')
    if (Number.isNaN(departureMinutes) || departureMinutes < selectedMinutes) continue

    const destinationIndex = service.stops.findIndex(
      (stop, index) => index > originIndex && stop.stationId === destinationStationId,
    )
    const transferRequired = destinationIndex < 0
    const arrivalStop = transferRequired ? service.stops.at(-1) : service.stops[destinationIndex]
    if (!arrivalStop) continue
    const arrivalMinutes = stopMinutes(arrivalStop, 'arrival')
    if (Number.isNaN(arrivalMinutes)) continue

    results.push({
      service,
      originStop,
      arrivalStop,
      transferRequired,
      departureMinutes,
      arrivalMinutes,
    })
  }

  return results.sort((left, right) =>
    left.departureMinutes === right.departureMinutes
      ? left.arrivalMinutes - right.arrivalMinutes
      : left.departureMinutes - right.departureMinutes,
  )
}

export const stationName = (stations: Station[], stationId: string, locale: 'ja' | 'en' | 'zh-CN'): string => {
  const station = stations.find((candidate) => candidate.id === stationId)
  if (!station) return stationId
  return locale === 'zh-CN' ? station.name.zhCN : station.name[locale]
}

