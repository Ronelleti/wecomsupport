import { useState } from 'react'
import { markPasswordChanged } from './db.ts'
import Logo from './Logo.tsx'
import { supabase } from './supabase.ts'

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 -end-40 size-[34rem] rounded-full bg-brand-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -start-40 size-[30rem] rounded-full bg-amber-300/20 blur-3xl" />
      <div className="rise relative w-full max-w-sm overflow-hidden rounded-[2rem] bg-white shadow-lift ring-1 ring-stone-200/70">
        <div className="h-1.5 bg-gradient-to-l from-brand-500 via-brand-400 to-amber-400" />
        <div className="p-7">
          <div className="mb-6 flex flex-col items-center text-center">
            <Logo className="mb-5 h-14" />
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-stone-500">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3 text-base outline-none transition placeholder:text-stone-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100'
const btnCls =
  'w-full rounded-xl bg-brand-600 py-3 font-semibold text-white shadow-[0_8px_20px_-8px_rgb(255_61_0/0.7)] transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError('אימייל או סיסמה שגויים')
    setBusy(false)
  }

  return (
    <Shell title="סידור עבודה" subtitle="התחברו עם אימייל העבודה">
      <form onSubmit={submit} className="space-y-3">
        <input className={inputCls} type="email" dir="ltr" placeholder="אימייל" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputCls} type="password" dir="ltr" placeholder="סיסמה" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className={btnCls} disabled={busy}>
          {busy ? 'מתחבר…' : 'התחברות'}
        </button>
      </form>
    </Shell>
  )
}

function passwordProblem(p: string): string | null {
  if (p.length < 10) return 'הסיסמה חייבת להכיל לפחות 10 תווים'
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'הסיסמה חייבת להכיל אותיות ומספרים'
  return null
}

export function ChangePassword({ expired, onDone, onLogout }: { expired: boolean; onDone: () => void; onLogout: () => void }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const problem = passwordProblem(p1) ?? (p1 !== p2 ? 'הסיסמאות לא זהות' : null)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) {
      setError(error.message.includes('different') ? 'יש לבחור סיסמה חדשה, שונה מהנוכחית' : 'החלפת הסיסמה נכשלה')
      setBusy(false)
      return
    }
    try {
      await markPasswordChanged()
      onDone()
    } catch {
      setError('החלפת הסיסמה נכשלה, נסו שוב')
    }
    setBusy(false)
  }

  return (
    <Shell
      title="החלפת סיסמה"
      subtitle={expired ? 'עברו 30 יום. יש לבחור סיסמה חדשה.' : 'זו הכניסה הראשונה שלך. יש לבחור סיסמה אישית.'}
    >
      <form onSubmit={submit} className="space-y-3">
        <input className={inputCls} type="password" dir="ltr" placeholder="סיסמה חדשה" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} required />
        <input className={inputCls} type="password" dir="ltr" placeholder="הקלידו שוב" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} required />
        <p className="text-xs text-stone-500">לפחות 10 תווים, עם אותיות ומספרים.</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className={btnCls} disabled={busy}>
          שמירה
        </button>
        <button type="button" onClick={onLogout} className="w-full py-1 text-sm text-stone-500 hover:text-stone-700">
          יציאה
        </button>
      </form>
    </Shell>
  )
}

export function NoAccess({ onLogout }: { onLogout: () => void }) {
  return (
    <Shell title="אין גישה" subtitle="המשתמש הזה לא מחובר לרשימת העובדים או שהוא לא פעיל. פנו לאדמין.">
      <button className={btnCls} onClick={onLogout}>
        יציאה
      </button>
    </Shell>
  )
}

export function Loading() {
  return <div className="grid min-h-screen place-items-center text-stone-400">טוען…</div>
}
