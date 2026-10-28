import * as XLSX from 'xlsx'
import type { Report } from './attendanceReport.ts'
import { ATTENDANCE, SHIFTS } from './data.ts'
import { HE_DAYS, fmtDM, weekday } from './dates.ts'
import { SHEET_ID } from './exportWeek.tsx'
import Logo from './Logo.tsx'

const monthTitle = (first: string) => new Date(`${first}T00:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

interface Props {
  report: Report
  /** Department name, or "כל המחלקות". */
  scope: string
}

/** Printable (PDF) monthly report. It sits off-screen until printed. */
export function ReportSheet({ report, scope }: Props) {
  const cell = 'border border-stone-300 p-2'
  return (
    <div id={SHEET_ID} dir="rtl" className="fixed -left-[9999px] top-0 w-[1100px] bg-white p-6 text-stone-900 print:absolute print:left-0 print:w-full">
      <div className="mb-4 flex items-center justify-between border-b-4 border-brand-500 pb-3">
        <div>
          <div className="text-2xl font-bold">דוח נוכחות חודשי</div>
          <div className="text-lg text-stone-600">
            {monthTitle(report.month)} · {scope}
          </div>
        </div>
        <Logo className="h-14" />
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-stone-100">
            {['עובד', 'מחלקה', 'משמרות שהתקיימו', 'איחורים', 'איחורי התחברות', 'חיסורים', 'משמרות שהגיע', 'אחוז נוכחות', 'אחוז דייקנות'].map((h) => (
              <th key={h} className={cell}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.employeeId} className="text-center">
              <td className={`${cell} text-start font-semibold`}>{r.name}</td>
              <td className={cell}>{r.department}</td>
              <td className={cell}>{r.scheduled}</td>
              <td className={cell}>{r.late}</td>
              <td className={cell}>{r.lateLogin}</td>
              <td className={cell}>{r.absent}</td>
              <td className={cell}>{r.attended}</td>
              <td className={cell}>{pct(r.attendancePct)}</td>
              <td className={cell}>{pct(r.punctualPct)}</td>
            </tr>
          ))}
          <tr className="bg-stone-100 text-center font-bold">
            <td className={`${cell} text-start`} colSpan={2}>
              סה״כ
            </td>
            <td className={cell}>{report.totals.scheduled}</td>
            <td className={cell}>{report.totals.late}</td>
            <td className={cell}>{report.totals.lateLogin}</td>
            <td className={cell}>{report.totals.absent}</td>
            <td className={cell}>{report.totals.attended}</td>
            <td className={cell}>{pct(report.totals.attendancePct)}</td>
            <td className={cell}>{pct(report.totals.punctualPct)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-stone-500">
        אחוז נוכחות = משמרות שהגיע ÷ משמרות שהתקיימו. אחוז דייקנות = משמרות בלי איחור, איחור התחברות או חיסור ÷ משמרות שהתקיימו.
      </p>
    </div>
  )
}

export function exportReportExcel({ report, scope }: Props) {
  const summary = [
    ['עובד', 'מחלקה', 'משמרות שהתקיימו', 'איחורים', 'איחורי התחברות', 'חיסורים', 'משמרות שהגיע', 'אחוז נוכחות', 'אחוז דייקנות'],
    ...report.rows.map((r) => [r.name, r.department, r.scheduled, r.late, r.lateLogin, r.absent, r.attended, r.attendancePct ?? '', r.punctualPct ?? '']),
    [
      'סה״כ',
      scope,
      report.totals.scheduled,
      report.totals.late,
      report.totals.lateLogin,
      report.totals.absent,
      report.totals.attended,
      report.totals.attendancePct ?? '',
      report.totals.punctualPct ?? '',
    ],
  ]
  const details = [
    ['תאריך', 'יום', 'עובד', 'מחלקה', 'משמרת', 'סיווג', 'הערה'],
    ...report.rows.flatMap((r) =>
      r.events.map((m) => [fmtDM(m.date), HE_DAYS[weekday(m.date)], r.name, r.department, SHIFTS[m.kind].label, ATTENDANCE[m.status].label, m.note]),
    ),
  ]

  const wb = XLSX.utils.book_new()
  const s1 = XLSX.utils.aoa_to_sheet(summary)
  s1['!cols'] = [{ wch: 18 }, { wch: 20 }, ...Array.from({ length: 7 }, () => ({ wch: 16 }))]
  const s2 = XLSX.utils.aoa_to_sheet(details)
  s2['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, s1, 'סיכום')
  XLSX.utils.book_append_sheet(wb, s2, 'פירוט')
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.writeFile(wb, `דוח-נוכחות-${report.month.slice(0, 7)}.xlsx`)
}
