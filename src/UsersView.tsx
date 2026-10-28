import { useState } from 'react'
import { api, callUsers } from './db.ts'
import { useApp } from './store.ts'
import type { Employee, Role } from './types.ts'

const ROLE_LABEL: Record<Role, string> = { admin: 'אדמין', main: 'מנהל ראשי', manager: 'מנהל', worker: 'עובד' }

interface Props {
  employees: Employee[]
  reload: () => Promise<void>
}

interface EditForm {
  id: string
  name: string
  target: number
  departmentId: string
  schedulable: boolean
  active: boolean
  role: Role
  isNew: boolean
}

export default function UsersView({ employees, reload }: Props) {
  const app = useApp()
  const [edit, setEdit] = useState<EditForm | null>(null)
  const [form, setForm] = useState<{ employeeId?: string; name: string; email: string; role: Role; departmentId: string } | null>(null)
  const departments = app.departments.filter((d) => d.active)
  const firstDept = departments[0]?.id ?? ''
  const deptName = (id?: string | null) => app.departments.find((d) => d.id === id)?.name
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

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!edit || !edit.name.trim()) return
    const res = await app.run(
      () => api.saveEmployee({ ...edit, name: edit.name.trim() }),
      edit.isNew ? 'העובד נוסף' : 'נשמר',
    )
    if (res.ok) setEdit(null)
  }

  const status = (e: Employee) =>
    e.active === false ? ['לא פעיל', 'bg-stone-200 text-stone-600'] : !e.userId ? ['אין משתמש', 'bg-stone-100 text-stone-500'] : e.mustChangePassword ? ['ממתין לכניסה ראשונה', 'bg-amber-100 text-amber-800'] : ['פעיל', 'bg-emerald-100 text-emerald-700']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">משתמשים</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEdit({ id: `e_${crypto.randomUUID().slice(0, 8)}`, name: '', target: 5, departmentId: firstDept, schedulable: true, active: true, role: 'worker', isNew: true })}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-soft ring-1 ring-brand-200 hover:bg-brand-50"
          >
            + עובד ללא משתמש
          </button>
          <button
            type="button"
            onClick={() => setForm({ name: '', email: '', role: 'worker', departmentId: firstDept })}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + עובד עם משתמש
          </button>
        </div>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <ul className="space-y-2">
        {employees.map((e) => {
          const [label, tone] = status(e)
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70">
              <div>
                <div className="font-semibold">
                  {e.name} <span className="text-xs font-normal text-stone-400">{[e.role ? ROLE_LABEL[e.role] : '', deptName(e.departmentId) ?? ''].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="text-xs text-stone-500" dir="ltr" style={{ textAlign: 'start' }}>
                  {e.email ?? '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>
                <button
                  type="button"
                  onClick={() =>
                    setEdit({ id: e.id, name: e.name, target: e.target, departmentId: e.departmentId ?? firstDept, schedulable: e.schedulable !== false, active: e.active !== false, role: e.role ?? 'worker', isNew: false })
                  }
                  className="rounded-lg px-3 py-1.5 text-sm text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
                >
                  עריכה
                </button>
                {e.userId ? (
                  <button type="button" disabled={busy} onClick={() => reset(e)} className="rounded-lg px-3 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                    איפוס סיסמה
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setForm({ employeeId: e.id, name: e.name, email: '', role: 'worker', departmentId: e.departmentId ?? firstDept })}
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

      {edit && (
        <Modal onClose={() => setEdit(null)} title={edit.isNew ? 'עובד חדש' : `עריכת ${edit.name}`}>
          <form onSubmit={(e) => void saveEdit(e)} className="space-y-3">
            <label className="block text-sm text-stone-600">
              שם
              <input className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </label>
            <label className="block text-sm text-stone-600">
              יעד משמרות בשבוע
              <input type="number" min={0} max={7} className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5" value={edit.target} onChange={(e) => setEdit({ ...edit, target: Number(e.target.value) })} />
            </label>
            <label className="block text-sm text-stone-600">
              מחלקה
              <select
                className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                value={edit.departmentId}
                onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}
              >
                {app.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-stone-600">
              תפקיד
              <select
                className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                value={edit.role}
                disabled={edit.id === app.me?.id}
                onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.schedulable} onChange={(e) => setEdit({ ...edit, schedulable: e.target.checked })} />
              משובץ במשמרות
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active} disabled={edit.id === app.me?.id} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
              פעיל (עובד לא פעיל לא משובץ ולא יכול להיכנס)
            </label>
            <button className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white">שמירה</button>
          </form>
        </Modal>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} title={form.employeeId ? `משתמש עבור ${form.name}` : 'עובד חדש'}>
          <form onSubmit={submit} className="space-y-3">
            {!form.employeeId && (
              <input className="w-full rounded-xl border border-stone-200 px-3 py-2.5" placeholder="שם" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            )}
            <input className="w-full rounded-xl border border-stone-200 px-3 py-2.5" dir="ltr" type="email" placeholder="אימייל עבודה" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            {!form.employeeId && (
              <select className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
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
