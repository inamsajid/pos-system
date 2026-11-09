import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TIMEZONE,
  toBusinessDateKey,
  isWithinBusinessDateRange,
  getBusinessDateRange,
  shiftBusinessDate,
  shiftBusinessMonths,
  getBusinessMonthKey,
  getBusinessDatePreset,
  formatBusinessDate,
} from '../src/lib/businessDate'

describe('Business Date Handling (Asia/Karachi)', () => {
  it('verifies the configured business timezone', () => {
    expect(BUSINESS_TIMEZONE).toBe('Asia/Karachi')
  })

  describe('toBusinessDateKey', () => {
    it('1. valid date-only string remains unchanged', () => {
      expect(toBusinessDateKey('2026-11-08')).toBe('2026-11-08')
      expect(toBusinessDateKey('2026-01-01')).toBe('2026-01-01')
      expect(toBusinessDateKey('2026-12-31')).toBe('2026-12-31')
    })

    it('2. UTC timestamp converts correctly to Asia/Karachi date (UTC+5)', () => {
      // 2026-11-07 20:00:00 UTC is 2026-11-08 01:00:00 in Asia/Karachi
      expect(toBusinessDateKey('2026-11-07T20:00:00.000Z')).toBe('2026-11-08')
      // 2026-11-07 14:00:00 UTC is 2026-11-07 19:00:00 in Asia/Karachi
      expect(toBusinessDateKey('2026-11-07T14:00:00.000Z')).toBe('2026-11-07')
    })

    it('3. timestamp just before Pakistan midnight maps to the previous business date', () => {
      // 18:59:59.999 UTC + 5h = 23:59:59.999 in Pakistan (Nov 7)
      expect(toBusinessDateKey('2026-11-07T18:59:59.999Z')).toBe('2026-11-07')
    })

    it('4. timestamp at Pakistan midnight maps to the new business date', () => {
      // 19:00:00.000 UTC + 5h = 00:00:00.000 in Pakistan (Nov 8)
      expect(toBusinessDateKey('2026-11-07T19:00:00.000Z')).toBe('2026-11-08')
    })

    it('5. explicit timezone-offset timestamps are handled correctly', () => {
      expect(toBusinessDateKey('2026-11-08T00:15:00+05:00')).toBe('2026-11-08')
      // 2026-11-07 21:00:00+02:00 -> 19:00:00 UTC -> 00:00:00+05:00 on Nov 8
      expect(toBusinessDateKey('2026-11-07T21:00:00+02:00')).toBe('2026-11-08')
      // 2026-11-07 20:59:00+02:00 -> 18:59:00 UTC -> 23:59:00+05:00 on Nov 7
      expect(toBusinessDateKey('2026-11-07T20:59:00+02:00')).toBe('2026-11-07')
    })

    it('10. invalid date strings return null', () => {
      expect(toBusinessDateKey('invalid-date')).toBeNull()
      expect(toBusinessDateKey('2026-02-31')).toBeNull() // invalid calendar day
      expect(toBusinessDateKey('2026-13-01')).toBeNull() // invalid month
      expect(toBusinessDateKey('')).toBeNull()
      expect(toBusinessDateKey('   ')).toBeNull()
    })

    it('11. missing / null / undefined values return null safely', () => {
      expect(toBusinessDateKey(null)).toBeNull()
      expect(toBusinessDateKey(undefined)).toBeNull()
    })

    it('converts Date object to Asia/Karachi calendar date key', () => {
      const date = new Date('2026-11-07T20:00:00.000Z')
      expect(toBusinessDateKey(date)).toBe('2026-11-08')
    })
  })

  describe('isWithinBusinessDateRange', () => {
    it('6. start date is inclusive (start of business day in Pakistan)', () => {
      // 19:00 UTC on Nov 6 is 00:00:00 on Nov 7 in PK
      const timestamp = '2026-11-06T19:00:00.000Z'
      expect(isWithinBusinessDateRange(timestamp, '2026-11-07', '2026-11-08')).toBe(true)
    })

    it('7. end date is inclusive (end of business day in Pakistan)', () => {
      // 18:59:59.999 UTC on Nov 8 is 23:59:59.999 on Nov 8 in PK
      const timestamp = '2026-11-08T18:59:59.999Z'
      expect(isWithinBusinessDateRange(timestamp, '2026-11-07', '2026-11-08')).toBe(true)
    })

    it('8. a timestamp at the end of the selected Pakistan business date is included', () => {
      const endOfNov8InPK = '2026-11-08T18:59:59.000Z'
      expect(isWithinBusinessDateRange(endOfNov8InPK, '2026-11-08', '2026-11-08')).toBe(true)
    })

    it('9. dates outside the selected range are excluded', () => {
      // 18:59:59 UTC on Nov 6 is 23:59:59 on Nov 6 in PK (before range)
      expect(isWithinBusinessDateRange('2026-11-06T18:59:59.000Z', '2026-11-07', '2026-11-08')).toBe(false)
      // 19:00:01 UTC on Nov 8 is 00:00:01 on Nov 9 in PK (after range)
      expect(isWithinBusinessDateRange('2026-11-08T19:00:01.000Z', '2026-11-07', '2026-11-08')).toBe(false)
    })

    it('handles open-ended ranges (only from or only to)', () => {
      expect(isWithinBusinessDateRange('2026-11-08T10:00:00Z', '2026-11-07', '')).toBe(true)
      expect(isWithinBusinessDateRange('2026-11-06T10:00:00Z', '2026-11-07', '')).toBe(false)
      expect(isWithinBusinessDateRange('2026-11-06T10:00:00Z', '', '2026-11-07')).toBe(true)
      expect(isWithinBusinessDateRange('2026-11-08T10:00:00Z', '', '2026-11-07')).toBe(false)
    })

    it('returns false for missing or invalid dates', () => {
      expect(isWithinBusinessDateRange(null, '2026-11-01', '2026-11-08')).toBe(false)
      expect(isWithinBusinessDateRange('invalid', '2026-11-01', '2026-11-08')).toBe(false)
    })
  })

  describe('Presets & Grouping', () => {
    // Fixed base date: 2026-11-08 14:00:00 UTC (19:00 PKT on Nov 8, 2026)
    const fixedNow = new Date('2026-11-08T14:00:00.000Z')

    it('12. daily sales grouping uses Pakistan business dates', () => {
      const nov7NightUTC = '2026-11-07T21:30:00.000Z' // 02:30 AM Nov 8 in PK
      const nov8MorningUTC = '2026-11-08T04:00:00.000Z' // 09:00 AM Nov 8 in PK
      expect(toBusinessDateKey(nov7NightUTC)).toBe('2026-11-08')
      expect(toBusinessDateKey(nov8MorningUTC)).toBe('2026-11-08')
    })

    it('13. monthly grouping uses the correct Pakistan calendar month', () => {
      // 2026-10-31 20:00:00 UTC is 2026-11-01 01:00:00 in Pakistan
      expect(getBusinessMonthKey('2026-10-31T20:00:00.000Z')).toBe('2026-11')
      // 2026-10-31 18:30:00 UTC is 2026-10-31 23:30:00 in Pakistan
      expect(getBusinessMonthKey('2026-10-31T18:30:00.000Z')).toBe('2026-10')
    })

    it('resolves presets correctly based on Pakistan business date', () => {
      const today = getBusinessDatePreset('today', fixedNow)
      expect(today).toEqual({ from: '2026-11-08', to: '2026-11-08' })

      const yesterday = getBusinessDatePreset('yesterday', fixedNow)
      expect(yesterday).toEqual({ from: '2026-11-07', to: '2026-11-07' })

      const last7 = getBusinessDatePreset('7', fixedNow)
      expect(last7).toEqual({ from: '2026-11-02', to: '2026-11-08' })

      const thisMonth = getBusinessDatePreset('month', fixedNow)
      expect(thisMonth).toEqual({ from: '2026-11-01', to: '2026-11-08' })

      const lastMonth = getBusinessDatePreset('last-month', fixedNow)
      expect(lastMonth).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    })

    it('shifts business dates and months accurately', () => {
      expect(shiftBusinessDate('2026-11-08', 3)).toBe('2026-11-11')
      expect(shiftBusinessDate('2026-11-08', -10)).toBe('2026-10-29')
      expect(shiftBusinessMonths('2026-11-08', 2)).toBe('2027-01-08')
      expect(shiftBusinessMonths('2026-11-08', -3)).toBe('2026-08-08')

      const range = getBusinessDateRange('2026-11-01', '2026-11-08')
      expect(range).toEqual({ startDate: '2026-11-01', endDate: '2026-11-08' })
    })

    it('14. date filtering works regardless of the machine local timezone', () => {
      // Simulating timestamps near day boundaries
      const lateEveningPK = '2026-11-08T18:59:00.000Z' // 23:59 PKT Nov 8
      const earlyMorningPK = '2026-11-08T19:01:00.000Z' // 00:01 PKT Nov 9
      expect(toBusinessDateKey(lateEveningPK)).toBe('2026-11-08')
      expect(toBusinessDateKey(earlyMorningPK)).toBe('2026-11-09')
    })
  })

  describe('formatBusinessDate', () => {
    it('formats dates with Pakistan business locale and timezone', () => {
      const date = new Date('2026-11-07T20:00:00.000Z') // Nov 8 in PK
      const formatted = formatBusinessDate(date, { dateStyle: 'short' })
      expect(formatted).toContain('08')
      expect(formatted).toContain('11')
    })

    it('handles invalid dates gracefully', () => {
      expect(formatBusinessDate('invalid')).toBe('—')
    })
  })
})
