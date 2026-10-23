import { addDays } from './dates.ts'
import type { ShiftKind } from './types.ts'

const SHIFT_TIMES: Record<ShiftKind, { label: string; start: number; end: number }> = {
  morning: { label: 'בוקר', start: 8, end: 16 },
  mid: { label: 'ביניים', start: 10, end: 18 },
  evening: { label: 'ערב', start: 15, end: 23 },
  night: { label: 'לילה', start: 23, end: 32 }, // 32 = 08:00 the next day
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Floating local time (no time zone), so calendars show it as written. */
function local(date: string, hour: number) {
  const day = hour >= 24 ? addDays(date, 1) : date
  return `${day.replaceAll('-', '')}T${pad(hour % 24)}0000`
}

/** Builds an iCalendar file for a list of shifts. */
export function buildIcs(shifts: { date: string; kind: ShiftKind }[], name = 'סידור עבודה'): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wecom//shifts//HE',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${name}`,
    'X-WR-TIMEZONE:Asia/Jerusalem',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]
  for (const s of shifts) {
    const t = SHIFT_TIMES[s.kind]
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.date}-${s.kind}@wecom-shifts`,
      `DTSTAMP:${now}`,
      `DTSTART:${local(s.date, t.start)}`,
      `DTEND:${local(s.date, t.end)}`,
      `SUMMARY:משמרת ${t.label}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
