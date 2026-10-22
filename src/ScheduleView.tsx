import { useMemo, useState } from 'react'
import { autoDraft } from './autodraft.ts'
import { HE_DAYS, HE_DAYS_SHORT, addDays, fmtDM, toISO, weekDates, weekday } from './dates.ts'
import { api } from './db.ts'
import { HOLIDAYS, KINDS, SHIFTS, required } from './data.ts'
import { useEmployees, useNameOf } from './employees-context.ts'
import { checkAdd, validate, type Context } from './rules.ts'
import { isStaff, useApp } from './store.ts'
import type { Assignment, Rule, ShiftKind, Violation } from './types.ts'

interface Props {
  weekStart: string
  setWeekStart: (s: string) => void
}

export default function ScheduleView({ weekStart, setWeekStart }: Props) {
  const app = useApp()
  const { role, me, assignments, rules, timeOff, prefs, online } = app
  const employees = useEmployees()
  const nameOf = useNameOf()
  const dates = weekDates(weekStart)
  const todayISO = toISO(new Date())
  const [day, setDay] = useState(dates.includes(todayISO) ? todayISO : dates[0])
  const [pick, setPick] = useState<{ date: string; kind: ShiftKind } | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const [weekMode, setWeekMode] = useState(false)

  const staff = isStaff(role)
  const canOverride = role === 'admin' || role === 'main'
  const published = online ? !!app.weeks[weekStart] : true
  const activeDay = dates.includes(day) ? day : dates[0]
  const ctx = useMemo(() => ({ timeOff, prefs }), [timeOff, prefs])

  const violations = useMemo(() => {
    if (!staff) return []
    const list = validate(assignments, rules, employees, weekStart, ctx)
    return list.map<Violation>((v) => {
      const a = assignments.find((x) => x.employeeId === v.employeeId && x.date === v.date && x.kind === v.kind)
      return a?.override && v.severity === 'hard' ? { ...v, overridden: true } : v
    })
  }, [staff, assignments, rules, employees, weekStart, ctx])

  const weekAssignments = assignments.filter((a) => dates.includes(a.date))
  const inWeek = (v: Violation) => !v.date || dates.includes(v.date)
  const hard = violations.filter((v) => v.severity === 'hard' && !v.overridden && inWeek(v))
  const soft = violations.filter((v) => (v.severity === 'soft' || v.overridden) && inWeek(v))
  const away = timeOff.filter((t) => t.status === 'approved' && t.from <= dates[6] && t.to >= dates[0])

  const inCell = (date: string, kind: ShiftKind) => assignments.filter((a) => a.date === date && a.kind === kind)

  let shortage = 0
  for (const d of dates) {
    for (const k of KINDS) shortage += Math.max(0, required(d, k, weekday(d)) - inCell(d, k).length)
  }

  const generate = () => {
    if (weekAssignments.length && !confirm('יצירה אוטומטית תחליף את כל השיבוץ הקיים בשבוע הזה. להמשיך?')) return
    const { assignments: draft, unfilled } = autoDraft({ weekStart, employees, rules, existing: assignments, ctx })
    // Shifts a main manager approved as an exception can't be removed by a manager: keep them.
    const locked = canOverride ? [] : weekAssignments.filter((a) => a.override)
    const lockedKeys = new Set(locked.map((a) => `${a.employeeId}|${a.date}`))
    const fresh = draft.filter((a) => !lockedKeys.has(`${a.employeeId}|${a.date}`))
    app.saveAssignments([...assignments.filter((a) => !dates.includes(a.date)), ...locked, ...fresh])
    if (unfilled) alert(`נשארו ${unfilled} משבצות ריקות: אין עובד פנוי שעומד בכל החוקים.`)
  }

  const publish = (on: boolean) => {
    if (on && hard.length && !confirm(`יש ${hard.length} חריגות בשבוע. לפרסם בכל זאת?`)) return
    void app.run(() => api.publishWeek(weekStart, on), on ? 'הסידור פורסם והעובדים קיבלו הודעה' : 'הפרסום בוטל')
  }

  const cellViolation = (a: Assignment) =>
    violations.find((v) => v.employeeId === a.employeeId && v.date === a.date && v.kind === a.kind && !v.overridden)

  const renderCell = (date: string, kind: ShiftKind) => {
    const people = inCell(date, kind)
    const need = required(date, kind, weekday(date))
    if (need === 0 && people.length === 0) {
      return <div className="flex h-full min-h-14 items-center justify-center text-xs text-stone-300">—</div>
    }
    const missing = Math.max(0, need - people.length)
    return (
      <button
        type="button"
        disabled={!staff}
        onClick={() => setPick({ date, kind })}
        className="group flex h-full min-h-14 w-full flex-col gap-1.5 rounded-xl p-2 text-start transition enabled:hover:bg-white enabled:hover:shadow-sm"
      >
        <div className="flex flex-wrap gap-1">
          {people.map((a) => {
            const v = cellViolation(a)
            const mine = a.employeeId === me?.id
            const cls = v
              ? v.severity === 'hard'
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-amber-300 bg-amber-50 text-amber-800'
              : a.override
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : mine
                  ? 'border-brand-600 bg-brand-600 text-white shadow-[0_4px_10px_-4px_rgb(255_61_0/0.6)]'
                  : 'border-stone-200/70 bg-white text-stone-700 shadow-sm'
            return (
              <span key={a.id} title={v?.message} className={`rounded-full border px-2.5 py-0.5 text-[13px] font-medium ${cls}`}>
                {nameOf(a.employeeId)}
              </span>
            )
          })}
        </div>
        {staff && need > 0 && (
          <span className={`text-[11px] font-medium ${missing ? 'text-rose-500' : 'text-emerald-600'}`}>
            {people.length}/{need}
            {missing ? ` · חסר ${missing}` : ''}
          </span>
        )}
      </button>
    )
  }

  const body = (
    <>
      {/* Mobile: day strip + one day */}
      <div className={`md:hidden ${weekMode ? 'hidden' : ''}`}>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`relative flex w-14 shrink-0 flex-col items-center rounded-2xl px-2 py-2.5 text-sm transition ${
                d === activeDay ? 'bg-brand-600 text-white shadow-lift' : 'bg-white text-stone-600 shadow-soft ring-1 ring-stone-200/70'
              }`}
            >
              <span className="font-bold">{HE_DAYS_SHORT[weekday(d)]}</span>
              <span className="text-xs opacity-80">{fmtDM(d)}</span>
              {d === todayISO && <span className={`absolute bottom-1 size-1 rounded-full ${d === activeDay ? 'bg-white' : 'bg-brand-500'}`} />}
            </button>
          ))}
        </div>
        <div className="mt-2 space-y-3">
          {HOLIDAYS[activeDay] && (
            <div className="rounded-xl bg-sky-100 px-3 py-2 text-center text-sm font-semibold text-sky-800">{HOLIDAYS[activeDay]}</div>
          )}
          {KINDS.map((k) => (
            <section key={k} className={`rise rounded-2xl bg-white p-3 shadow-soft ring-1 ring-stone-200/70 ${SHIFTS[k].cell}`}>
              <header className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold ${SHIFTS[k].head}`}>
                <span>{SHIFTS[k].label}</span>
                <span className="text-xs font-normal opacity-80" dir="ltr">
                  {SHIFTS[k].time}
                </span>
              </header>
              {renderCell(activeDay, k)}
            </section>
          ))}
        </div>
      </div>

      {/* Desktop: week grid */}
      <div className={`${weekMode ? 'block' : 'hidden'} overflow-x-auto rounded-3xl bg-white shadow-lift ring-1 ring-stone-200/70 md:block`}>
        <div className="grid min-w-[58rem] grid-cols-[6.5rem_repeat(7,minmax(0,1fr))] text-sm md:min-w-0">
          <div className="border-b border-stone-200 bg-stone-50 p-3 text-xs font-semibold text-stone-400">משמרת</div>
          {dates.map((d) => {
            const isToday = d === todayISO
            return (
              <div key={d} className={`border-b border-s border-stone-200 p-3 text-center ${isToday ? 'bg-brand-50' : weekday(d) >= 5 ? 'bg-stone-100/70' : 'bg-stone-50'}`}>
                <div className={`font-bold ${isToday ? 'text-brand-700' : ''}`}>{HE_DAYS[weekday(d)]}</div>
                <div className={`text-xs ${isToday ? 'font-semibold text-brand-600' : 'text-stone-500'}`}>
                  {isToday ? `היום · ${fmtDM(d)}` : fmtDM(d)}
                </div>
                {HOLIDAYS[d] && <div className="mt-1 rounded-md bg-sky-100 px-1 text-[11px] font-semibold text-sky-800">{HOLIDAYS[d]}</div>}
              </div>
            )
          })}
          {KINDS.map((k) => (
            <Row key={k} kind={k} dates={dates} today={todayISO} renderCell={renderCell} />
          ))}
        </div>
      </div>
    </>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
        {staff && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Stat tone={shortage ? 'rose' : 'emerald'} label="חוסר" value={shortage} />
            <Stat tone={hard.length ? 'rose' : 'emerald'} label="חריגות" value={hard.length} onClick={() => setShowIssues(true)} />
            <Stat tone={soft.length ? 'amber' : 'emerald'} label="אזהרות" value={soft.length} onClick={() => setShowIssues(true)} />
          </div>
        )}
      </div>

      <div className="flex rounded-xl bg-stone-200/60 p-1 text-sm font-semibold md:hidden">
        {([false, true] as const).map((wk) => (
          <button
            key={String(wk)}
            type="button"
            onClick={() => setWeekMode(wk)}
            className={`flex-1 rounded-lg py-1.5 transition ${weekMode === wk ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'}`}
          >
            {wk ? 'שבוע' : 'יום'}
          </button>
        ))}
      </div>

      {staff && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${published ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {published ? 'פורסם' : 'טיוטה'}
          </span>
          <button type="button" onClick={generate} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm ring-1 ring-brand-200 hover:bg-brand-50">
            ✨ יצירה אוטומטית
          </button>
          {online && (
            <button
              type="button"
              onClick={() => publish(true)}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
            >
              {published ? 'פרסם עדכון' : 'פרסם משמרות'}
            </button>
          )}
          {online && published && (
            <button type="button" onClick={() => publish(false)} className="px-2 py-2 text-sm text-stone-500 hover:text-stone-800">
              בטל פרסום
            </button>
          )}
        </div>
      )}

      {staff && away.length > 0 && (
        <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          🌴 בחופשה השבוע: {away.map((t) => `${nameOf(t.employeeId)} (${fmtDM(t.from)}–${fmtDM(t.to)})`).join(', ')}
        </div>
      )}

      {!staff && !published ? (
        <div className="rounded-3xl bg-white px-6 py-16 text-center text-stone-500 shadow-soft ring-1 ring-stone-200/70">הסידור לשבוע הזה טרם פורסם</div>
      ) : (
        body
      )}

      {showIssues && <Issues hard={hard} soft={soft} onClose={() => setShowIssues(false)} />}

      {pick && (
        <Picker
          pick={pick}
          assignments={assignments}
          rules={rules}
          ctx={ctx}
          canOverride={canOverride}
          onChange={app.saveAssignments}
          onClose={() => setPick(null)}
        />
      )}

      {staff && <WeekPanel assignments={weekAssignments} violations={violations} weekStart={weekStart} />}
    </div>
  )
}

export function WeekNav({ weekStart, setWeekStart }: Props) {
  const btn =
    'grid size-10 place-items-center rounded-xl bg-white text-lg text-stone-600 shadow-soft ring-1 ring-stone-200/70 transition hover:bg-brand-50 hover:text-brand-700'
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="שבוע קודם" onClick={() => setWeekStart(addDays(weekStart, -7))} className={btn}>
        ›
      </button>
      <div className="min-w-44 text-center">
        <div className="text-lg font-bold">
          {fmtDM(weekStart)} – {fmtDM(addDays(weekStart, 6))}
        </div>
        <div className="text-xs text-stone-500">שבוע {weekStart.slice(0, 4)}</div>
      </div>
      <button type="button" aria-label="שבוע הבא" onClick={() => setWeekStart(addDays(weekStart, 7))} className={btn}>
        ‹
      </button>
    </div>
  )
}

function Row({
  kind,
  dates,
  today,
  renderCell,
}: {
  kind: ShiftKind
  dates: string[]
  today: string
  renderCell: (d: string, k: ShiftKind) => React.ReactNode
}) {
  return (
    <>
      <div className={`flex flex-col justify-center border-b border-stone-200 p-3 ${SHIFTS[kind].head}`}>
        <span className="font-bold">{SHIFTS[kind].label}</span>
        <span className="text-[11px] opacity-75" dir="ltr">
          {SHIFTS[kind].time}
        </span>
      </div>
      {dates.map((d) => (
        <div key={d} className={`border-b border-s border-stone-200 p-1 ${d === today ? 'bg-brand-50/60' : SHIFTS[kind].cell}`}>
          {renderCell(d, kind)}
        </div>
      ))}
    </>
  )
}

function Stat({ tone, label, value, onClick }: { tone: 'rose' | 'amber' | 'emerald'; label: string; value: number; onClick?: () => void }) {
  const tones = {
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  }
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${tones[tone]}`}>
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

function WeekPanel({ assignments, violations, weekStart }: { assignments: Assignment[]; violations: Violation[]; weekStart: string }) {
  const employees = useEmployees()
  return (
    <section className="rounded-3xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70">
      <h2 className="mb-3 text-sm font-bold text-stone-500">משמרות לעובד השבוע</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {employees.map((e) => {
          const n = assignments.filter((a) => a.employeeId === e.id).length
          const lacking = violations.some((v) => v.employeeId === e.id && !v.date && v.key.endsWith(weekStart))
          const tone =
            e.target === 0
              ? 'bg-stone-100 text-stone-500'
              : n === 0
                ? 'bg-rose-100 text-rose-700'
                : n < e.target || lacking
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-700'
          return (
            <div key={e.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium ${tone}`}>
              <span>{e.name}</span>
              <span className="font-bold">{n}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Issues({ hard, soft, onClose }: { hard: Violation[]; soft: Violation[]; onClose: () => void }) {
  const nameOf = useNameOf()
  const row = (v: Violation) => (
    <li key={v.key} className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="font-semibold">{nameOf(v.employeeId)}</span>
      <span className="flex-1 text-stone-600">
        {v.message}
        {v.overridden ? ' (חריגה מאושרת)' : ''}
      </span>
      {v.date && v.kind && (
        <span className="shrink-0 text-xs text-stone-400">
          {fmtDM(v.date)} · {SHIFTS[v.kind].label}
        </span>
      )}
    </li>
  )
  return (
    <Sheet title="חריגות ואזהרות" onClose={onClose}>
      {hard.length === 0 && soft.length === 0 && <p className="py-6 text-center text-stone-500">הכול תקין ✓</p>}
      {hard.length > 0 && (
        <>
          <h3 className="mt-2 text-xs font-bold text-rose-600">חריגות ({hard.length})</h3>
          <ul className="divide-y divide-stone-100">{hard.map(row)}</ul>
        </>
      )}
      {soft.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-bold text-amber-700">אזהרות ({soft.length})</h3>
          <ul className="divide-y divide-stone-100">{soft.map(row)}</ul>
        </>
      )}
    </Sheet>
  )
}

function Picker({
  pick,
  assignments,
  rules,
  ctx,
  canOverride,
  onChange,
  onClose,
}: {
  pick: { date: string; kind: ShiftKind }
  assignments: Assignment[]
  rules: Rule[]
  ctx: Context
  canOverride: boolean
  onChange: (a: Assignment[]) => void
  onClose: () => void
}) {
  const employees = useEmployees()
  const { date, kind } = pick
  const here = assignments.filter((a) => a.date === date && a.kind === kind)
  const wish = (employeeId: string) =>
    ctx.prefs?.find((p) => p.employeeId === employeeId && date >= p.weekStart && date <= addDays(p.weekStart, 6))?.cells[`${date}|${kind}`]

  const toggle = (employeeId: string, override: boolean) => {
    const existing = here.find((a) => a.employeeId === employeeId)
    if (existing) onChange(assignments.filter((a) => a.id !== existing.id))
    else onChange([...assignments, { id: `${date}|${kind}|${employeeId}`, date, kind, employeeId, ...(override ? { override: true } : {}) }])
  }

  return (
    <Sheet title={`${HE_DAYS[weekday(date)]} ${fmtDM(date)} · ${SHIFTS[kind].label}`} onClose={onClose}>
      <ul className="space-y-1.5">
        {employees.map((e) => {
          const assigned = here.some((a) => a.employeeId === e.id)
          const issues = assigned ? [] : checkAdd(assignments, rules, employees, { id: 'cand', date, kind, employeeId: e.id }, ctx)
          const hardIssue = issues.find((v) => v.severity === 'hard')
          const softIssue = issues.find((v) => v.severity === 'soft')
          const blocked = !!hardIssue && !canOverride
          const w = wish(e.id)
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={blocked}
                onClick={() => toggle(e.id, !!hardIssue)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start ring-1 transition ${
                  assigned
                    ? 'bg-brand-50 ring-brand-300'
                    : blocked
                      ? 'bg-stone-50 opacity-60 ring-stone-200'
                      : 'bg-white ring-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className={`grid size-5 place-items-center rounded-md text-xs text-white ${assigned ? 'bg-brand-600' : 'bg-stone-200'}`}>
                    {assigned ? '✓' : ''}
                  </span>
                  <span className="font-medium">{e.name}</span>
                  {w === 'prefer' && <span className="rounded-full bg-emerald-100 px-2 text-[11px] text-emerald-700">מעדיף</span>}
                  {w === 'cant' && <span className="rounded-full bg-rose-100 px-2 text-[11px] text-rose-700">לא יכול</span>}
                </span>
                {hardIssue ? (
                  <span className="text-xs text-rose-600">
                    {blocked ? '🚫 ' : '⚠ '}
                    {hardIssue.message}
                    {canOverride ? ' · אישור חריגה' : ''}
                  </span>
                ) : softIssue ? (
                  <span className="text-xs text-amber-700">⚠ {softIssue.message}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 backdrop-blur-[2px] md:items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl md:max-w-md md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-stone-100 text-stone-600 hover:bg-stone-200" aria-label="סגור">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
