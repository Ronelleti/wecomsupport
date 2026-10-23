import { useEffect, useRef, useState } from 'react'
import { api } from './db.ts'
import { disablePush, enablePush, pushConfigured, pushState, sendTestPush, type PushState } from './push.ts'
import { useApp } from './store.ts'

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  if (mins < 1440) return `לפני ${Math.round(mins / 60)} שע׳`
  return `לפני ${Math.round(mins / 1440)} ימים`
}

/** Turn phone / browser notifications on or off for this device. */
function PushControl() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    void pushState().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [])

  if (!pushConfigured() || state === null) return null

  const act = async (fn: () => Promise<void>, ok = '') => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
      setMsg(ok)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'הפעולה נכשלה')
    }
    setState(await pushState())
    setBusy(false)
  }

  const btn = 'rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50'
  return (
    <div className="border-b border-stone-100 bg-stone-50 px-4 py-3 text-xs text-stone-600">
      {state === 'unsupported' && <p>המכשיר או הדפדפן הזה לא תומכים בהתראות לטלפון.</p>}
      {state === 'needs-install' && (
        <p>
          באייפון צריך קודם להוסיף את האפליקציה למסך הבית: ב-Safari לחצו על כפתור השיתוף (⬆) ← ״הוספה למסך הבית״, ופתחו אותה משם. אחרי זה תוכלו להפעיל התראות.
        </p>
      )}
      {state === 'denied' && <p>ההתראות חסומות במכשיר. אפשר לאפשר אותן בהגדרות הדפדפן או האפליקציה.</p>}
      {state === 'off' && (
        <div className="flex items-center justify-between gap-2">
          <span>קבלו התראה לטלפון על סידור חדש, החלפות ועוד.</span>
          <button type="button" disabled={busy} onClick={() => void act(enablePush, 'ההתראות הופעלו ✓')} className={`${btn} bg-brand-600 text-white`}>
            הפעלה
          </button>
        </div>
      )}
      {state === 'on' && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-emerald-700">✓ התראות פעילות במכשיר הזה</span>
          <span className="flex gap-1.5">
            <button type="button" disabled={busy} onClick={() => void act(sendTestPush, 'נשלחה התראת בדיקה')} className={`${btn} bg-white ring-1 ring-stone-200`}>
              בדיקה
            </button>
            <button type="button" disabled={busy} onClick={() => void act(disablePush, 'ההתראות כובו')} className={`${btn} text-stone-500`}>
              כיבוי
            </button>
          </span>
        </div>
      )}
      {msg && <p className="mt-2 text-stone-700">{msg}</p>}
    </div>
  )
}

export default function Bell() {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const unread = app.notices.filter((n) => !n.read)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const markAll = () => void app.run(() => api.markRead(unread.map((n) => n.id)))

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label="התראות"
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-xl text-xl text-stone-600 hover:bg-stone-100"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">
            {unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <span className="font-bold">התראות</span>
            {unread.length > 0 && (
              <button type="button" onClick={markAll} className="text-xs text-brand-600">
                סמן הכול כנקרא
              </button>
            )}
          </div>
          <PushControl />
          <ul className="max-h-96 overflow-y-auto">
            {app.notices.length === 0 && <li className="px-4 py-8 text-center text-sm text-stone-400">אין התראות</li>}
            {app.notices.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!n.read) void app.run(() => api.markRead([n.id]))
                    if (n.link) app.go(n.link)
                    setOpen(false)
                  }}
                  className={`block w-full px-4 py-3 text-start hover:bg-stone-50 ${n.read ? '' : 'bg-brand-50/60'}`}
                >
                  <div className="text-sm font-semibold">{n.title}</div>
                  {n.body && <div className="text-xs text-stone-600">{n.body}</div>}
                  <div className="mt-0.5 text-[11px] text-stone-400">{ago(n.createdAt)}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
