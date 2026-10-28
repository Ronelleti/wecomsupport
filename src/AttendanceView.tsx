import { useMemo, useState } from 'react'
import { exportReportExcel, ReportSheet } from './attendanceExport.tsx'
import { buildReport } from './attendanceReport.ts'
import { ATTENDANCE, SHIFTS } from './data.ts'
import { HE_DAYS, addDays, fmtDM, toISO, weekday } from './dates.ts'
import { api } from './db.ts'
import { printWeek } from './exportWeek.tsx'
import { useApp } from './store.ts'
import type { Attendance, AttendanceStatus } from './types.ts'

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'

const monthLabel = (first: string) =>
  new Date(`${first}T00:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

/** Monthly late / late-login / absent report. Visible to managers only. */
export default function AttendanceView() {
  const app = useApp()
  const today = toISO(new Date())
  const [month, setMonth] = useState(() => `${today.slice(0, 7)}-01`)
  const [dept, setDept] = useState('all')
  const next = addDays(month, 31).slice(0, 7) + '-01'
  const prev = addDays(month, -1).slice(0, 7) + '-01'

  const report = useMemo(
    () =>
      buildReport({
        month,
        assignments: app.assignments,
        attendance: app.attendance,
        employees: app.employees,
        departments: app.departments,
        today,
        departmentId: dept,
      }),
    [month, dept, today, app.assignments, app.attendance, app.employees, app.departments],
  )
  const scope = dept === 'all' ? 'כל המחלקות' : (app.departments.find((d) => d.id === dept)?.name ?? '')

  const clear = (name: string, m: Attendance) => {
    if (confirm(`להסיר את הסימון של ${name} מתאריך ${fmtDM(m.date)}?`)) {
      void app.run(() => api.markAttendance(m.employeeId, m.date, m.kind, '', ''), 'הסימון הוסר')
    }
  }

  const btn = 'grid size-10 place-items-center rounded-xl bg-white text-lg text-stone-600 shadow-soft ring-1 ring-stone-200/70 hover:bg-brand-50'
  const action = 'rounded-xl bg-white px-4 py-2 text-sm font-semibold text-stone-700 shadow-soft ring-1 ring-stone-200/70 hover:bg-stone-50'
  const t = report.totals
  const stat = (label: string, value: string | number, tone: string) => (
    <div className={`rounded-2xl px-4 py-3 ${tone}`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-xs font-medium opacity-80">{label}</div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">דוח נוכחות חודשי</h1>
        <p className="text-sm text-stone-500">
          איחורים, איחורי התחברות וחיסורים שסימנו מנהלים. את הסימון עושים בלחיצה על משמרת בלוח השיבוצים. נספרות רק משמרות שכבר התקיימו.
        </p>
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
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium">
          <option value="all">כל המחלקות</option>
          {app.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" className={action} onClick={() => exportReportExcel({ report, scope })}>
          📊 Excel
        </button>
        <button type="button" className={action} onClick={() => printWeek()}>
          🖨 PDF / הדפסה
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat('משמרות שהתקיימו', t.scheduled, 'bg-white ring-1 ring-stone-200/70')}
        {stat(ATTENDANCE.late.label, t.late, ATTENDANCE.late.badge)}
        {stat(ATTENDANCE.late_login.label, t.lateLogin, ATTENDANCE.late_login.badge)}
        {stat('חיסורים', t.absent, ATTENDANCE.absent.badge)}
        {stat('אחוז נוכחות', pct(t.attendancePct), 'bg-emerald-100 text-emerald-800')}
        {stat('אחוז דייקנות', pct(t.punctualPct), 'bg-sky-100 text-sky-900')}
      </div>

      {report.rows.length === 0 ? (
        <div className={`${card} py-10 text-center text-stone-400`}>אין משמרות או סימונים בחודש הזה</div>
      ) : (
        <div className={`${card} overflow-x-auto p-0`}>
          <table className="w-full min-w-[40rem] text-center text-sm">
            <thead>
              <tr className="bg-stone-50 text-xs text-stone-500">
                <th className="p-3 text-start">עובד</th>
                <th className="p-3">משמרות</th>
                <th className="p-3">{ATTENDANCE.late.icon} איחורים</th>
                <th className="p-3">{ATTENDANCE.late_login.icon} התחברות</th>
                <th className="p-3">{ATTENDANCE.absent.icon} חיסורים</th>
                <th className="p-3">נוכחות</th>
                <th className="p-3">דייקנות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {report.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="p-3 text-start font-semibold">
                    {r.name}
                    {dept === 'all' && r.department && <span className="ms-2 text-xs font-normal text-stone-400">{r.department}</span>}
                  </td>
                  <td className="p-3">{r.scheduled}</td>
                  <td className="p-3">{r.late || '·'}</td>
                  <td className="p-3">{r.lateLogin || '·'}</td>
                  <td className="p-3">{r.absent || '·'}</td>
                  <td className="p-3">{pct(r.attendancePct)}</td>
                  <td className="p-3">{pct(r.punctualPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.rows.some((r) => r.events.length > 0) && <h2 className="pt-2 text-sm font-bold text-stone-500">פירוט</h2>}
      <ul className="space-y-2">
        {report.rows
          .filter((r) => r.events.length > 0)
          .map((r) => (
            <li key={r.employeeId} className={card}>
              <div className="font-bold">{r.name}</div>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {r.events.map((m) => (
                  <li key={`${m.date}|${m.kind}`} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <span className={`me-2 rounded-md px-1.5 py-0.5 text-xs font-semibold ${ATTENDANCE[m.status as AttendanceStatus].badge}`}>
                        {ATTENDANCE[m.status].icon} {ATTENDANCE[m.status].label}
                      </span>
                      {HE_DAYS[weekday(m.date)]} {fmtDM(m.date)} · {SHIFTS[m.kind].label}
                      {m.note ? <span className="text-stone-500"> · “{m.note}”</span> : null}
                    </span>
                    <button type="button" onClick={() => clear(r.name, m)} className="text-xs text-stone-400 hover:text-rose-600">
                      הסרה
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
      </ul>

      <ReportSheet report={report} scope={scope} />
    </div>
  )
}
