// Demo backend for static hosting (GitHub Pages): data lives in this browser's localStorage only.
const DB_KEY = 'noodle-demo-db', ADMIN_KEY = 'noodle-demo-admin'
const image = n => `${import.meta.env.BASE_URL}images/noodle-${n}.jpg`
const seedMenu = () => [
  { id: 1, name: 'ก๋วยเตี๋ยวหมูน้ำใส', description: 'น้ำซุปกระดูกหมูเคี่ยวนาน หมูสับ หมูชิ้น ลูกชิ้น', price: 45, image: image(1), available: true },
  { id: 2, name: 'ต้มยำหมู', description: 'ต้มยำรสจัดจ้าน ถั่วลิสงคั่ว มะนาวสด', price: 55, image: image(2), available: true },
  { id: 3, name: 'เย็นตาโฟ', description: 'น้ำแดงหอมเต้าหู้ยี้ ลูกชิ้นปลา เกี๊ยวทอด', price: 50, image: image(3), available: true },
  { id: 4, name: 'ก๋วยเตี๋ยวเรือ', description: 'น้ำตกเข้มข้น หมูตุ๋น กากหมูกรอบ', price: 50, image: image(4), available: true },
  { id: 5, name: 'บะหมี่เกี๊ยวหมูแดง', description: 'บะหมี่เส้นสด เกี๊ยวกุ้ง หมูแดงย่าง', price: 60, image: image(5), available: true },
  { id: 6, name: 'เกาเหลาเนื้อตุ๋น', description: 'เนื้อตุ๋นนุ่ม น้ำซุปเครื่องเทศ', price: 65, image: image(6), available: true },
]
const noodles = ['เส้นเล็ก', 'เส้นใหญ่', 'เส้นหมี่', 'บะหมี่', 'วุ้นเส้น', 'เกาเหลา']
const sizes = { 'ธรรมดา': 0, 'พิเศษ': 10 }
const next = { pending: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['completed'] }

function fail(status, message) { const error = new Error(message); error.status = status; throw error }
function load() {
  try {
    const db = JSON.parse(localStorage.getItem(DB_KEY))
    // Image URLs depend on the deploy base path, so rebuild them instead of trusting stored ones.
    if (db && Array.isArray(db.menu) && Array.isArray(db.orders)) { db.menu.forEach(p => { p.image = image(p.id) }); return db }
  } catch { /* Fall through to a fresh database. */ }
  return { menu: seedMenu(), orders: [], counter: 0 }
}
function save(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)) } catch { fail(507, 'บันทึกข้อมูลในเบราว์เซอร์ไม่ได้') }
}
const isAdmin = () => { try { return localStorage.getItem(ADMIN_KEY) === '1' } catch { return false } }
const publicOrder = order => Object.fromEntries(Object.entries(order).filter(([key]) => key !== 'requestId' && key !== 'accessToken'))
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function createOrder(db, body) {
  if (typeof body?.requestId !== 'string' || typeof body.accessToken !== 'string') fail(400, 'ข้อมูลออเดอร์ไม่ถูกต้อง')
  const existing = db.orders.find(o => o.requestId === body.requestId)
  if (existing) return publicOrder(existing)
  const c = body.customer || {}
  const customer = { name: text(c.name, 80), phone: text(c.phone, 10), type: c.type === 'takeaway' ? 'takeaway' : 'dine-in', table: text(c.table, 20), note: text(c.note, 300) }
  if (!customer.name || !/^0[0-9]{8,9}$/.test(customer.phone) || (customer.type === 'dine-in' && !customer.table)) fail(400, 'กรุณากรอกชื่อ เบอร์โทร และหมายเลขโต๊ะให้ถูกต้อง')
  if (customer.type === 'takeaway') customer.table = ''
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) fail(400, 'ไม่มีรายการอาหารในออเดอร์')
  const items = body.items.map(item => {
    const product = db.menu.find(p => p.id === item?.productId)
    if (!product) fail(400, 'ไม่พบเมนูที่สั่ง')
    if (!product.available) fail(409, `${product.name} หมดชั่วคราว กรุณาเลือกเมนูอื่น`)
    if (!noodles.includes(item.noodle) || !(item.size in sizes) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) fail(400, 'ตัวเลือกเมนูไม่ถูกต้อง')
    return { productId: product.id, name: product.name, noodle: item.noodle, size: item.size, note: text(item.note, 150), quantity: item.quantity, price: product.price + sizes[item.size] }
  })
  db.counter += 1
  const order = { id: `A${String(db.counter).padStart(3, '0')}`, requestId: body.requestId, accessToken: body.accessToken, customer, items, total: items.reduce((sum, i) => sum + i.price * i.quantity, 0), status: 'pending', version: 1, createdAt: new Date().toISOString() }
  db.orders.unshift(order)
  save(db)
  return publicOrder(order)
}

export async function demoApi(path, options = {}) {
  const method = options.method || 'GET'
  let body = null
  try { body = options.body ? JSON.parse(options.body) : null } catch { fail(400, 'ข้อมูลไม่ถูกต้อง') }
  const db = load()
  if (method === 'GET' && path === '/api/menu') return db.menu
  if (method === 'POST' && path === '/api/orders') return createOrder(db, body)
  if (method === 'POST' && path === '/api/orders/lookup') {
    const refs = Array.isArray(body?.references) ? body.references : []
    return db.orders.filter(o => refs.some(r => r?.id === o.id && r.accessToken === o.accessToken)).map(publicOrder)
  }
  if (method === 'GET' && path === '/api/admin/session') return { authenticated: isAdmin(), configured: true }
  if (method === 'POST' && path === '/api/admin/login') {
    if (!text(body?.username, 100) || !body?.password) fail(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
    try { localStorage.setItem(ADMIN_KEY, '1') } catch { fail(507, 'บันทึกข้อมูลในเบราว์เซอร์ไม่ได้') }
    return { authenticated: true }
  }
  if (method === 'POST' && path === '/api/admin/logout') { try { localStorage.removeItem(ADMIN_KEY) } catch { /* Already effectively logged out. */ } return { authenticated: false } }
  if (path.startsWith('/api/admin/') && !isAdmin()) fail(401, 'กรุณาเข้าสู่ระบบใหม่')
  if (method === 'GET' && path === '/api/admin/orders') return db.orders.map(publicOrder)
  let match = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/)
  if (method === 'PATCH' && match) {
    const order = db.orders.find(o => o.id === match[1])
    if (!order) fail(404, 'ไม่พบออเดอร์')
    if (order.version !== body?.version) fail(409, 'ออเดอร์ถูกแก้ไขไปแล้ว กรุณาลองใหม่')
    if (!next[order.status]?.includes(body.status)) fail(400, 'เปลี่ยนสถานะนี้ไม่ได้')
    order.status = body.status; order.version += 1
    save(db)
    return publicOrder(order)
  }
  match = path.match(/^\/api\/admin\/menu\/(\d+)$/)
  if (method === 'PATCH' && match) {
    const product = db.menu.find(p => p.id === Number(match[1]))
    if (!product) fail(404, 'ไม่พบเมนู')
    if (typeof body?.available !== 'boolean') fail(400, 'ข้อมูลไม่ถูกต้อง')
    product.available = body.available
    save(db)
    return product
  }
  fail(404, 'ไม่พบ API นี้')
}
