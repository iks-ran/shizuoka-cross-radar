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
  const selectedLow = Math.min(originOrder, destinationOrder)
  const selectedHigh = Math.max(originOrder, destinationOrder)

  const results: SearchResult[] = []
  for (const service of timetable.services) {
    if (!runsToday(service, weekend)) continue
    if ((service.direction === 'eastbound' ? 1 : -1) !== desiredStep) continue

    const firstStop = service.stops.at(0)
    const lastStop = service.stops.at(-1)
    if (!firstStop || !lastStop) continue
    const firstOrder = stationOrder.get(firstStop.stationId)
    const lastOrder = stationOrder.get(lastStop.stationId)
    if (firstOrder === undefined || lastOrder === undefined) continue

    const overlapLow = Math.max(selectedLow, Math.min(firstOrder, lastOrder))
    const overlapHigh = Math.min(selectedHigh, Math.max(firstOrder, lastOrder))
    if (overlapLow >= overlapHigh) continue

    const segmentStartOrder = desiredStep === 1 ? overlapLow : overlapHigh
    const segmentEndOrder = desiredStep === 1 ? overlapHigh : overlapLow
    const segmentStartIndex = service.stops.findIndex(
      (stop) => stationOrder.get(stop.stationId) === segmentStartOrder,
    )
    const segmentEndIndex = service.stops.findIndex(
      (stop) => stationOrder.get(stop.stationId) === segmentEndOrder,
    )
    if (segmentStartIndex < 0 || segmentEndIndex <= segmentStartIndex) continue

    const segmentStartStop = service.stops[segmentStartIndex]
    const segmentEndStop = service.stops[segmentEndIndex]
    const departureMinutes = stopMinutes(segmentStartStop, 'departure')
    const arrivalMinutes = stopMinutes(segmentEndStop, 'arrival')
    if (Number.isNaN(departureMinutes) || departureMinutes < selectedMinutes) continue
    if (Number.isNaN(arrivalMinutes)) continue

    const originIndex = service.stops.findIndex((stop) => stop.stationId === originStationId)
    const destinationIndex = service.stops.findIndex(
      (stop, index) => index > originIndex && stop.stationId === destinationStationId,
    )
    const matchType = originIndex < 0
      ? 'intermediate_overlap'
      : destinationIndex < 0
        ? 'first_leg'
        : 'direct'

    results.push({
      service,
      segmentStartStop,
      segmentEndStop,
      matchType,
      departureMinutes,
      arrivalMinutes,
    })
  }

  return results.sort((left, right) => left.departureMinutes - right.departureMinutes)
}

export const stationName = (stations: Station[], stationId: string, locale: 'ja' | 'en' | 'zh-CN'): string => {
  const station = stations.find((candidate) => candidate.id === stationId)
  if (!station) return stationId
  return locale === 'zh-CN' ? station.name.zhCN : station.name[locale]
}
