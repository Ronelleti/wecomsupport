import { weekday } from './dates.ts'
import type { Assignment, AttendanceStatus, Config, Department, Employee, Rule, ShiftKind } from './types.ts'

export const KINDS: ShiftKind[] = ['morning', 'mid', 'evening', 'night']

export const SHIFTS: Record<
  ShiftKind,
  { label: string; time: string; start: number; head: string; cell: string }
> = {
  morning: { label: 'בוקר', time: '8:00–16:00', start: 8, head: 'bg-amber-100 text-amber-900', cell: 'bg-amber-50/50' },
  mid: { label: 'ביניים', time: '10:00–18:00', start: 10, head: 'bg-teal-100 text-teal-900', cell: 'bg-teal-50/50' },
  evening: { label: 'ערב', time: '15:00–23:00', start: 15, head: 'bg-violet-100 text-violet-900', cell: 'bg-violet-50/50' },
  night: { label: 'לילה', time: '23:00–08:00', start: 23, head: 'bg-slate-800 text-white', cell: 'bg-slate-100/60' },
}

/** Look and wording of each attendance classification. */
export const ATTENDANCE: Record<AttendanceStatus, { label: string; icon: string; chip: string; badge: string; button: string }> = {
  late: {
    label: 'איחור',
    icon: '⏰',
    chip: 'border-amber-400 bg-amber-100 text-amber-900',
    badge: 'bg-amber-100 text-amber-900',
    button: 'bg-amber-200 text-amber-900 ring-amber-400',
  },
  late_login: {
    label: 'איחור התחברות',
    icon: '💻',
    chip: 'border-violet-400 bg-violet-100 text-violet-900',
    badge: 'bg-violet-100 text-violet-900',
    button: 'bg-violet-200 text-violet-900 ring-violet-400',
  },
  absent: {
    label: 'לא הגיע',
    icon: '✕',
    chip: 'border-rose-400 bg-rose-100 text-rose-800 line-through decoration-2',
    badge: 'bg-rose-100 text-rose-800',
    button: 'bg-rose-200 text-rose-900 ring-rose-400',
  },
}

export const DEFAULT_DEPARTMENTS: Department[] = [
  { id: 'tech', name: 'תמיכה בכל המערכת', sort: 0, active: true },
  { id: 'service', name: 'שירות', sort: 1, active: true },
  { id: 'shiftmgr', name: 'אחמ"שיה', sort: 2, active: true },
  { id: 'experts', name: 'מומחים', sort: 3, active: true },
]

const emptyNeed = (): Record<number, Record<ShiftKind, number>> =>
  Object.fromEntries(Array.from({ length: 8 }, (_, d) => [d, { morning: 0, mid: 0, evening: 0, night: 0 }]))

const weekdayNeed = { morning: 5, mid: 2, evening: 5, night: 1 }

/** Staffing for the first department; day type 7 is "holiday". The others start empty. */
const techNeed = (): Record<number, Record<ShiftKind, number>> => ({
  0: { ...weekdayNeed },
  1: { ...weekdayNeed },
  2: { ...weekdayNeed },
  3: { ...weekdayNeed },
  4: { ...weekdayNeed },
  5: { morning: 5, mid: 2, evening: 4, night: 1 },
  6: { morning: 2, mid: 0, evening: 2, night: 1 },
  7: { morning: 5, mid: 0, evening: 5, night: 1 },
})

/** Used in demo mode and until a database value exists. */
export const DEFAULT_CONFIG: Config = {
  staffing: {
    tech: techNeed(),
    service: emptyNeed(),
    shiftmgr: emptyNeed(),
    experts: emptyNeed(),
  },
  holidays: { '2026-10-27': 'יום בחירות' },
  prefDeadlineDay: 3,
}

/** Required headcount for a shift: holidays use their own row, other days use the weekday's row. */
export function makeNeed(config: Config) {
  return (date: string, kind: ShiftKind, departmentId: string): number => {
    const row = config.holidays[date] ? 7 : weekday(date)
    return config.staffing[departmentId]?.[row]?.[kind] ?? 0
  }
}

const E = (id: string, name: string, target = 5): Employee => ({ id, name, target, departmentId: 'tech' })

export const EMPLOYEES: Employee[] = [
  E('mohammed', 'מוחמד'),
  E('ibrahim', 'איברהים'),
  E('tahlil', 'תהליל'),
  E('nada', 'נדא'),
  E('evitar', 'אביתר'),
  E('avinoam', 'אבינועם'),
  E('yair', 'יאיר'),
  E('tomer', 'תומר'),
  E('ofek', 'אופק'),
  E('eden', 'עדן'),
  E('orfaz', 'אורפז'),
  E('dami', 'דמי', 0),
  E('daniel', 'דניאל'),
  E('denis', 'דניס'),
  E('jenny', "ג'ני"),
  E('moshe', 'משה'),
  E('naomi', 'נעמי'),
  E('rossi', 'רוסי'),
  E('elad', 'אלעד'),
  E('miguel', 'מיגל'),
  E('sharon', 'שרון'),
]

const ALL_KINDS = KINDS

export const INITIAL_RULES: Rule[] = [
  { id: 'r1', label: 'עד 6 משמרות בשבוע (חלון נע של 7 ימים)', who: 'all', severity: 'hard', enabled: true, params: { type: 'maxPerRollingWeek', max: 6 } },
  { id: 'r2a', label: 'ללא לילות', who: ['sharon', 'orfaz', 'naomi', 'eden', 'nada'], severity: 'hard', enabled: true, params: { type: 'noKinds', kinds: ['night'] } },
  { id: 'r2b', label: 'ללא שבתות', who: ['sharon', 'orfaz', 'naomi', 'eden', 'nada'], severity: 'hard', enabled: true, params: { type: 'noShabbat' } },
  { id: 'r3a', label: 'ללא שבת (יום שבת)', who: ['ofek', 'tomer', 'nada', 'naomi'], severity: 'hard', enabled: true, params: { type: 'noWeekdays', days: [6] } },
  { id: 'r3b', label: 'עד 2 שישי בחודש', who: ['ofek', 'tomer', 'nada', 'naomi'], severity: 'soft', enabled: true, params: { type: 'maxFridaysPerMonth', max: 2 } },
  { id: 'r4a', label: 'לפחות 5 משמרות בשבוע', who: ['ibrahim'], severity: 'soft', enabled: true, params: { type: 'minPerWeek', min: 5 } },
  { id: 'r4b', label: 'עד 2 לילות בשבוע', who: ['ibrahim'], severity: 'hard', enabled: true, params: { type: 'maxNightsPerWeek', max: 2 } },
  { id: 'r5', label: 'ללא משמרות בשבת (אין תחבורה ציבורית)', who: ['rossi', 'moshe', 'denis'], severity: 'hard', enabled: true, params: { type: 'noShabbat' } },
  { id: 'r6a', label: 'ללא ערב אחרי לילה', who: ['daniel'], severity: 'hard', enabled: true, params: { type: 'noKindAfter', prev: 'night', next: 'evening' } },
  { id: 'r6b', label: 'ללא בוקר אחרי ערב', who: ['daniel'], severity: 'hard', enabled: true, params: { type: 'noKindAfter', prev: 'evening', next: 'morning' } },
  { id: 'r7', label: 'ללא לילות', who: ['tahlil'], severity: 'hard', enabled: true, params: { type: 'noKinds', kinds: ['night'] } },
  { id: 'r8a', label: 'ללא משמרות בוקר', who: ['jenny'], severity: 'hard', enabled: true, params: { type: 'noKinds', kinds: ['morning'] } },
  { id: 'r8b', label: 'ללא ימי ראשון', who: ['jenny'], severity: 'hard', enabled: true, params: { type: 'noWeekdays', days: [0] } },
  { id: 'r9a', label: 'עד 5 משמרות בשבוע', who: ['yair', 'avinoam', 'evitar'], severity: 'hard', enabled: true, params: { type: 'maxPerWeek', max: 5 } },
  { id: 'r9b', label: 'ללא שבתות', who: ['yair', 'avinoam', 'evitar'], severity: 'hard', enabled: true, params: { type: 'noShabbat' } },
  { id: 'r9c', label: 'ללא לילות', who: ['yair', 'avinoam', 'evitar'], severity: 'hard', enabled: true, params: { type: 'noKinds', kinds: ['night'] } },
  { id: 'r10a', label: 'נציג חדש: ללא לילות (עד 1/12)', who: ['miguel', 'sharon'], severity: 'hard', enabled: true, to: '2026-12-01', params: { type: 'noKinds', kinds: ['night'] } },
  { id: 'r10b', label: 'נציג חדש: ללא שבתות (עד 1/12)', who: ['miguel', 'sharon'], severity: 'hard', enabled: true, to: '2026-12-01', params: { type: 'noShabbat' } },
  { id: 'r12', label: 'ללא משמרות תמיכה', who: ['dami'], severity: 'hard', enabled: true, params: { type: 'noKinds', kinds: ALL_KINDS } },
]

type DayPlan = Partial<Record<ShiftKind, string[]>>

// Illustrative week only (not the real schedule). Wed night / tahlil intentionally breaks a rule.
const DEMO: Record<string, DayPlan> = {
  '2026-10-25': { morning: ['elad', 'nada', 'tomer', 'rossi', 'ibrahim'], mid: ['miguel', 'sharon'], evening: ['orfaz', 'mohammed', 'daniel', 'denis'], night: ['ofek'] },
  '2026-10-26': { morning: ['elad', 'nada', 'moshe', 'tomer', 'rossi', 'ofek'], mid: ['miguel', 'sharon'], evening: ['orfaz', 'mohammed', 'daniel', 'denis', 'eden'], night: ['jenny'] },
  '2026-10-27': { morning: ['tomer', 'ibrahim', 'elad', 'moshe'], evening: ['orfaz', 'sharon', 'denis', 'mohammed'], night: ['jenny'] },
  '2026-10-28': { morning: ['elad', 'mohammed', 'nada', 'tomer', 'ibrahim'], mid: ['miguel', 'sharon'], evening: ['orfaz', 'denis', 'naomi', 'daniel', 'moshe'], night: ['tahlil'] },
  '2026-10-29': { morning: ['elad', 'mohammed', 'naomi', 'rossi', 'ofek'], mid: ['miguel', 'sharon'], evening: ['orfaz', 'daniel', 'denis', 'tahlil', 'ibrahim'], night: ['jenny'] },
  '2026-10-30': { morning: ['naomi', 'moshe', 'nada', 'ofek', 'tomer'], mid: ['miguel', 'sharon'], evening: ['mohammed', 'tahlil', 'daniel', 'rossi'], night: ['ibrahim'] },
  '2026-10-31': { morning: ['elad', 'tahlil'], evening: ['mohammed', 'jenny'], night: ['daniel'] },
}

export function demoAssignments(): Assignment[] {
  const out: Assignment[] = []
  for (const [date, plan] of Object.entries(DEMO)) {
    for (const kind of KINDS) {
      for (const employeeId of plan[kind] ?? []) {
        out.push({ id: `${date}|${kind}|${employeeId}`, date, kind, employeeId, departmentId: 'tech' })
      }
    }
  }
  return out
}
