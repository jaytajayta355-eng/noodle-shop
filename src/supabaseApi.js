// Maps the app's /api/* routes onto Supabase (see supabase/schema.sql), so App and Admin stay backend-agnostic.
import { createClient } from '@supabase/supabase-js'

const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { storageKey: 'noodle-staff-auth' } })

function fail(status, message) { const error = new Error(message); if (status) error.status = status; throw error }
// The schema raises SQLSTATE 'PTxxx' for expected errors; anything else is a connection/server problem.
// Unknown failures get no status, so the customer app keeps the pending order for a safe retry.
function unwrap({ data, error }) {
  if (!error) return data
  const known = /^PT(\d{3})$/.exec(error.code || '')
  if (known) fail(Number(known[1]), error.message)
  if (error.code === '42501' || error.status === 401) fail(401, 'กรุณาเข้าสู่ระบบใหม่')
  fail(undefined, 'เชื่อมต่อร้านไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง')
}
const imageUrl = image => /^https?:\/\//.test(image) ? image : `${import.meta.env.BASE_URL}images/${image}`
// supabase-js has no request timeout of its own; match api()'s 15 s so the UI never hangs on "sending".
const rpc = (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(15000))
const isStaff = async () => Boolean(unwrap(await rpc('am_i_staff')))

export async function supabaseApi(path, options = {}) {
  const method = options.method || 'GET'
  const body = options.body ? JSON.parse(options.body) : null
  if (method === 'GET' && path === '/api/menu') {
    const menu = unwrap(await client.from('menu').select('id, name, description, price, image, available').order('sort').order('id').abortSignal(AbortSignal.timeout(15000)))
    return menu.map(p => ({ ...p, image: imageUrl(p.image) }))
  }
  if (method === 'POST' && path === '/api/orders') return unwrap(await rpc('place_order', { payload: body }))
  if (method === 'POST' && path === '/api/orders/lookup') {
    const refs = Array.isArray(body?.references) ? body.references : []
    return refs.length ? unwrap(await rpc('lookup_orders', { refs })) : []
  }
  if (method === 'GET' && path === '/api/admin/session') {
    const { data } = await client.auth.getSession()
    return { authenticated: Boolean(data.session) && await isStaff(), configured: true }
  }
  if (method === 'POST' && path === '/api/admin/login') {
    const { error } = await client.auth.signInWithPassword({ email: String(body?.username || '').trim(), password: String(body?.password || '') })
    if (error) fail(error.status === 400 ? 401 : error.status, error.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่ได้ กรุณาลองใหม่')
    if (!await isStaff()) { await client.auth.signOut(); fail(403, 'บัญชีนี้ยังไม่ได้รับสิทธิ์พนักงานร้าน') }
    return { authenticated: true }
  }
  if (method === 'POST' && path === '/api/admin/logout') { await client.auth.signOut(); return { authenticated: false } }
  if (method === 'GET' && path === '/api/admin/orders') return unwrap(await rpc('staff_orders'))
  let match = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/)
  if (method === 'PATCH' && match) return unwrap(await rpc('set_order_status', { p_id: decodeURIComponent(match[1]), p_status: body?.status, p_version: body?.version }))
  match = path.match(/^\/api\/admin\/menu\/(\d+)$/)
  if (method === 'PATCH' && match) return unwrap(await rpc('set_menu_available', { p_id: Number(match[1]), p_available: body?.available }))
  fail(404, 'ไม่พบ API นี้')
}
