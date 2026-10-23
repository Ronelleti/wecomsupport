import { weekday } from './dates.ts'
import type { Assignment, Config, Employee, Rule, ShiftKind } from './types.ts'

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

const weekdayNeed = { morning: 5, mid: 2, evening: 5, night: 1 }

/** Used in demo mode and until a database value exists. Index 7 is "holiday". */
export const DEFAULT_CONFIG: Config = {
  staffing: {
    0: weekdayNeed,
    1: weekdayNeed,
    2: weekdayNeed,
    3: weekdayNeed,
    4: weekdayNeed,
    5: { morning: 5, mid: 2, evening: 4, night: 1 },
    6: { morning: 2, mid: 0, evening: 2, night: 1 },
    7: { morning: 5, mid: 0, evening: 5, night: 1 },
  },
  holidays: { '2026-10-27': 'יום בחירות' },
  prefDeadlineDay: 3,
}

/** Required headcount for a shift: holidays use their own row, other days use the weekday's row. */
export function makeNeed(config: Config) {
  return (date: string, kind: ShiftKind): number => {
    const row = config.holidays[date] ? 7 : weekday(date)
    return config.staffing[row]?.[kind] ?? 0
  }
}

const E = (id: string, name: string, target = 5): Employee => ({ id, name, target })

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
        out.push({ id: `${date}|${kind}|${employeeId}`, date, kind, employeeId })
      }
    }
  }
  return out
}
