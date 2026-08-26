import { describe, expect, it } from 'vitest'
import type { LatestData } from '../types'
import { getTokyoDate, getTokyoTime, isLatestStale } from './time'

const latest = (updatedAt: string, serviceDate = '2026-08-26'): LatestData => ({
  schemaVersion: 1,
  timeZone: 'Asia/Tokyo',
  serviceDate,
  updatedAt,
  source: { id: 'fixture', label: 'Fixture', url: null, isMock: true },
  assignments: [],
})

describe('Tokyo business time', () => {
  it('formats Tokyo time independently of the browser timezone', () => {
    const value = new Date('2026-08-25T23:05:00Z')
    expect(getTokyoDate(value)).toBe('2026-08-26')
    expect(getTokyoTime(value)).toBe('08:05')
  })

  it('marks snapshots stale by age or service date', () => {
    const now = new Date('2026-08-26T03:00:00Z')
    expect(isLatestStale(latest('2026-08-26T11:00:00+09:00'), now)).toBe(false)
    expect(isLatestStale(latest('2026-08-26T09:00:00+09:00'), now)).toBe(true)
    expect(isLatestStale(latest('2026-08-26T11:30:00+09:00', '2026-08-25'), now)).toBe(true)
  })
})

