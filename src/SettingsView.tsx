import { useState } from 'react'
import { HE_DAYS, fmtDM } from './dates.ts'
import { api } from './db.ts'
import { KINDS, SHIFTS } from './data.ts'
import { useApp } from './store.ts'
import type { Config, ShiftKind } from './types.ts'

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'
const input = 'rounded-lg border border-stone-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'
const primary = 'rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'

const ROW_LABELS = [...HE_DAYS, 'חג']

/** Staffing needs, holidays and the preference deadline. */
export default function SettingsView() {
  const app = useApp()
  const { config } = app
  const [staffing, setStaffing] = useState<Config['staffing']>(() => structuredClone(config.staffing))
  const [deadline, setDeadline] = useState(config.prefDeadlineDay)
  const [holiday, setHoliday] = useState({ date: '', name: '' })

  const setNeed = (day: number, kind: ShiftKind, value: number) =>
    setStaffing((s) => ({ ...s, [day]: { ...s[day], [kind]: Math.max(0, Math.min(50, Number.isFinite(value) ? value : 0)) } }))

  const addHoliday = () => {
    if (!holiday.date || !holiday.name.trim()) return
    void app.run(() => api.saveHolidays({ [holiday.date]: holiday.name.trim() }, []), 'החג נוסף')
    setHoliday({ date: '', name: '' })
  }

  const holidays = Object.entries(config.holidays).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">הגדרות</h1>

      <section className={card}>
        <h2 className="font-bold">כמה עובדים נדרשים בכל משמרת</h2>
        <p className="mb-3 text-sm text-stone-500">היצירה האוטומטית וספירת החוסרים משתמשות במספרים האלה. שורת "חג" חלה על תאריכים שמוגדרים כחג למטה.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-center text-sm">
            <thead>
              <tr>
                <th />
                {KINDS.map((k) => (
                  <th key={k} className={`rounded-lg p-2 font-semibold ${SHIFTS[k].head}`}>
                    {SHIFTS[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_LABELS.map((label, day) => (
                <tr key={label}>
                  <td className="p-2 text-start font-semibold">{label}</td>
                  {KINDS.map((k) => (
                    <td key={k} className="p-1">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        className={`${input} w-16 text-center`}
                        value={staffing[day]?.[k] ?? 0}
                        onChange={(e) => setNeed(day, k, Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className={`${primary} mt-3`} onClick={() => void app.run(() => api.saveStaffing({ ...config, staffing }), 'נשמר')}>
          שמירת הצורך באיוש
        </button>
      </section>

      <section className={card}>
        <h2 className="font-bold">חגים וימים מיוחדים</h2>
        <ul className="my-3 divide-y divide-stone-100">
          {holidays.length === 0 && <li className="py-2 text-sm text-stone-400">אין</li>}
          {holidays.map(([date, name]) => (
            <li key={date} className="flex items-center justify-between py-2 text-sm">
              <span>
                <b>{fmtDM(date)}</b> · {name}
              </span>
              <button type="button" className="text-rose-600" onClick={() => void app.run(() => api.saveHolidays({}, [date]), 'החג הוסר')}>
                הסרה
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input type="date" className={input} value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
          <input className={`${input} min-w-40 flex-1`} placeholder="שם החג" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
          <button type="button" className={primary} onClick={addHoliday}>
            הוספה
          </button>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-bold">מועד אחרון להעדפות</h2>
        <p className="mb-3 text-sm text-stone-500">עד איזה יום בשבוע שלפני, עובדים צריכים לשלוח העדפות לשבוע הבא.</p>
        <div className="flex items-center gap-2">
          <select className={input} value={deadline} onChange={(e) => setDeadline(Number(e.target.value))}>
            {HE_DAYS.map((d, i) => (
              <option key={d} value={i}>
                יום {d}
              </option>
            ))}
          </select>
          <button type="button" className={primary} onClick={() => void app.run(() => api.savePrefDeadline(deadline), 'נשמר')}>
            שמירה
          </button>
        </div>
      </section>
    </div>
  )
}
