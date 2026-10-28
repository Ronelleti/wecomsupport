import { toPng } from 'html-to-image'
import * as XLSX from 'xlsx'
import { HE_DAYS, fmtDM, weekDates, weekday } from './dates.ts'
import { KINDS, SHIFTS } from './data.ts'
import Logo from './Logo.tsx'
import type { Assignment, Attendance, Employee, ShiftKind } from './types.ts'

export interface SheetData {
  weekStart: string
  assignments: Assignment[]
  employees: Employee[]
  holidays: Record<string, string>
  nameOf: (id: string) => string
  /** The department whose board is exported. */
  title: string
  /** Late / absent marks to print next to names (managers only; empty for everyone else). */
  attendance: Attendance[]
}

const namesIn = (d: SheetData, date: string, kind: ShiftKind) =>
  d.assignments
    .filter((a) => a.date === date && a.kind === kind)
    .map((a) => {
      const mark = d.attendance.find((m) => m.employeeId === a.employeeId && m.date === a.date && m.kind === a.kind)
      return d.nameOf(a.employeeId) + (mark ? (mark.status === 'absent' ? ' (לא הגיע)' : ' (איחר)') : '')
    })
    .sort((x, y) => x.localeCompare(y, 'he'))

export const SHEET_ID = 'print-sheet'

/**
 * Plain, fixed-width version of the week used for printing / PDF and for the shareable image.
 * It sits off-screen until printed.
 */
export function ExportSheet(d: SheetData) {
  const dates = weekDates(d.weekStart)
  return (
    <div id={SHEET_ID} dir="rtl" className="fixed -left-[9999px] top-0 w-[1100px] bg-white p-6 text-stone-900 print:absolute print:left-0 print:w-full">
      <div className="mb-4 flex items-center justify-between border-b-4 border-brand-500 pb-3">
        <div>
          <div className="text-2xl font-bold">סידור עבודה{d.title ? ` · ${d.title}` : ''}</div>
          <div className="text-lg text-stone-600">
            {fmtDM(dates[0])} – {fmtDM(dates[6])} · {dates[0].slice(0, 4)}
          </div>
        </div>
        <Logo className="h-14" />
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-24 border border-stone-300 bg-stone-100 p-2">משמרת</th>
            {dates.map((date) => (
              <th key={date} className="border border-stone-300 bg-stone-100 p-2">
                <div>{HE_DAYS[weekday(date)]}</div>
                <div className="text-xs font-normal text-stone-500">{fmtDM(date)}</div>
                {d.holidays[date] && <div className="text-[11px] font-semibold text-sky-700">{d.holidays[date]}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KINDS.map((k) => (
            <tr key={k}>
              <td className={`border border-stone-300 p-2 font-bold ${SHIFTS[k].head}`}>
                <div>{SHIFTS[k].label}</div>
                <div className="text-[11px] font-normal opacity-80" dir="ltr">
                  {SHIFTS[k].time}
                </div>
              </td>
              {dates.map((date) => (
                <td key={date} className={`border border-stone-300 p-2 align-top ${SHIFTS[k].cell}`}>
                  {namesIn(d, date, k).map((n) => (
                    <div key={n} className="py-0.5">
                      {n}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function exportExcel(d: SheetData) {
  const dates = weekDates(d.weekStart)
  const header = ['משמרת', ...dates.map((date) => `${HE_DAYS[weekday(date)]} ${fmtDM(date)}`)]
  const bySlot = [
    header,
    ...KINDS.map((k) => [`${SHIFTS[k].label} ${SHIFTS[k].time}`, ...dates.map((date) => namesIn(d, date, k).join(', '))]),
  ]

  const byPerson = [
    [...header.slice(0, 1).map(() => 'עובד'), ...header.slice(1), 'סה״כ'],
    ...d.employees
      .map((e) => {
        const cells = dates.map((date) => {
          const a = d.assignments.find((x) => x.employeeId === e.id && x.date === date)
          return a ? SHIFTS[a.kind].label : ''
        })
        return [e.name, ...cells, cells.filter(Boolean).length] as (string | number)[]
      })
      .filter((row) => Number(row[row.length - 1]) > 0),
  ]

  const wb = XLSX.utils.book_new()
  const s1 = XLSX.utils.aoa_to_sheet(bySlot)
  s1['!cols'] = [{ wch: 20 }, ...dates.map(() => ({ wch: 28 }))]
  const s2 = XLSX.utils.aoa_to_sheet(byPerson)
  s2['!cols'] = [{ wch: 16 }, ...dates.map(() => ({ wch: 10 })), { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, s1, 'סידור')
  XLSX.utils.book_append_sheet(wb, s2, 'לפי עובד')
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.writeFile(wb, `סידור${d.title ? `-${d.title}` : ''}-${d.weekStart}.xlsx`)
}

/** Saves the week as a PNG, or opens the phone's share sheet (WhatsApp etc.) when it can. */
export async function exportImage(weekStart: string) {
  const el = document.getElementById(SHEET_ID)
  if (!el) return
  const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true })
  const blob = await (await fetch(dataUrl)).blob()
  const name = `סידור-${weekStart}.png`
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'סידור עבודה' })
      return
    } catch {
      // user closed the share sheet or sharing failed: fall back to a download
    }
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  a.click()
}

export const printWeek = () => window.print()
