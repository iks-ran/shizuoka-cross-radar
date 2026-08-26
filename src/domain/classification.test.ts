import { describe, expect, it } from 'vitest'
import type { FormationDefinition } from '../types'
import { classifyFormation } from './classification'

const definition = (
  family: string,
  carCount: number | null,
  crossSeatCarCount: number | null,
  layout: FormationDefinition['layout'],
  verified = true,
): FormationDefinition => ({
  family,
  series: family,
  carCount,
  crossSeatCarCount,
  layout,
  verified,
  evidenceUrl: null,
})

const definitions: FormationDefinition[] = [
  definition('K', 2, 2, 'convertible'),
  definition('L', 2, 2, 'convertible'),
  definition('S', 3, 3, 'convertible'),
  definition('V', 2, 2, 'box_fixed'),
  definition('W', 2, 0, 'longitudinal'),
  definition('T', 3, 0, 'longitudinal'),
  definition('N', 3, 0, 'longitudinal'),
  definition('U', 4, 0, 'longitudinal'),
  definition('F', null, null, 'unknown', false),
]

describe('classifyFormation', () => {
  it('classifies K + L as fully convertible with 4 of 4 cars', () => {
    expect(classifyFormation(['K8', 'L4'], definitions)).toMatchObject({
      status: 'full_convertible',
      crossSeatCarCount: 4,
      totalCarCount: 4,
    })
  })

  it('classifies S as fully convertible', () => {
    expect(classifyFormation(['S6'], definitions)).toMatchObject({
      status: 'full_convertible',
      crossSeatCarCount: 3,
      totalCarCount: 3,
    })
  })

  it('classifies V as box/fixed seating', () => {
    expect(classifyFormation(['V13'], definitions).status).toBe('box_fixed')
  })

  it.each(['W3', 'T6', 'N5', 'U13'])('classifies %s as longitudinal', (unit) => {
    expect(classifyFormation([unit], definitions).status).toBe('all_longitudinal')
  })

  it('classifies cross and longitudinal units as partial', () => {
    expect(classifyFormation(['K3', 'W4'], definitions)).toMatchObject({
      status: 'partial_cross',
      crossSeatCarCount: 2,
      totalCarCount: 4,
    })
  })

  it('classifies convertible and box units as partial', () => {
    expect(classifyFormation(['K3', 'V4'], definitions).status).toBe('partial_cross')
  })

  it('keeps unknown families unknown without car counts', () => {
    expect(classifyFormation(['F4'], definitions)).toMatchObject({
      status: 'unknown',
      crossSeatCarCount: null,
      totalCarCount: null,
    })
    expect(classifyFormation(['ZZ1'], definitions).status).toBe('unknown')
  })
})

