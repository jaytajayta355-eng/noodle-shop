import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the real-server code path, which demo mode normally bypasses.
let mod
beforeEach(async () => { vi.stubEnv('VITE_DEMO', 'false'); vi.resetModules(); mod = await import('./api') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const respond = (status, body) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))

describe('api()', () => {
  it('uses the network when VITE_DEMO=false', () => { expect(mod.demoMode).toBe(false) })
  it('parses JSON and sends a JSON content type with a body', async () => {
    respond(200, '{"ok":true}')
    expect(await mod.api('/x', { method: 'POST', body: '{}' })).toEqual({ ok: true })
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
  })
  it('returns null for an empty successful body (204)', async () => {
    respond(204, null)
    expect(await mod.api('/x')).toBeNull()
  })
  it('surfaces the server error message and status', async () => {
    respond(409, '{"error":"ซ้ำ"}')
    await expect(mod.api('/x')).rejects.toMatchObject({ message: 'ซ้ำ', status: 409 })
  })
  it('keeps the status when an error body is not JSON', async () => {
    respond(502, '<html>Bad gateway</html>')
    await expect(mod.api('/x')).rejects.toMatchObject({ status: 502 })
  })
  it('rejects a successful but non-JSON body', async () => {
    respond(200, '<!doctype html>')
    await expect(mod.api('/x')).rejects.toThrow('ระบบตอบกลับไม่ถูกต้อง')
  })
  it('reports network failures in Thai', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(mod.api('/x')).rejects.toThrow('เชื่อมต่อร้านไม่ได้')
  })
  it('apiList and apiOrder reject malformed shapes', async () => {
    respond(200, '{"a":1}')
    await expect(mod.apiList('/x')).rejects.toThrow('ระบบตอบกลับไม่ถูกต้อง')
    respond(200, '{"id":5}')
    await expect(mod.apiOrder('/x')).rejects.toThrow('ระบบตอบกลับไม่ถูกต้อง')
  })
})

describe('helpers', () => {
  it('money formats baht and tolerates bad values', () => {
    expect(mod.money(45)).toBe('฿45.00')
    expect(mod.money(undefined)).toBe('—')
    expect(mod.money(NaN)).toBe('—')
  })
  it('randomToken is 64 hex chars and unique', () => {
    const a = mod.randomToken(), b = mod.randomToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
  it('loadJSON falls back on bad or missing data', () => {
    const store = { x: '{bad', y: '[1]' }
    vi.stubGlobal('localStorage', { getItem: k => store[k] ?? null })
    expect(mod.loadJSON('x', 'fb')).toBe('fb')
    expect(mod.loadJSON('missing', 'fb')).toBe('fb')
    expect(mod.loadJSON('y', 'fb')).toEqual([1])
  })
})
