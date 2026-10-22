import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoApi } from './demoApi'

function memoryStorage() {
  const data = new Map()
  return { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), clear: () => data.clear() }
}
const post = (path, body) => demoApi(path, { method: 'POST', body: JSON.stringify(body) })
const patch = (path, body) => demoApi(path, { method: 'PATCH', body: JSON.stringify(body) })
const customer = { name: 'ทดสอบ', phone: '0812345678', type: 'dine-in', table: '5', note: '' }
const item = { productId: 1, noodle: 'เส้นเล็ก', size: 'ธรรมดา', note: '', quantity: 1 }
let seq = 0
const order = (overrides = {}) => post('/api/orders', { requestId: `req-${++seq}`, accessToken: `tok-${seq}`, customer, items: [item], ...overrides })
const status = (e) => e.status
const login = () => post('/api/admin/login', { username: 'staff', password: 'x' })

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()) })

describe('menu', () => {
  it('seeds six available dishes with base-path images', async () => {
    const menu = await demoApi('/api/menu')
    expect(menu).toHaveLength(6)
    expect(menu.every(p => p.available && p.image.startsWith(import.meta.env.BASE_URL))).toBe(true)
  })
  it('recovers from corrupted storage', async () => {
    localStorage.setItem('noodle-demo-db', '{not json')
    expect(await demoApi('/api/menu')).toHaveLength(6)
  })
})

describe('creating orders', () => {
  it('prices on the "server", adds 10 for พิเศษ and hides secrets', async () => {
    const o = await order({ items: [{ ...item, quantity: 2 }, { ...item, productId: 2, size: 'พิเศษ' }] })
    expect(o).toMatchObject({ id: 'A001', status: 'pending', version: 1, total: 45 * 2 + 65 })
    expect(o.items[1].price).toBe(65)
    expect(o).not.toHaveProperty('accessToken')
    expect(o).not.toHaveProperty('requestId')
  })
  it('is idempotent per requestId (safe retry)', async () => {
    const body = { requestId: 'same', accessToken: 't', customer, items: [item] }
    const a = await post('/api/orders', body), b = await post('/api/orders', body)
    expect(b.id).toBe(a.id)
    await login()
    expect(await demoApi('/api/admin/orders')).toHaveLength(1)
  })
  it('numbers orders sequentially', async () => {
    expect((await order()).id).toBe('A001')
    expect((await order()).id).toBe('A002')
  })
  it.each([
    ['bad phone', { customer: { ...customer, phone: '12345' } }],
    ['missing name', { customer: { ...customer, name: '   ' } }],
    ['dine-in without table', { customer: { ...customer, table: '' } }],
    ['empty items', { items: [] }],
    ['unknown product', { items: [{ ...item, productId: 999 }] }],
    ['bad noodle', { items: [{ ...item, noodle: 'มาม่า' }] }],
    ['bad size', { items: [{ ...item, size: 'ใหญ่มาก' }] }],
    ['quantity 0', { items: [{ ...item, quantity: 0 }] }],
    ['quantity 100', { items: [{ ...item, quantity: 100 }] }],
    ['fractional quantity', { items: [{ ...item, quantity: 1.5 }] }],
    ['missing tokens', { requestId: undefined }],
  ])('rejects %s with 400', async (_, overrides) => {
    await expect(order(overrides)).rejects.toSatisfy(e => status(e) === 400)
  })
  it('takeaway drops the table and trims long text', async () => {
    const o = await order({ customer: { ...customer, type: 'takeaway', table: '9', name: 'ก'.repeat(200) }, items: [{ ...item, note: 'x'.repeat(500) }] })
    expect(o.customer.table).toBe('')
    expect(o.customer.name).toHaveLength(80)
    expect(o.items[0].note).toHaveLength(150)
  })
  it('refuses sold-out dishes with 409', async () => {
    await login(); await patch('/api/admin/menu/1', { available: false })
    await expect(order()).rejects.toSatisfy(e => status(e) === 409)
  })
  it('reports a full storage as an error instead of losing the order silently', async () => {
    await demoApi('/api/menu')
    localStorage.setItem = () => { throw new Error('QuotaExceeded') }
    await expect(order()).rejects.toSatisfy(e => status(e) === 507)
  })
})

describe('order lookup', () => {
  it('returns only orders whose access token matches', async () => {
    const o = await post('/api/orders', { requestId: 'r', accessToken: 'secret', customer, items: [item] })
    expect(await post('/api/orders/lookup', { references: [{ id: o.id, accessToken: 'secret' }] })).toHaveLength(1)
    expect(await post('/api/orders/lookup', { references: [{ id: o.id, accessToken: 'guess' }] })).toHaveLength(0)
    expect(await post('/api/orders/lookup', { references: 'junk' })).toEqual([])
  })
})

describe('admin', () => {
  it('requires login for admin routes', async () => {
    await expect(demoApi('/api/admin/orders')).rejects.toSatisfy(e => status(e) === 401)
    await expect(patch('/api/admin/menu/1', { available: false })).rejects.toSatisfy(e => status(e) === 401)
    expect(await demoApi('/api/admin/session')).toEqual({ authenticated: false, configured: true })
  })
  it('rejects empty credentials and supports logout', async () => {
    await expect(post('/api/admin/login', { username: '', password: '' })).rejects.toSatisfy(e => status(e) === 400)
    await login()
    expect((await demoApi('/api/admin/session')).authenticated).toBe(true)
    await post('/api/admin/logout', {})
    expect((await demoApi('/api/admin/session')).authenticated).toBe(false)
  })
  it('walks an order through every status with optimistic locking', async () => {
    const o = await order(); await login()
    const path = `/api/admin/orders/${o.id}/status`
    let v = 1
    for (const s of ['preparing', 'ready', 'completed']) { const r = await patch(path, { status: s, version: v }); expect(r.status).toBe(s); v = r.version }
    await expect(patch(path, { status: 'cancelled', version: v })).rejects.toSatisfy(e => status(e) === 400)
  })
  it('rejects skipped steps, stale versions, and unknown orders', async () => {
    const o = await order(); await login()
    const path = `/api/admin/orders/${o.id}/status`
    await expect(patch(path, { status: 'completed', version: 1 })).rejects.toSatisfy(e => status(e) === 400)
    await patch(path, { status: 'preparing', version: 1 })
    await expect(patch(path, { status: 'ready', version: 1 })).rejects.toSatisfy(e => status(e) === 409)
    await expect(patch('/api/admin/orders/NOPE/status', { status: 'ready', version: 1 })).rejects.toSatisfy(e => status(e) === 404)
  })
  it('allows cancelling pending and preparing orders only', async () => {
    const a = await order(), b = await order(); await login()
    expect((await patch(`/api/admin/orders/${a.id}/status`, { status: 'cancelled', version: 1 })).status).toBe('cancelled')
    await patch(`/api/admin/orders/${b.id}/status`, { status: 'preparing', version: 1 })
    expect((await patch(`/api/admin/orders/${b.id}/status`, { status: 'cancelled', version: 2 })).status).toBe('cancelled')
  })
  it('toggles menu availability and validates input', async () => {
    await login()
    expect((await patch('/api/admin/menu/2', { available: false })).available).toBe(false)
    expect((await demoApi('/api/menu')).find(p => p.id === 2).available).toBe(false)
    await expect(patch('/api/admin/menu/2', { available: 'no' })).rejects.toSatisfy(e => status(e) === 400)
    await expect(patch('/api/admin/menu/99', { available: true })).rejects.toSatisfy(e => status(e) === 404)
  })
  it('does not leak access tokens to the shop', async () => {
    await order(); await login()
    const [o] = await demoApi('/api/admin/orders')
    expect(o).not.toHaveProperty('accessToken')
  })
})

it('returns 404 for unknown routes and 400 for malformed JSON', async () => {
  await expect(demoApi('/api/nothing')).rejects.toSatisfy(e => status(e) === 404)
  await expect(demoApi('/api/orders', { method: 'POST', body: '{' })).rejects.toSatisfy(e => status(e) === 400)
})
