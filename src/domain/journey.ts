import type {
  ScheduledJourney,
  ScheduledJourneyLeg,
  TimetableData,
  TrainService,
} from '../types'
import { serviceRunsToday } from './search'
import { parseClockMinutes, stopMinutes } from './time'

interface Boarding {
  service: TrainService
  stopIndex: number
  departureMinutes: number
}

interface Arrival {
  service: TrainService
  stopIndex: number
  arrivalMinutes: number
}

interface JourneyLabel {
  stationId: string
  arrivalMinutes: number
  firstDepartureMinutes: number | null
  transferWaitMinutes: number
  legs: ScheduledJourneyLeg[]
}

interface OnwardLabel {
  stationId: string
  departureMinutes: number
  arrivalMinutes: number
  transferWaitMinutes: number
  legs: ScheduledJourneyLeg[]
}

export interface ScheduledJourneyPlanner {
  findFastestIncluding: (
    originStationId: string,
    destinationStationId: string,
    departureTime: string,
    featuredServiceId: string,
    featuredBoardStationId: string,
  ) => ScheduledJourney | null
}

const routeSignature = (label: Pick<JourneyLabel, 'legs'>): string =>
  label.legs
    .map((leg) => `${leg.service.id}:${leg.fromStop.stationId}-${leg.toStop.stationId}`)
    .join('|')

const waitPotential = (label: JourneyLabel): number =>
  label.transferWaitMinutes - label.arrivalMinutes

const dominates = (left: JourneyLabel, right: JourneyLabel): boolean => {
  const leftDeparture = left.firstDepartureMinutes ?? Number.NEGATIVE_INFINITY
  const rightDeparture = right.firstDepartureMinutes ?? Number.NEGATIVE_INFINITY
  return (
    left.arrivalMinutes <= right.arrivalMinutes &&
    leftDeparture >= rightDeparture &&
    left.legs.length <= right.legs.length &&
    waitPotential(left) <= waitPotential(right) &&
    (
      left.arrivalMinutes < right.arrivalMinutes ||
      leftDeparture > rightDeparture ||
      left.legs.length < right.legs.length ||
      waitPotential(left) < waitPotential(right)
    )
  )
}

const sameMetrics = (left: JourneyLabel, right: JourneyLabel): boolean =>
  left.arrivalMinutes === right.arrivalMinutes &&
  left.firstDepartureMinutes === right.firstDepartureMinutes &&
  left.legs.length === right.legs.length &&
  waitPotential(left) === waitPotential(right)

const addParetoLabel = (
  labelsByStation: Map<string, JourneyLabel[]>,
  candidate: JourneyLabel,
): void => {
  const labels = labelsByStation.get(candidate.stationId) ?? []
  if (
    labels.some(
      (label) =>
        dominates(label, candidate) ||
        (sameMetrics(label, candidate) && routeSignature(label) <= routeSignature(candidate)),
    )
  ) {
    return
  }
  labelsByStation.set(
    candidate.stationId,
    labels.filter(
      (label) =>
        !dominates(candidate, label) &&
        !(sameMetrics(candidate, label) && routeSignature(candidate) < routeSignature(label)),
    ).concat(candidate),
  )
}

const onwardWaitPotential = (label: OnwardLabel): number =>
  label.transferWaitMinutes + label.departureMinutes

const onwardDominates = (left: OnwardLabel, right: OnwardLabel): boolean =>
  left.arrivalMinutes <= right.arrivalMinutes &&
  left.departureMinutes >= right.departureMinutes &&
  left.legs.length <= right.legs.length &&
  onwardWaitPotential(left) <= onwardWaitPotential(right) &&
  (
    left.arrivalMinutes < right.arrivalMinutes ||
    left.departureMinutes > right.departureMinutes ||
    left.legs.length < right.legs.length ||
    onwardWaitPotential(left) < onwardWaitPotential(right)
  )

const sameOnwardMetrics = (left: OnwardLabel, right: OnwardLabel): boolean =>
  left.arrivalMinutes === right.arrivalMinutes &&
  left.departureMinutes === right.departureMinutes &&
  left.legs.length === right.legs.length &&
  onwardWaitPotential(left) === onwardWaitPotential(right)

const addOnwardLabel = (
  labelsByStation: Map<string, OnwardLabel[]>,
  candidate: OnwardLabel,
): void => {
  const labels = labelsByStation.get(candidate.stationId) ?? []
  if (
    labels.some(
      (label) =>
        onwardDominates(label, candidate) ||
        (
          sameOnwardMetrics(label, candidate) &&
          routeSignature(label) <= routeSignature(candidate)
        ),
    )
  ) {
    return
  }
  labelsByStation.set(
    candidate.stationId,
    labels.filter(
      (label) =>
        !onwardDominates(candidate, label) &&
        !(
          sameOnwardMetrics(candidate, label) &&
          routeSignature(candidate) < routeSignature(label)
        ),
    ).concat(candidate),
  )
}

const compareBoardingLabels = (
  left: JourneyLabel,
  right: JourneyLabel,
  featuredDepartureMinutes: number,
): number => {
  const leftDeparture = left.firstDepartureMinutes ?? featuredDepartureMinutes
  const rightDeparture = right.firstDepartureMinutes ?? featuredDepartureMinutes
  if (leftDeparture !== rightDeparture) return rightDeparture - leftDeparture
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length
  const leftWait = left.transferWaitMinutes + (left.legs.length > 0
    ? featuredDepartureMinutes - left.arrivalMinutes
    : 0)
  const rightWait = right.transferWaitMinutes + (right.legs.length > 0
    ? featuredDepartureMinutes - right.arrivalMinutes
    : 0)
  if (leftWait !== rightWait) return leftWait - rightWait
  return routeSignature(left).localeCompare(routeSignature(right))
}

const compareCompleteLabels = (left: JourneyLabel, right: JourneyLabel): number => {
  if (left.arrivalMinutes !== right.arrivalMinutes) {
    return left.arrivalMinutes - right.arrivalMinutes
  }
  const leftDeparture = left.firstDepartureMinutes ?? Number.NEGATIVE_INFINITY
  const rightDeparture = right.firstDepartureMinutes ?? Number.NEGATIVE_INFINITY
  if (leftDeparture !== rightDeparture) return rightDeparture - leftDeparture
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length
  if (left.transferWaitMinutes !== right.transferWaitMinutes) {
    return left.transferWaitMinutes - right.transferWaitMinutes
  }
  return routeSignature(left).localeCompare(routeSignature(right))
}

const extendLabel = (
  label: JourneyLabel,
  boarding: Boarding,
  toStop: TrainService['stops'][number],
  arrivalMinutes: number,
): JourneyLabel => {
  const fromStop = boarding.service.stops[boarding.stopIndex]
  const isFirstLeg = label.legs.length === 0
  return {
    stationId: toStop.stationId,
    arrivalMinutes,
    firstDepartureMinutes: label.firstDepartureMinutes ?? boarding.departureMinutes,
    transferWaitMinutes:
      label.transferWaitMinutes + (isFirstLeg ? 0 : boarding.departureMinutes - label.arrivalMinutes),
    legs: [
      ...label.legs,
      {
        service: boarding.service,
        fromStop,
        toStop,
        departureMinutes: boarding.departureMinutes,
        arrivalMinutes,
      },
    ],
  }
}

export const createScheduledJourneyPlanner = (
  timetable: TimetableData,
  weekend: boolean,
): ScheduledJourneyPlanner => {
  const stationOrder = new Map(timetable.stations.map((station) => [station.id, station.order]))
  const serviceById = new Map(timetable.services.map((service) => [service.id, service]))
  const boardingsByStation = new Map<string, Boarding[]>()
  const arrivalsByStation = new Map<string, Arrival[]>()

  for (const service of timetable.services) {
    if (!serviceRunsToday(service, weekend)) continue
    service.stops.forEach((stop, stopIndex) => {
      const departureMinutes = stopMinutes(stop, 'departure')
      if (!Number.isNaN(departureMinutes)) {
        const boardings = boardingsByStation.get(stop.stationId) ?? []
        boardings.push({ service, stopIndex, departureMinutes })
        boardingsByStation.set(stop.stationId, boardings)
      }
      const arrivalMinutes = stopMinutes(stop, 'arrival')
      if (!Number.isNaN(arrivalMinutes)) {
        const arrivals = arrivalsByStation.get(stop.stationId) ?? []
        arrivals.push({ service, stopIndex, arrivalMinutes })
        arrivalsByStation.set(stop.stationId, arrivals)
      }
    })
  }

  for (const boardings of boardingsByStation.values()) {
    boardings.sort(
      (left, right) =>
        left.departureMinutes - right.departureMinutes ||
        left.service.id.localeCompare(right.service.id),
    )
  }

  for (const arrivals of arrivalsByStation.values()) {
    arrivals.sort(
      (left, right) =>
        left.arrivalMinutes - right.arrivalMinutes ||
        left.service.id.localeCompare(right.service.id),
    )
  }

  const expandOrdinaryLabels = (
    stationId: string,
    labels: JourneyLabel[],
    labelsByStation: Map<string, JourneyLabel[]>,
    desiredDirection: TrainService['direction'],
    desiredStep: 1 | -1,
    boundaryOrder: number,
    excludedServiceId: string | null,
  ): void => {
    for (const label of labels) {
      const lastServiceId = label.legs.at(-1)?.service.id
      for (const boarding of boardingsByStation.get(stationId) ?? []) {
        if (
          boarding.service.direction !== desiredDirection ||
          boarding.service.id === excludedServiceId ||
          boarding.service.id === lastServiceId ||
          boarding.departureMinutes < label.arrivalMinutes
        ) {
          continue
        }

        for (
          let stopIndex = boarding.stopIndex + 1;
          stopIndex < boarding.service.stops.length;
          stopIndex += 1
        ) {
          const toStop = boarding.service.stops[stopIndex]
          const toOrder = stationOrder.get(toStop.stationId)
          if (toOrder === undefined) continue
          if ((toOrder - boundaryOrder) * desiredStep > 0) break
          const arrivalMinutes = stopMinutes(toStop, 'arrival')
          if (Number.isNaN(arrivalMinutes) || arrivalMinutes < boarding.departureMinutes) continue
          addParetoLabel(
            labelsByStation,
            extendLabel(label, boarding, toStop, arrivalMinutes),
          )
        }
      }
    }
  }

  const feederProfiles = new Map<string, Map<string, JourneyLabel[]>>()
  const onwardProfiles = new Map<string, Map<string, OnwardLabel[]>>()

  const getFeederProfile = (
    originStationId: string,
    destinationStationId: string,
    selectedMinutes: number,
    desiredDirection: TrainService['direction'],
    desiredStep: 1 | -1,
    destinationOrder: number,
    orderedStationIds: string[],
  ): Map<string, JourneyLabel[]> => {
    const cacheKey = `${originStationId}|${destinationStationId}|${selectedMinutes}`
    const cached = feederProfiles.get(cacheKey)
    if (cached) return cached

    const profile = new Map<string, JourneyLabel[]>()
    profile.set(originStationId, [{
      stationId: originStationId,
      arrivalMinutes: selectedMinutes,
      firstDepartureMinutes: null,
      transferWaitMinutes: 0,
      legs: [],
    }])
    for (const stationId of orderedStationIds) {
      if (stationId === destinationStationId) break
      expandOrdinaryLabels(
        stationId,
        profile.get(stationId) ?? [],
        profile,
        desiredDirection,
        desiredStep,
        destinationOrder,
        null,
      )
    }
    feederProfiles.set(cacheKey, profile)
    return profile
  }

  const getOnwardProfile = (
    originStationId: string,
    destinationStationId: string,
    desiredDirection: TrainService['direction'],
    desiredStep: 1 | -1,
    originOrder: number,
    orderedStationIds: string[],
  ): Map<string, OnwardLabel[]> => {
    const cacheKey = `${originStationId}|${destinationStationId}`
    const cached = onwardProfiles.get(cacheKey)
    if (cached) return cached

    const profile = new Map<string, OnwardLabel[]>()
    for (const stationId of orderedStationIds.slice().reverse()) {
      if (stationId === originStationId) break
      const continuations = profile.get(stationId) ?? []
      for (const arrival of arrivalsByStation.get(stationId) ?? []) {
        if (arrival.service.direction !== desiredDirection) continue
        const toStop = arrival.service.stops[arrival.stopIndex]
        const matchingContinuations = stationId === destinationStationId
          ? [null]
          : continuations.filter(
              (continuation) =>
                arrival.arrivalMinutes <= continuation.departureMinutes &&
                arrival.service.id !== continuation.legs[0]?.service.id,
            )
        for (const continuation of matchingContinuations) {
          for (let stopIndex = arrival.stopIndex - 1; stopIndex >= 0; stopIndex -= 1) {
            const fromStop = arrival.service.stops[stopIndex]
            const fromOrder = stationOrder.get(fromStop.stationId)
            if (fromOrder === undefined) continue
            if ((fromOrder - originOrder) * desiredStep < 0) break
            const departureMinutes = stopMinutes(fromStop, 'departure')
            if (
              Number.isNaN(departureMinutes) ||
              departureMinutes > arrival.arrivalMinutes
            ) {
              continue
            }
            addOnwardLabel(profile, {
              stationId: fromStop.stationId,
              departureMinutes,
              arrivalMinutes: continuation?.arrivalMinutes ?? arrival.arrivalMinutes,
              transferWaitMinutes: continuation
                ? continuation.transferWaitMinutes +
                  continuation.departureMinutes -
                  arrival.arrivalMinutes
                : 0,
              legs: [{
                service: arrival.service,
                fromStop,
                toStop,
                departureMinutes,
                arrivalMinutes: arrival.arrivalMinutes,
              }, ...(continuation?.legs ?? [])],
            })
          }
        }
      }
    }
    onwardProfiles.set(cacheKey, profile)
    return profile
  }

  return {
    findFastestIncluding: (
      originStationId,
      destinationStationId,
      departureTime,
      featuredServiceId,
      featuredBoardStationId,
    ) => {
      const selectedMinutes = parseClockMinutes(departureTime)
      const originOrder = stationOrder.get(originStationId)
      const destinationOrder = stationOrder.get(destinationStationId)
      const featuredBoardOrder = stationOrder.get(featuredBoardStationId)
      const featuredService = serviceById.get(featuredServiceId)
      if (
        Number.isNaN(selectedMinutes) ||
        originOrder === undefined ||
        destinationOrder === undefined ||
        featuredBoardOrder === undefined ||
        originOrder === destinationOrder ||
        featuredService === undefined ||
        !serviceRunsToday(featuredService, weekend)
      ) {
        return null
      }

      const desiredStep: 1 | -1 = destinationOrder > originOrder ? 1 : -1
      const desiredDirection: TrainService['direction'] =
        desiredStep === 1 ? 'eastbound' : 'westbound'
      if (
        featuredService.direction !== desiredDirection ||
        (featuredBoardOrder - originOrder) * desiredStep < 0 ||
        (featuredBoardOrder - destinationOrder) * desiredStep >= 0
      ) {
        return null
      }

      const featuredBoardIndex = featuredService.stops.findIndex(
        (stop) => stop.stationId === featuredBoardStationId,
      )
      if (featuredBoardIndex < 0) return null
      const featuredBoarding: Boarding = {
        service: featuredService,
        stopIndex: featuredBoardIndex,
        departureMinutes: stopMinutes(featuredService.stops[featuredBoardIndex], 'departure'),
      }
      if (Number.isNaN(featuredBoarding.departureMinutes)) return null

      const orderedStationIds = timetable.stations
        .filter((station) =>
          (station.order - originOrder) * desiredStep >= 0 &&
          (station.order - destinationOrder) * desiredStep <= 0,
        )
        .sort((left, right) => (left.order - right.order) * desiredStep)
        .map((station) => station.id)

      let feeder: JourneyLabel
      if (originStationId === featuredBoardStationId) {
        if (featuredBoarding.departureMinutes < selectedMinutes) return null
        feeder = {
          stationId: featuredBoardStationId,
          arrivalMinutes: selectedMinutes,
          firstDepartureMinutes: null,
          transferWaitMinutes: 0,
          legs: [],
        }
      } else {
        const feederProfile = getFeederProfile(
          originStationId,
          destinationStationId,
          selectedMinutes,
          desiredDirection,
          desiredStep,
          destinationOrder,
          orderedStationIds,
        )
        const bestFeeder = (feederProfile.get(featuredBoardStationId) ?? [])
          .filter(
            (label) =>
              label.arrivalMinutes <= featuredBoarding.departureMinutes &&
              !label.legs.some((leg) => leg.service.id === featuredServiceId),
          )
          .sort((left, right) =>
            compareBoardingLabels(left, right, featuredBoarding.departureMinutes),
          )[0]
        if (!bestFeeder) return null
        feeder = bestFeeder
      }

      const featuredBase: JourneyLabel = {
        ...feeder,
        firstDepartureMinutes: feeder.firstDepartureMinutes ?? featuredBoarding.departureMinutes,
      }
      const onwardProfile = getOnwardProfile(
        originStationId,
        destinationStationId,
        desiredDirection,
        desiredStep,
        originOrder,
        orderedStationIds,
      )
      const completed: JourneyLabel[] = []
      for (
        let stopIndex = featuredBoardIndex + 1;
        stopIndex < featuredService.stops.length;
        stopIndex += 1
      ) {
        const toStop = featuredService.stops[stopIndex]
        const toOrder = stationOrder.get(toStop.stationId)
        if (toOrder === undefined) continue
        if ((toOrder - destinationOrder) * desiredStep > 0) break
        const arrivalMinutes = stopMinutes(toStop, 'arrival')
        if (
          Number.isNaN(arrivalMinutes) ||
          arrivalMinutes < featuredBoarding.departureMinutes
        ) {
          continue
        }
        const featuredLabel = extendLabel(
          featuredBase,
          featuredBoarding,
          toStop,
          arrivalMinutes,
        )
        if (toStop.stationId === destinationStationId) {
          completed.push(featuredLabel)
          continue
        }
        for (const onward of onwardProfile.get(toStop.stationId) ?? []) {
          if (
            onward.departureMinutes < arrivalMinutes ||
            onward.legs.some((leg) => leg.service.id === featuredServiceId)
          ) {
            continue
          }
          completed.push({
            stationId: destinationStationId,
            arrivalMinutes: onward.arrivalMinutes,
            firstDepartureMinutes: featuredLabel.firstDepartureMinutes,
            transferWaitMinutes:
              featuredLabel.transferWaitMinutes +
              onward.transferWaitMinutes +
              onward.departureMinutes -
              arrivalMinutes,
            legs: [...featuredLabel.legs, ...onward.legs],
          })
        }
      }

      completed.sort(compareCompleteLabels)
      const best = completed[0]
      const firstLeg = best?.legs[0]
      const featuredLeg = best?.legs.find((leg) => leg.service.id === featuredServiceId)
      if (!best || !firstLeg || !featuredLeg || best.firstDepartureMinutes === null) return null

      return {
        legs: best.legs,
        departureMinutes: best.firstDepartureMinutes,
        arrivalMinutes: best.arrivalMinutes,
        transferCount: best.legs.length - 1,
        durationMinutes: best.arrivalMinutes - best.firstDepartureMinutes,
        featuredServiceId,
        featuredDurationMinutes: featuredLeg.arrivalMinutes - featuredLeg.departureMinutes,
      }
    },
  }
}
