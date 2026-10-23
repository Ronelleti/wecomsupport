// Sends phone / browser push notifications.
//  1) Supabase Database Webhook (INSERT on notifications) -> header x-webhook-secret must match PUSH_WEBHOOK_SECRET.
//  2) A logged-in user can POST { test: true } with their access token to get a test push on their own devices.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json(500, { error: 'ההתראות לא מוגדרות בשרת' })
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT || 'https://example.com', VAPID_PUBLIC_KEY.trim(), VAPID_PRIVATE_KEY.trim())
  } catch {
    return json(500, { error: 'מפתחות ההתראות בשרת לא תקינים. בדקו VAPID_PUBLIC_KEY ו-VAPID_PRIVATE_KEY ב-Netlify.' })
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const body = await req.json().catch(() => null)
  if (!body) return json(400, { error: 'בקשה לא תקינה' })

  let employeeId: string
  let payload: { title: string; body: string; link: string; tag?: string }

  const secret = req.headers.get('x-webhook-secret')
  if (secret) {
    // Called by the database when a notification row is created.
    if (!PUSH_WEBHOOK_SECRET || !sameSecret(secret, PUSH_WEBHOOK_SECRET)) return json(401, { error: 'לא מורשה' })
    const rec = body.record
    if (body.type !== 'INSERT' || !rec?.employee_id) return json(200, { ignored: true })
    employeeId = String(rec.employee_id)
    payload = { title: String(rec.title ?? 'סידור עבודה'), body: String(rec.body ?? ''), link: String(rec.link ?? ''), tag: String(rec.id ?? '') }
  } else if (body.test) {
    // A logged-in person testing their own device.
    const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
    if (!token) return json(401, { error: 'לא מחובר' })
    const { data: userData } = await admin.auth.getUser(token)
    if (!userData.user) return json(401, { error: 'לא מחובר' })
    const { data: emp } = await admin.from('employees').select('id, active').eq('user_id', userData.user.id).maybeSingle()
    if (!emp?.active) return json(403, { error: 'אין הרשאה' })
    employeeId = emp.id
    payload = { title: 'בדיקת התראות', body: 'ההתראות עובדות במכשיר הזה ✓', link: '', tag: 'test' }
  } else {
    return json(401, { error: 'לא מורשה' })
  }

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('employee_id', employeeId)
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    (subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 })
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(s.id) // the device unsubscribed
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  return json(200, { sent })
}
