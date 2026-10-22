import { useState } from 'react'
import { callUsers } from './db.ts'
import type { Employee, Role } from './types.ts'

const ROLE_LABEL: Record<Role, string> = { admin: 'אדמין', main: 'מנהל ראשי', manager: 'מנהל', worker: 'עובד' }

interface Props {
  employees: Employee[]
  reload: () => Promise<void>
}

export default function UsersView({ employees, reload }: Props) {
  const [form, setForm] = useState<{ employeeId?: string; name: string; email: string; role: Role } | null>(null)
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const roles: Role[] = ['worker', 'manager', 'main', 'admin']

  const run = async (fn: () => Promise<{ password: string }>, name: string, email: string) => {
    setBusy(true)
    setError('')
    try {
      const { password } = await fn()
      setSecret({ name, email, password })
      setForm(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה')
    }
    setBusy(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    void run(() => callUsers({ action: 'create', ...form }), form.name, form.email)
  }

  const reset = (e: Employee) => {
    if (!confirm(`לאפס את הסיסמה של ${e.name}?`)) return
    void run(() => callUsers({ action: 'reset', employeeId: e.id }), e.name, e.email ?? '')
  }

  const status = (e: Employee) =>
    !e.userId ? ['אין משתמש', 'bg-stone-100 text-stone-500'] : e.mustChangePassword ? ['ממתין לכניסה ראשונה', 'bg-amber-100 text-amber-800'] : ['פעיל', 'bg-emerald-100 text-emerald-700']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">משתמשים</h1>
        <button
          type="button"
          onClick={() => setForm({ name: '', email: '', role: 'worker' })}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + עובד חדש
        </button>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <ul className="space-y-2">
        {employees.map((e) => {
          const [label, tone] = status(e)
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70">
              <div>
                <div className="font-semibold">
                  {e.name} <span className="text-xs font-normal text-stone-400">{e.role ? ROLE_LABEL[e.role] : ''}</span>
                </div>
                <div className="text-xs text-stone-500" dir="ltr" style={{ textAlign: 'start' }}>
                  {e.email ?? '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>
                {e.userId ? (
                  <button type="button" disabled={busy} onClick={() => reset(e)} className="rounded-lg px-3 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                    איפוס סיסמה
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setForm({ employeeId: e.id, name: e.name, email: '', role: 'worker' })}
                    className="rounded-lg px-3 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
                  >
                    יצירת משתמש
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {form && (
        <Modal onClose={() => setForm(null)} title={form.employeeId ? `משתמש עבור ${form.name}` : 'עובד חדש'}>
          <form onSubmit={submit} className="space-y-3">
            {!form.employeeId && (
              <input className="w-full rounded-xl border border-stone-200 px-3 py-2.5" placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            )}
            <input className="w-full rounded-xl border border-stone-200 px-3 py-2.5" dir="ltr" type="email" placeholder="אימייל עבודה" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <select className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button disabled={busy} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-50">
              יצירה
            </button>
          </form>
        </Modal>
      )}

      {secret && (
        <Modal onClose={() => setSecret(null)} title="סיסמה ראשונית">
          <p className="text-sm text-stone-600">
            מסרו ל-{secret.name} ({secret.email}) את הסיסמה. היא מוצגת פעם אחת בלבד, ובכניסה הראשונה תתבקש סיסמה חדשה.
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-stone-100 px-3 py-3">
            <code className="text-lg font-bold tracking-wide" dir="ltr">
              {secret.password}
            </code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(secret.password)} className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-stone-200">
              העתקה
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 md:items-center" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-xl md:max-w-md md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="grid size-9 place-items-center rounded-full bg-stone-100 text-stone-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
