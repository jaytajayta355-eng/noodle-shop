import { demoApi } from './demoApi'
// Supabase when it is configured; otherwise the in-browser demo store, unless VITE_DEMO=false selects a same-origin server.
export const backend = import.meta.env.VITE_SUPABASE_URL ? 'supabase' : import.meta.env.VITE_DEMO === 'false' ? 'server' : 'demo'
export const demoMode = backend === 'demo'
export async function api(path, options = {}) {
  if (demoMode) return demoApi(path, options)
  // Loaded on demand so demo builds don't ship the Supabase client.
  if (backend === 'supabase') return (await import('./supabaseApi')).supabaseApi(path, options)
  let response
  try {
    response = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
  } catch { throw new Error('เชื่อมต่อร้านไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง') }
  let data = null
  try { const text = await response.text(); data = text ? JSON.parse(text) : null }
  catch { if (response.ok) throw new Error(invalidResponse) }
  if (!response.ok) { const error = new Error(data?.error || 'เชื่อมต่อระบบไม่ได้'); error.status = response.status; throw error }
  return data
}
const invalidResponse = 'ระบบตอบกลับไม่ถูกต้อง กรุณาเปิดเซิร์ฟเวอร์แล้วลองอีกครั้ง'
export async function apiList(path, options) {
  const data = await api(path, options)
  if (!Array.isArray(data)) throw new Error(invalidResponse)
  return data
}
export async function apiOrder(path, options) {
  const data = await api(path, options)
  if (typeof data?.id !== 'string' || !Array.isArray(data.items) || !data.customer) throw new Error(invalidResponse)
  return data
}
export const money = value => Number.isFinite(value) ? value.toLocaleString('th-TH', { style: 'currency', currency: 'THB' }) : '—'
export const statusLabels = { pending: 'รอร้านรับออเดอร์', preparing: 'กำลังทำอาหาร', ready: 'พร้อมเสิร์ฟ / รับอาหาร', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' }
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
}
export function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
