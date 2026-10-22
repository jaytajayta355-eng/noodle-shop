import { useEffect, useState } from 'react'
import { api, apiList, demoMode, money, statusLabels } from './api'
const nextStatus = { pending: 'preparing', preparing: 'ready', ready: 'completed' }
const actions = { pending: 'รับออเดอร์ / เริ่มทำ', preparing: 'อาหารพร้อมแล้ว', ready: 'ส่งมอบ / เสร็จสิ้น' }
export default function Admin() {
  const [auth, setAuth] = useState(null)
  const [configured, setConfigured] = useState(true)
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [orders, setOrders] = useState([])
  const [menu, setMenu] = useState([])
  const [filter, setFilter] = useState('active')
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [busy, setBusy] = useState(false)
  const [updated, setUpdated] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    api('/api/admin/session').then(data => { if (active) { setAuth(Boolean(data?.authenticated)); setConfigured(data?.configured !== false) } }).catch(e => { if (active) { setError(e.message); setAuth(false) } })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!auth) return
    let active = true, inFlight = false
    async function load() {
      if (inFlight) return
      inFlight = true
      try {
        const [incoming, products] = await Promise.all([apiList('/api/admin/orders'), apiList('/api/menu')])
        if (active) { setOrders(incoming); setMenu(products); setSyncError(''); setUpdated(new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })) }
      } catch (e) { if (active) { setSyncError(e.message); if (e.status === 401) setAuth(false) } }
      finally { inFlight = false }
    }
    load(); const timer = setInterval(load, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [auth, refresh])
  async function login(event) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify(credentials) }); setAuth(true); setCredentials({ username: '', password: '' }) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function logout() {
    setBusy(true)
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); setAuth(false); setOrders([]) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function mutate(path, data) {
    if (busy) return
    setBusy(true); setError('')
    try { await api(path, { method: 'PATCH', body: JSON.stringify(data) }); setRefresh(v => v + 1) }
    catch (e) { setError(e.message); if (e.status === 401) setAuth(false); setRefresh(v => v + 1) }
    finally { setBusy(false) }
  }
  const visible = orders.filter(o => filter === 'all' || (filter === 'active' ? !['completed', 'cancelled'].includes(o.status) : o.status === filter))
  return <><nav className="top-nav"><a href={import.meta.env.BASE_URL}>← หน้าลูกค้า</a><strong>เตี๋ยวอิ่มใจ · ร้านค้า</strong>{auth && <button disabled={busy} onClick={logout}>ออกจากระบบ</button>}</nav><main className="container admin">
    {auth === null ? <p role="status">กำลังตรวจสอบการเข้าสู่ระบบ…</p> : !auth ? <form className="login-panel" onSubmit={login}><p className="eyebrow">STAFF ONLY</p><h1>เข้าสู่ระบบร้านค้า</h1>{demoMode && <p className="payment-note">โหมดเดโม: ใส่ชื่อผู้ใช้และรหัสผ่านอะไรก็ได้</p>}{!configured && <p className="error">ยังไม่ได้ตั้งค่าบัญชีผู้ดูแลบนเซิร์ฟเวอร์ กรุณาติดต่อผู้ดูแลระบบ</p>}<label>ชื่อผู้ใช้<input required autoComplete="username" value={credentials.username} onChange={e => setCredentials({ ...credentials, username: e.target.value })} /></label><label>รหัสผ่าน<input required type="password" autoComplete="current-password" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} /></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy || !configured}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button></form> : <>
      <div className="section-heading"><div><p className="eyebrow">KITCHEN DASHBOARD</p><h1>ออเดอร์หน้าร้าน</h1></div><small>อัปเดตล่าสุด {updated || '—'}</small></div>
      <div className="stats">{['pending', 'preparing', 'ready'].map(status => <div key={status}><strong>{orders.filter(o => o.status === status).length}</strong><span>{statusLabels[status]}</span></div>)}</div>
      <div className="filter">{['active', 'all', 'pending', 'preparing', 'ready', 'completed', 'cancelled'].map(status => <button key={status} className={filter === status ? 'active' : ''} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === 'active' ? 'กำลังดำเนินการ' : status === 'all' ? 'ทั้งหมด' : statusLabels[status]}</button>)}</div>
      {error && <p role="alert" className="error">{error}</p>}{syncError && <p role="alert" className="error">อัปเดตข้อมูลไม่ได้: {syncError}</p>}
      <div className="admin-orders">{!visible.length && <p className="empty-message">ไม่มีออเดอร์ในสถานะนี้</p>}{visible.map(order => <article className="order-card" key={order.id}><div className="section-heading"><h2>{order.id}</h2><span className={`status status-${order.status}`}>{statusLabels[order.status]}</span></div><p className="order-location">{order.customer.type === 'dine-in' ? `โต๊ะ ${order.customer.table}` : 'รับกลับบ้าน'}</p><p>{order.customer.name} · <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a></p><small>{new Date(order.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</small><ul>{order.items.map((item, index) => <li key={index}><strong>{item.name} × {item.quantity}</strong><br />{item.noodle} · {item.size} · {money(item.price * item.quantity)}{item.note && <p className="item-note">หมายเหตุ: {item.note}</p>}</li>)}</ul>{order.customer.note && <p className="item-note">หมายเหตุออเดอร์: {order.customer.note}</p>}<div className="total"><span>ยอดรวม</span><strong>{money(order.total)}</strong></div>{nextStatus[order.status] && <button className="primary" disabled={busy} onClick={() => mutate(`/api/admin/orders/${order.id}/status`, { status: nextStatus[order.status], version: order.version })}>{actions[order.status]}</button>}{['pending', 'preparing'].includes(order.status) && <button className="cancel-order" disabled={busy} onClick={() => { if (window.confirm(`ยกเลิกออเดอร์ ${order.id} หรือไม่?`)) mutate(`/api/admin/orders/${order.id}/status`, { status: 'cancelled', version: order.version }) }}>ยกเลิกออเดอร์</button>}</article>)}</div>
      <section className="menu-management"><h2>สถานะเมนู</h2><p>ปิดเมนูเมื่อวัตถุดิบหมด ลูกค้าจะสั่งรายการนั้นไม่ได้</p>{menu.map(product => <div className="menu-stock" key={product.id}><span>{product.name}</span><button disabled={busy} aria-pressed={product.available} onClick={() => mutate(`/api/admin/menu/${product.id}`, { available: !product.available })}>{product.available ? 'พร้อมเสิร์ฟ · กดปิดเมนู' : 'หมดชั่วคราว · กดเปิดเมนู'}</button></div>)}</section>
    </>}
  </main></>
}
