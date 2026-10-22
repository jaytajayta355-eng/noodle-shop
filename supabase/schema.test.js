// Runs supabase/schema.sql in an in-process Postgres (PGlite) with stand-ins for Supabase's
// auth schema and roles, then checks the rules as the anon / authenticated roles would see them.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const STAFF = '11111111-1111-1111-1111-111111111111', STRANGER = '22222222-2222-2222-2222-222222222222'
let db

async function as(role, sub, sql, params = []) {
  return db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub || ''])
    await tx.exec(`set local role ${role}`)
    return (await tx.query(sql, params)).rows
  })
}
const anon = (sql, params) => as('anon', null, sql, params)
const staff = (sql, params) => as('authenticated', STAFF, sql, params)
const one = async p => Object.values((await p)[0])[0]
const code = p => p.then(() => 'ok', e => e.code)

const customer = { name: 'ทดสอบ', phone: '0812345678', type: 'dine-in', table: '5', note: '' }
const item = { productId: 1, noodle: 'เส้นเล็ก', size: 'ธรรมดา', note: '', quantity: 1 }
let seq = 0
const payload = (o = {}) => ({ requestId: `req-${++seq}`, accessToken: `token-${seq}-abcdefghijklmnop`, customer: { ...customer, phone: `08${String(seq).padStart(8, '0')}` }, items: [item], ...o })
const place = p => one(anon('select public.place_order($1::jsonb)', [JSON.stringify(p)]))

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Supabase grants table access to these roles by default; mimic that so the schema's revokes are tested.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `)
  await db.exec(schema)
  await db.exec(schema) // must be re-runnable
  await db.query(`insert into auth.users values ($1, 'staff@test'), ($2, 'other@test')`, [STAFF, STRANGER])
  await db.query(`insert into public.staff values ($1)`, [STAFF])
})

describe('anonymous customer', () => {
  it('reads the menu', async () => {
    const menu = await anon('select id, price, image, available from public.menu order by sort')
    expect(menu).toHaveLength(6)
    expect(menu[0]).toMatchObject({ id: 1, price: 45, image: 'noodle-1.jpg', available: true })
  })
  it('cannot read or write orders, staff, or the menu directly', async () => {
    expect(await code(anon('select * from public.orders'))).toBe('42501')
    expect(await code(anon('select * from public.staff'))).toBe('42501')
    expect(await code(anon(`insert into public.orders (request_id, token_hash, customer, items, total) values ('x','x','{}','[]',1)`))).toBe('42501')
    expect(await code(anon('update public.menu set price = 1'))).toBe('42501')
  })
  it('cannot call staff functions', async () => {
    expect(await code(anon('select public.staff_orders()'))).toBe('42501')
    expect(await code(anon(`select public.set_order_status('A001', 'ready', 1)`))).toBe('42501')
    expect(await code(anon('select public.set_menu_available(1, false)'))).toBe('42501')
  })
  it('places an order priced by the database, without leaking secrets', async () => {
    const o = await place(payload({ items: [{ ...item, quantity: 2 }, { ...item, productId: 2, size: 'พิเศษ', price: 1 }] }))
    expect(o).toMatchObject({ id: 'A001', status: 'pending', version: 1, total: 45 * 2 + 65 })
    expect(o.items[1].price).toBe(65)
    expect(o).not.toHaveProperty('token_hash')
    expect(o).not.toHaveProperty('request_id')
  })
  it('is idempotent per requestId, but not with a different token', async () => {
    const p = payload()
    const a = await place(p), b = await place(p)
    expect(b.id).toBe(a.id)
    expect(await code(place({ ...p, accessToken: 'someone-else-token-xyz' }))).toBe('PT409')
    expect(await one(staff('select jsonb_array_length(public.staff_orders())'))).toBe(1)
  })
  it.each([
    ['bad phone', { customer: { ...customer, phone: '12345' } }],
    ['missing name', { customer: { ...customer, name: ' ' } }],
    ['dine-in without table', { customer: { ...customer, table: '' } }],
    ['no items', { items: [] }],
    ['items not an array', { items: 'x' }],
    ['unknown product', { items: [{ ...item, productId: 999 }] }],
    ['non-numeric product', { items: [{ ...item, productId: '1; drop table' }] }],
    ['bad noodle', { items: [{ ...item, noodle: 'มาม่า' }] }],
    ['bad size', { items: [{ ...item, size: 'XL' }] }],
    ['quantity 0', { items: [{ ...item, quantity: 0 }] }],
    ['quantity 100', { items: [{ ...item, quantity: 100 }] }],
    ['fractional quantity', { items: [{ ...item, quantity: 1.5 }] }],
    ['quantity as string', { items: [{ ...item, quantity: '2' }] }],
    ['short token', { accessToken: 'abc' }],
  ])('rejects %s with PT400', async (_, o) => {
    const p = payload(o)
    if (o.customer) p.customer = o.customer
    expect(await code(place(p))).toBe('PT400')
  })
  it('refuses sold-out dishes with PT409', async () => {
    await staff('select public.set_menu_available(3, false)')
    expect(await code(place(payload({ items: [{ ...item, productId: 3 }] })))).toBe('PT409')
  })
  it('takeaway clears the table and long text is trimmed', async () => {
    const p = payload({ items: [{ ...item, note: 'x'.repeat(500) }] })
    p.customer = { ...p.customer, type: 'takeaway', table: '9', name: 'ก'.repeat(200) }
    const o = await place(p)
    expect(o.customer.table).toBe('')
    expect(o.customer.name).toHaveLength(80)
    expect(o.items[0].note).toHaveLength(150)
  })
  it('limits each phone to 5 orders per 10 minutes', async () => {
    const phone = { ...customer, phone: '0899999999' }
    for (let i = 0; i < 5; i++) await place({ ...payload(), customer: phone })
    expect(await code(place({ ...payload(), customer: phone }))).toBe('PT429')
  })
  it('looks up only orders whose token matches', async () => {
    const p = payload(), o = await place(p)
    expect(await one(anon('select public.lookup_orders($1::jsonb)', [JSON.stringify([{ id: o.id, accessToken: p.accessToken }])]))).toHaveLength(1)
    expect(await one(anon('select public.lookup_orders($1::jsonb)', [JSON.stringify([{ id: o.id, accessToken: 'guess' }])]))).toHaveLength(0)
    expect(await one(anon('select public.lookup_orders($1::jsonb)', ['"junk"']))).toEqual([])
  })
})

describe('staff', () => {
  it('a logged-in non-staff user is refused', async () => {
    expect(await one(as('authenticated', STRANGER, 'select public.am_i_staff()'))).toBe(false)
    expect(await code(as('authenticated', STRANGER, 'select public.staff_orders()'))).toBe('PT401')
    expect(await code(as('authenticated', STRANGER, 'select public.set_menu_available(1, false)'))).toBe('PT401')
  })
  it('walks an order through every status with version checks', async () => {
    const o = await place(payload())
    expect(await one(staff('select public.am_i_staff()'))).toBe(true)
    let v = 1
    for (const s of ['preparing', 'ready', 'completed']) {
      const r = await one(staff('select public.set_order_status($1, $2, $3)', [o.id, s, v]))
      expect(r.status).toBe(s); v = r.version
    }
    expect(await code(staff('select public.set_order_status($1, $2, $3)', [o.id, 'cancelled', v]))).toBe('PT400')
  })
  it('rejects skipped steps, stale versions and unknown orders', async () => {
    const o = await place(payload())
    expect(await code(staff('select public.set_order_status($1, $2, $3)', [o.id, 'completed', 1]))).toBe('PT400')
    await staff('select public.set_order_status($1, $2, $3)', [o.id, 'preparing', 1])
    expect(await code(staff('select public.set_order_status($1, $2, $3)', [o.id, 'ready', 1]))).toBe('PT409')
    expect(await code(staff(`select public.set_order_status('NOPE', 'ready', 1)`))).toBe('PT404')
  })
  it('can cancel pending and preparing orders', async () => {
    const a = await place(payload()), b = await place(payload())
    expect((await one(staff('select public.set_order_status($1, $2, 1)', [a.id, 'cancelled']))).status).toBe('cancelled')
    await staff('select public.set_order_status($1, $2, 1)', [b.id, 'preparing'])
    expect((await one(staff('select public.set_order_status($1, $2, 2)', [b.id, 'cancelled']))).status).toBe('cancelled')
  })
  it('toggles menu availability', async () => {
    expect((await one(staff('select public.set_menu_available(2, false)'))).available).toBe(false)
    expect((await anon('select available from public.menu where id = 2'))[0].available).toBe(false)
    expect(await code(staff('select public.set_menu_available(99, true)'))).toBe('PT404')
  })
  it('still cannot read the orders table directly (only via staff_orders)', async () => {
    expect(await code(staff('select * from public.orders'))).toBe('42501')
  })
})
