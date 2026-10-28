import { useState } from 'react'
import { HE_DAYS, addDays, fmtDM, toISO, weekday } from './dates.ts'
import { api } from './db.ts'
import { SHIFTS } from './data.ts'
import { useApp } from './store.ts'
import type { Attendance } from './types.ts'

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'

const monthLabel = (first: string) =>
  new Date(`${first}T00:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

/** Late / absent marks for one month, per employee. Visible to managers only. */
export default function AttendanceView() {
  const app = useApp()
  const [month, setMonth] = useState(() => `${toISO(new Date()).slice(0, 7)}-01`)
  const [dept, setDept] = useState('all')
  const next = addDays(month, 31).slice(0, 7) + '-01'
  const prev = addDays(month, -1).slice(0, 7) + '-01'
  const nameOf = (id: string) => app.employees.find((e) => e.id === id)?.name ?? id
  const deptOf = (id: string) => app.employees.find((e) => e.id === id)?.departmentId

  const marks = app.attendance
    .filter((m) => m.date >= month && m.date < next && (dept === 'all' || deptOf(m.employeeId) === dept))
    .sort((a, b) => a.date.localeCompare(b.date))

  const byPerson = new Map<string, Attendance[]>()
  for (const m of marks) byPerson.set(m.employeeId, [...(byPerson.get(m.employeeId) ?? []), m])
  const rows = [...byPerson.entries()]
    .map(([id, list]) => ({
      id,
      list,
      late: list.filter((m) => m.status === 'late').length,
      absent: list.filter((m) => m.status === 'absent').length,
    }))
    .sort((a, b) => b.absent - a.absent || b.late - a.late)

  const totalLate = rows.reduce((n, r) => n + r.late, 0)
  const totalAbsent = rows.reduce((n, r) => n + r.absent, 0)

  const clear = (m: Attendance) => {
    if (confirm(`להסיר את הסימון של ${nameOf(m.employeeId)} מתאריך ${fmtDM(m.date)}?`)) {
      void app.run(() => api.markAttendance(m.employeeId, m.date, m.kind, '', ''), 'הסימון הוסר')
    }
  }

  const btn = 'grid size-10 place-items-center rounded-xl bg-white text-lg text-stone-600 shadow-soft ring-1 ring-stone-200/70 hover:bg-brand-50'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">נוכחות</h1>
        <p className="text-sm text-stone-500">איחורים וחיסורים שסימנו מנהלים. את הסימון עושים בלחיצה על משמרת בלוח השיבוצים.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="חודש קודם" className={btn} onClick={() => setMonth(prev)}>
            ›
          </button>
          <div className="min-w-36 text-center text-lg font-bold">{monthLabel(month)}</div>
          <button type="button" aria-label="חודש הבא" className={btn} onClick={() => setMonth(next)}>
            ‹
          </button>
        </div>
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium"
        >
          <option value="all">כל המחלקות</option>
          {app.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2 text-sm font-semibold">
          <span className="rounded-xl bg-amber-100 px-3 py-1.5 text-amber-900">⏰ איחורים: {totalLate}</span>
          <span className="rounded-xl bg-rose-100 px-3 py-1.5 text-rose-800">✕ חיסורים: {totalAbsent}</span>
        </div>
      </div>

      {rows.length === 0 && <div className={`${card} py-10 text-center text-stone-400`}>אין איחורים או חיסורים בחודש הזה</div>}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={card}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{nameOf(r.id)}</span>
              <span className="flex gap-2 text-sm font-semibold">
                {r.late > 0 && <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-amber-900">⏰ {r.late}</span>}
                {r.absent > 0 && <span className="rounded-lg bg-rose-100 px-2.5 py-1 text-rose-800">✕ {r.absent}</span>}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-stone-100 text-sm">
              {r.list.map((m) => (
                <li key={`${m.date}|${m.kind}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    {m.status === 'absent' ? '✕ לא הגיע' : '⏰ איחר'} · {HE_DAYS[weekday(m.date)]} {fmtDM(m.date)} · {SHIFTS[m.kind].label}
                    {m.note ? <span className="text-stone-500"> · “{m.note}”</span> : null}
                  </span>
                  <button type="button" onClick={() => clear(m)} className="text-xs text-stone-400 hover:text-rose-600">
                    הסרה
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
