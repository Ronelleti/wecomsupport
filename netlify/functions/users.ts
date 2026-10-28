// Server-side only: uses the service-role key, which must never reach the browser.
// Env vars (set in Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomInt } from 'node:crypto'

const ROLES = ['admin', 'main', 'manager', 'worker']
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const newPassword = () => Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return json(500, { error: 'השרת לא מוגדר (חסרים משתני סביבה)' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Who is calling?
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) return json(401, { error: 'לא מחובר' })
  const { data: userData } = await admin.auth.getUser(token)
  if (!userData.user) return json(401, { error: 'לא מחובר' })
  const { data: caller } = await admin
    .from('employees')
    .select('id, role, active, must_change_password, password_changed_at')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  const fresh =
    caller &&
    !caller.must_change_password &&
    caller.password_changed_at &&
    Date.now() - new Date(caller.password_changed_at).getTime() < 30 * 864e5
  if (!caller?.active || !fresh || !['admin', 'main'].includes(caller.role)) return json(403, { error: 'אין הרשאה' })

  const body = await req.json().catch(() => null)
  if (!body) return json(400, { error: 'בקשה לא תקינה' })
  // Admin and main manager have the same user-management powers.

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const role = String(body.role ?? 'worker')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'כתובת אימייל לא תקינה' })
    if (!ROLES.includes(role)) return json(400, { error: 'תפקיד לא תקין' })

    let employeeId: string | undefined = body.employeeId
    if (employeeId) {
      const { data: existing } = await admin.from('employees').select('user_id').eq('id', employeeId).maybeSingle()
      if (!existing) return json(404, { error: 'העובד לא נמצא' })
      if (existing.user_id) return json(409, { error: 'לעובד כבר יש משתמש' })
    } else {
      const name = String(body.name ?? '').trim()
      if (!name) return json(400, { error: 'חסר שם' })
      employeeId = `e_${randomBytes(5).toString('hex')}`
      const departmentId = typeof body.departmentId === 'string' && body.departmentId ? body.departmentId : null
      const { error } = await admin.from('employees').insert({ id: employeeId, name, email, department_id: departmentId })
      if (error) return json(400, { error: error.message })
    }

    const password = newPassword()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) return json(400, { error: createErr?.message ?? 'יצירת המשתמש נכשלה' })

    const { error } = await admin
      .from('employees')
      .update({ user_id: created.user.id, email, role, must_change_password: true, password_changed_at: null })
      .eq('id', employeeId)
    if (error) return json(400, { error: error.message })
    return json(200, { password, employeeId })
  }

  if (body.action === 'reset') {
    const { data: target } = await admin.from('employees').select('user_id').eq('id', body.employeeId).maybeSingle()
    if (!target?.user_id) return json(404, { error: 'למשתמש אין התחברות' })
    const password = newPassword()
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password })
    if (error) return json(400, { error: error.message })
    await admin
      .from('employees')
      .update({ must_change_password: true, password_changed_at: null })
      .eq('id', body.employeeId)
    return json(200, { password, employeeId: body.employeeId })
  }

  if (body.action === 'delete') {
    // Removes the person completely: login, shifts, preferences, vacations, swaps, notifications and attendance marks.
    const employeeId = String(body.employeeId ?? '')
    if (!employeeId) return json(400, { error: 'חסר עובד' })
    if (employeeId === caller.id) return json(400, { error: 'אי אפשר למחוק את המשתמש שלך' })
    const { data: target } = await admin.from('employees').select('id, role, user_id').eq('id', employeeId).maybeSingle()
    if (!target) return json(404, { error: 'העובד לא נמצא' })

    if (target.role === 'admin') {
      const { count } = await admin.from('employees').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true)
      if ((count ?? 0) <= 1) return json(400, { error: 'אי אפשר למחוק את האדמין האחרון' })
    }

    // Records this person approved or marked stay, with the approver cleared.
    await Promise.all([
      admin.from('attendance').update({ marked_by: null }).eq('marked_by', employeeId),
      admin.from('swaps').update({ decided_by: null }).eq('decided_by', employeeId),
      admin.from('time_off').update({ decided_by: null }).eq('decided_by', employeeId),
    ])
    const { error } = await admin.from('employees').delete().eq('id', employeeId)
    if (error) return json(400, { error: error.message })
    if (target.user_id) {
      const { error: authErr } = await admin.auth.admin.deleteUser(target.user_id)
      if (authErr) return json(500, { error: `העובד נמחק, אבל מחיקת ההתחברות נכשלה: ${authErr.message}` })
    }
    return json(200, { deleted: employeeId })
  }

  return json(400, { error: 'פעולה לא מוכרת' })
}
