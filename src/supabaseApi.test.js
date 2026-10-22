import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase client: each rpc/from call resolves to whatever `next` holds for that name.
const next = {}, calls = []
const result = name => ({ abortSignal: () => Promise.resolve(next[name] ?? { data: null, error: null }) })
const auth = { getSession: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(async () => ({})) }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name, args) => { calls.push([name, args]); return result(name) },
    from: table => ({ select: () => ({ order: () => ({ order: () => result(`from:${table}`) }) }) }),
    auth,
  }),
}))

let supabaseApi
beforeEach(async () => {
  for (const k of Object.keys(next)) delete next[k]
  calls.length = 0; vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.resetModules(); ({ supabaseApi } = await import('./supabaseApi'))
})
const post = (path, body) => supabaseApi(path, { method: 'POST', body: JSON.stringify(body) })

describe('routes', () => {
  it('maps menu image file names to the site base path and keeps full URLs', async () => {
    next['from:menu'] = { data: [{ id: 1, image: 'noodle-1.jpg' }, { id: 2, image: 'https://cdn.example/x.jpg' }], error: null }
    const menu = await supabaseApi('/api/menu')
    expect(menu[0].image).toBe(`${import.meta.env.BASE_URL}images/noodle-1.jpg`)
    expect(menu[1].image).toBe('https://cdn.example/x.jpg')
  })
  it('sends orders and lookups to the right functions', async () => {
    next.place_order = { data: { id: 'A001' }, error: null }
    expect(await post('/api/orders', { requestId: 'r' })).toEqual({ id: 'A001' })
    expect(calls[0]).toEqual(['place_order', { payload: { requestId: 'r' } }])
    expect(await post('/api/orders/lookup', { references: [] })).toEqual([])
    expect(calls).toHaveLength(1) // nothing to look up → no request
  })
  it('passes status changes and menu toggles through', async () => {
    await supabaseApi('/api/admin/orders/A007/status', { method: 'PATCH', body: JSON.stringify({ status: 'ready', version: 3 }) })
    await supabaseApi('/api/admin/menu/4', { method: 'PATCH', body: JSON.stringify({ available: false }) })
    expect(calls).toEqual([['set_order_status', { p_id: 'A007', p_status: 'ready', p_version: 3 }], ['set_menu_available', { p_id: 4, p_available: false }]])
  })
})

describe('errors', () => {
  it('turns PTxxx errors into HTTP-like statuses with the Thai message', async () => {
    next.place_order = { data: null, error: { code: 'PT409', message: 'ต้มยำหมู หมดชั่วคราว' } }
    await expect(post('/api/orders', {})).rejects.toMatchObject({ status: 409, message: 'ต้มยำหมู หมดชั่วคราว' })
  })
  it('gives network failures no status so the pending order is kept for retry', async () => {
    next.place_order = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
    const error = await post('/api/orders', {}).catch(e => e)
    expect(error.status).toBeUndefined()
    expect(error.message).toContain('เชื่อมต่อร้านไม่ได้')
  })
  it('treats permission errors as logged out', async () => {
    next.staff_orders = { data: null, error: { code: '42501', message: 'permission denied' } }
    await expect(supabaseApi('/api/admin/orders')).rejects.toMatchObject({ status: 401 })
  })
})

describe('staff login', () => {
  it('rejects a wrong password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { status: 400 } })
    await expect(post('/api/admin/login', { username: 'a@b.c', password: 'x' })).rejects.toMatchObject({ status: 401, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
  })
  it('signs out a valid user who is not staff', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    next.am_i_staff = { data: false, error: null }
    await expect(post('/api/admin/login', { username: 'a@b.c', password: 'x' })).rejects.toMatchObject({ status: 403 })
    expect(auth.signOut).toHaveBeenCalled()
  })
  it('logs in staff and reports the session', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null })
    next.am_i_staff = { data: true, error: null }
    expect(await post('/api/admin/login', { username: ' a@b.c ', password: 'x' })).toEqual({ authenticated: true })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'x' })
    auth.getSession.mockResolvedValue({ data: { session: {} } })
    expect(await supabaseApi('/api/admin/session')).toEqual({ authenticated: true, configured: true })
    auth.getSession.mockResolvedValue({ data: { session: null } })
    expect(await supabaseApi('/api/admin/session')).toEqual({ authenticated: false, configured: true })
  })
})
