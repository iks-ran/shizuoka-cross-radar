import type { LatestData, Stop } from '../types'

export const TOKYO_TIME_ZONE = 'Asia/Tokyo'

const partsForTokyo = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

export const getTokyoTime = (value = new Date()): string => {
  const parts = partsForTokyo(value)
  return `${parts.hour}:${parts.minute}`
}

export const getTokyoDate = (value = new Date()): string => {
  const parts = partsForTokyo(value)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const parseClockMinutes = (clock: string): number => {
  const match = /^(\d{2}):(\d{2})$/.exec(clock)
  if (!match) return Number.NaN
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return Number.NaN
  return hours * 60 + minutes
}

export const stopMinutes = (stop: Stop, field: 'arrival' | 'departure'): number => {
  const clock = stop[field]
  return clock === null ? Number.NaN : parseClockMinutes(clock) + stop.dayOffset * 1440
}

export const isTokyoWeekend = (value = new Date()): boolean => {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TOKYO_TIME_ZONE,
    weekday: 'short',
  }).format(value)
  return weekday === 'Sat' || weekday === 'Sun'
}

export const isLatestStale = (latest: LatestData | null, now = new Date(), maxAgeMinutes = 90): boolean => {
  if (!latest || latest.serviceDate !== getTokyoDate(now)) return true
  const updatedAt = new Date(latest.updatedAt)
  if (Number.isNaN(updatedAt.getTime())) return true
  const ageMinutes = (now.getTime() - updatedAt.getTime()) / 60_000
  return ageMinutes > maxAgeMinutes || ageMinutes < -5
}

export const formatUpdatedAt = (iso: string, locale: string): string => {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone: TOKYO_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value)
}

