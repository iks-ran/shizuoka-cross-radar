export type Locale = 'ja' | 'en' | 'zh-CN'

export interface LocalizedName {
  ja: string
  en: string
  zhCN: string
}

export interface Station {
  id: string
  order: number
  name: LocalizedName
}

export interface Stop {
  stationId: string
  arrival: string | null
  departure: string | null
  dayOffset: number
}

export interface OperationSegment {
  fromStationId: string
  toStationId: string
  diagramIds: string[]
  plannedFormations?: Array<{
    diagramId: string
    family: string
  }>
}

export interface TrainService {
  id: string
  trainNumber: string
  destinationStationId: string
  destinationName: LocalizedName
  direction: 'eastbound' | 'westbound'
  serviceDays: Array<'all' | 'weekday' | 'weekend'>
  stops: Stop[]
  operationSegments: OperationSegment[]
}

export interface TimetableData {
  schemaVersion: 1
  timeZone: 'Asia/Tokyo'
  serviceDate: string | null
  updatedAt: string | null
  source: DataSource
  isFixture: boolean
  stations: Station[]
  services: TrainService[]
}

export interface DataSource {
  id: string
  label: string
  url: string | null
  isMock: boolean
}

export type SeatLayout = 'convertible' | 'box_fixed' | 'longitudinal' | 'unknown'
export type SeatStatus =
  | 'full_convertible'
  | 'partial_cross'
  | 'box_fixed'
  | 'all_longitudinal'
  | 'unknown'

export interface FormationDefinition {
  family: string
  series: string
  carCount: number | null
  crossSeatCarCount: number | null
  layout: SeatLayout
  verified: boolean
  evidenceUrl: string | null
}

export interface FormationsData {
  schemaVersion: 1
  timeZone: 'Asia/Tokyo'
  verifiedAt: string
  formations: FormationDefinition[]
}

export interface LatestAssignment {
  diagramId: string
  rawFormation: string
  currentUnits: string[]
  parseStatus: 'parsed' | 'unknown'
}

export interface LatestData {
  schemaVersion: 1
  timeZone: 'Asia/Tokyo'
  serviceDate: string
  updatedAt: string
  source: DataSource
  assignments: LatestAssignment[]
}

export type RouteMatchType = 'direct' | 'first_leg' | 'intermediate_overlap'

export interface SearchResult {
  service: TrainService
  segmentStartStop: Stop
  segmentEndStop: Stop
  matchType: RouteMatchType
  departureMinutes: number
  arrivalMinutes: number
}

export interface ScheduledJourneyLeg {
  service: TrainService
  fromStop: Stop
  toStop: Stop
  departureMinutes: number
  arrivalMinutes: number
}

export interface ScheduledJourney {
  legs: ScheduledJourneyLeg[]
  departureMinutes: number
  arrivalMinutes: number
  transferCount: number
  durationMinutes: number
  featuredServiceId: string
  featuredDurationMinutes: number
}

export interface FormationSummary {
  status: SeatStatus
  basis: 'current' | 'planned' | 'unknown'
  currentUnits: string[]
  plannedFamilies: string[]
  rawFormation: string | null
  crossSeatCarCount: number | null
  totalCarCount: number | null
}
