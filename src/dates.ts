export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
export const HE_DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

const pad = (n: number) => String(n).padStart(2, '0')

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (s: string, n: number) => {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export const weekday = (s: string) => fromISO(s).getDay()

export const weekStartOf = (s: string) => addDays(s, -weekday(s))

export const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i))

export const fmtDM = (s: string) => {
  const d = fromISO(s)
  return `${d.getDate()}/${d.getMonth() + 1}`
}
