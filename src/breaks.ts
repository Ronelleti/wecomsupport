import type { Assignment, BreakColumn, BreakSheet, BreakSlot, ShiftKind } from './types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** "09:15" + 40 minutes -> "09:55". Wraps past midnight. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export const BREAK_PRESETS: { id: string; label: string; columns: BreakColumn[] }[] = [
  {
    id: 'standard',
    label: 'שלוש הפסקות (10 / 30 / 10 דקות)',
    columns: [
      { name: 'הפסקה קצרה', minutes: 10 },
      { name: 'הפסקה ארוכה', minutes: 30 },
      { name: 'הפסקה קצרה', minutes: 10 },
    ],
  },
  { id: 'friday', label: 'הפסקה אחת (20 דקות), לשישי', columns: [{ name: 'הפסקה', minutes: 20 }] },
]

export interface RowSpec {
  kind: ShiftKind | null
  count: number
  /** Time of the first row, per column ("" = no break in that column). */
  starts: string[]
  /** Minutes between rows, per column. */
  steps: number[]
}

/** Suggested first times for the standard three-break layout, by shift. */
export const SUGGESTED_STARTS: Record<ShiftKind, string[]> = {
  morning: ['09:15', '10:20', '14:00'],
  mid: ['11:30', '15:00', '16:15'],
  evening: ['16:30', '17:00', '20:15'],
  night: ['', '', ''],
}

/** Rows whose times start at `starts` and move forward by `steps` on every row. */
export function generateRows(spec: RowSpec): { kind: ShiftKind | null; times: string[] }[] {
  return Array.from({ length: Math.max(0, spec.count) }, (_, row) => ({
    kind: spec.kind,
    times: spec.starts.map((start, c) => (start ? addMinutes(start, (spec.steps[c] ?? 0) * row) : '')),
  }))
}

/** A new draft for `date` with the same columns and rows as `source`. Nobody's choice is carried over. */
export function copySheet(source: BreakSheet, date: string, newId: () => string): BreakSheet {
  const id = newId()
  const slots: BreakSlot[] = source.slots.map((s) => ({
    ...s,
    id: newId(),
    sheetId: id,
    times: [...s.times],
    chosenBy: null,
    chosenAt: null,
  }))
  return { ...source, id, date, status: 'draft', columns: source.columns.map((c) => ({ ...c })), slots: renumber(slots) }
}

/** Past sheets to copy from: the same weekday first (it usually has the same rhythm), then the most recent. */
export function copyOrder(options: BreakSheet[], targetWeekday: number, weekdayOf: (date: string) => number): BreakSheet[] {
  const usable = options.filter((s) => s.slots.length > 0)
  return [...usable].sort((a, b) => {
    const sameA = weekdayOf(a.date) === targetWeekday ? 0 : 1
    const sameB = weekdayOf(b.date) === targetWeekday ? 0 : 1
    return sameA - sameB || b.date.localeCompare(a.date)
  })
}

/** Numbers the rows 1..n in order. */
export const renumber = (slots: BreakSlot[]): BreakSlot[] =>
  slots.map((s, i) => ({ ...s, position: i, label: String(i + 1) }))

/** People who work this sheet's department on its day (and the shift, when rows are tied to one). */
export function audience(sheet: BreakSheet, assignments: Assignment[]): string[] {
  const kinds = new Set(sheet.slots.map((s) => s.kind))
  const anyKind = kinds.has(null)
  const ids = assignments
    .filter((a) => a.date === sheet.date && a.departmentId === sheet.departmentId && (anyKind || kinds.has(a.kind)))
    .map((a) => a.employeeId)
  return [...new Set(ids)]
}

/** Can this person take this row? (They must work that day, in that department, on that row's shift.) */
export function canTake(sheet: BreakSheet, slot: BreakSlot, employeeId: string, assignments: Assignment[]): boolean {
  return assignments.some(
    (a) => a.employeeId === employeeId && a.date === sheet.date && a.departmentId === sheet.departmentId && (slot.kind === null || a.kind === slot.kind),
  )
}

export const mySlot = (sheet: BreakSheet, employeeId: string) => sheet.slots.find((s) => s.chosenBy === employeeId)

export interface Summary {
  total: number
  taken: number
  free: number
  /** Reps scheduled for this sheet. */
  reps: number
  /** Scheduled reps who haven't picked a row yet. */
  waiting: string[]
  /** More reps than rows: somebody will be left without a break. */
  short: number
}

export function summarize(sheet: BreakSheet, assignments: Assignment[]): Summary {
  const reps = audience(sheet, assignments)
  const taken = sheet.slots.filter((s) => s.chosenBy).length
  const waiting = reps.filter((id) => !mySlot(sheet, id))
  return { total: sheet.slots.length, taken, free: sheet.slots.length - taken, reps: reps.length, waiting, short: Math.max(0, reps.length - sheet.slots.length) }
}

// --- The same rules as the database functions, used by the local demo store -----------------------------

const fail = (message: string): never => {
  throw new Error(message)
}

const patchSlot = (sheet: BreakSheet, id: string, change: Partial<BreakSlot>): BreakSheet => ({
  ...sheet,
  slots: sheet.slots.map((s) => (s.id === id ? { ...s, ...change } : s)),
})

/** A rep picks (or switches to) a row. If the row is taken, nothing changes. */
export function chooseSlot(sheet: BreakSheet, slotId: string, employeeId: string, assignments: Assignment[]): BreakSheet {
  const slot = sheet.slots.find((s) => s.id === slotId) ?? fail('ההפסקה לא נמצאה')
  if (sheet.status !== 'open') fail('הבחירה בהפסקות סגורה')
  if (!canTake(sheet, slot, employeeId, assignments)) fail('אינך משובץ במשמרת הזו')
  if (slot.chosenBy && slot.chosenBy !== employeeId) fail('ההפסקה כבר נבחרה על ידי מישהו אחר')
  const released: BreakSheet = {
    ...sheet,
    slots: sheet.slots.map((s) => (s.chosenBy === employeeId && s.id !== slotId ? { ...s, chosenBy: null, chosenAt: null } : s)),
  }
  return patchSlot(released, slotId, { chosenBy: employeeId, chosenAt: new Date().toISOString() })
}

/** A rep gives a row back (only while the sheet is open); a manager can clear any row. */
export function releaseSlot(sheet: BreakSheet, slotId: string, actorId: string, isManager: boolean): BreakSheet {
  const slot = sheet.slots.find((s) => s.id === slotId) ?? fail('ההפסקה לא נמצאה')
  if (!isManager && !(slot.chosenBy === actorId && sheet.status === 'open')) fail('אין הרשאה')
  return patchSlot(sheet, slotId, { chosenBy: null, chosenAt: null })
}

/** A manager puts a person on a row, replacing whoever had it and the person's previous row. */
export function assignSlot(sheet: BreakSheet, slotId: string, employeeId: string): BreakSheet {
  if (!sheet.slots.some((s) => s.id === slotId)) fail('ההפסקה לא נמצאה')
  const released: BreakSheet = {
    ...sheet,
    slots: sheet.slots.map((s) => (s.chosenBy === employeeId && s.id !== slotId ? { ...s, chosenBy: null, chosenAt: null } : s)),
  }
  return patchSlot(released, slotId, { chosenBy: employeeId, chosenAt: new Date().toISOString() })
}
