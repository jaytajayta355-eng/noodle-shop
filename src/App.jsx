import { useState, useEffect, useRef } from 'react'
import { apiList, apiOrder, demoMode, money, statusLabels, randomToken, loadJSON } from './api'
import Admin from './Admin'
import { Bento, Hero, Story } from './Showcase'
import useReveal from './useReveal'
import './App.css'
function CustomerApp() {
  const [cart, setCart] = useState([])
  const [receipt, setReceipt] = useState(null)
  const [search, setSearch] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [products, setProducts] = useState([])
  const [references, setReferences] = useState(() => { const v = loadJSON('noodle-order-refs', []); return Array.isArray(v) ? v.slice(0,30).filter(r => r && typeof r.id === 'string' && typeof r.accessToken === 'string') : [] })
  const [pending, setPending] = useState(() => { const v = loadJSON('noodle-pending', null); return v && typeof v.requestId === 'string' && Array.isArray(v.items) ? v : null })
  const [orders, setOrders] = useState([])
  const [sending, setSending] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [menuError, setMenuError] = useState('')
  const submitting = useRef(false)
  const dialog = useRef(null)
  useEffect(() => {
    let active = true, inFlight = false
    async function refresh() {
      if (inFlight) return
      inFlight = true
      try { const menu = await apiList('/api/menu'); if (active) { setProducts(menu); setMenuError('') } }
      catch (e) { if (active) setMenuError(e.message) }
      finally { inFlight = false }
    }
    refresh(); const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  useEffect(() => {
    let active = true, inFlight = false
    async function refresh() {
      if (inFlight) return
      inFlight = true
      try { const result = await apiList('/api/orders/lookup', { method: 'POST', body: JSON.stringify({ references }) }); if (active) { setOrders(result); setSyncError('') } }
      catch (e) { if (active) setSyncError(e.message) }
      finally { inFlight = false }
    }
    refresh(); const timer = setInterval(refresh, 4000)
    return () => { active = false; clearInterval(timer) }
  }, [references])
  useEffect(() => { if (receipt && dialog.current && !dialog.current.open) dialog.current.showModal() }, [receipt])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customer, setCustomer] = useState({ name: '', phone: '', type: 'dine-in', table: '', note: '' })
  const [picked, setPicked] = useState(null)
  useReveal()
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  function add(event, product) {
    event.preventDefault()
    if (!product.available || pending || sending) return
    const form = new FormData(event.currentTarget)
    const noodle = form.get('noodle'), size = form.get('size'), note = String(form.get('note')).trim()
    const key = JSON.stringify([product.id, noodle, size, note])
    setCart(previous => {
      const found = previous.find(item => item.key === key)
      if (found) return previous.map(item => item.key === key ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item)
      return [...previous, { key, productId: product.id, name: product.name, noodle, size, note, price: product.price + (size === 'พิเศษ' ? 10 : 0), quantity: 1 }]
    })
    setNotice(`เพิ่ม ${product.name} ลงตะกร้าแล้ว`)
    setReceipt(null)
  }
  function quantity(key, change) {
    setCart(previous => previous.map(item => item.key === key ? { ...item, quantity: Math.min(99, item.quantity + change) } : item).filter(item => item.quantity > 0))
  }
  async function sendOrder(payload) {
    if (submitting.current) return
    submitting.current = true; setSending(true); setError('')
    try {
      const order = await apiOrder('/api/orders', { method: 'POST', body: JSON.stringify(payload) })
      const next = [{ id: order.id, accessToken: payload.accessToken }, ...references.filter(r => r.id !== order.id)].slice(0, 30)
      // The shop already has the order here, so a storage failure must not be reported as a failed send.
      let saved = true
      try { localStorage.setItem('noodle-order-refs', JSON.stringify(next)); localStorage.removeItem('noodle-pending') } catch { saved = false }
      setReferences(next); setOrders(previous => [order, ...previous.filter(o => o.id !== order.id)]); setReceipt(order); setCart([]); setPending(null)
      setNotice(saved ? 'ส่งออเดอร์ถึงร้านแล้ว' : `ส่งออเดอร์ถึงร้านแล้ว (เลขออเดอร์ ${order.id}) แต่บันทึกประวัติในเบราว์เซอร์ไม่ได้ ปิดหน้านี้แล้วจะติดตามสถานะไม่ได้`)
    } catch (e) {
      if ([400, 409, 415].includes(e.status)) { try { localStorage.removeItem('noodle-pending'); setPending(null) } catch { /* Keep recovery data if storage is unavailable. */ } }
      setError(e.message || 'ยังยืนยันผลไม่ได้ กดตรวจสอบออเดอร์เดิมอีกครั้งเพื่อป้องกันการสั่งซ้ำ')
    } finally { submitting.current = false; setSending(false) }
  }
  function checkout(event) {
    event.preventDefault()
    if (sending || pending || !cart.length) return
    if (!customer.name.trim() || !/^0[0-9]{8,9}$/.test(customer.phone.trim()) || (customer.type === 'dine-in' && !customer.table.trim())) {
      setError('กรุณากรอกชื่อ เบอร์โทร 9–10 หลักที่ขึ้นต้นด้วย 0 และหมายเลขโต๊ะหากทานที่ร้าน'); return
    }
    const payload = { requestId: randomToken(), accessToken: randomToken(), customer, items: cart.map(({ productId, noodle, size, note, quantity }) => ({ productId, noodle, size, note, quantity })) }
    try { localStorage.setItem('noodle-pending', JSON.stringify(payload)) }
    catch { setError('กรุณาอนุญาตการจัดเก็บข้อมูลในเบราว์เซอร์ก่อนสั่งอาหาร'); return }
    setPending(payload); sendOrder(payload)
  }
  function pick(id) {
    setSearch(''); setOnlyAvailable(false); setPicked(id)
    requestAnimationFrame(() => document.getElementById(`product-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }))
  }
  useEffect(() => { if (picked === null) return; const timer = setTimeout(() => setPicked(null), 1800); return () => clearTimeout(timer) }, [picked])
  function field(event) { setCustomer({ ...customer, [event.target.name]: event.target.value }) }
  const menu = products.filter(product => product.name.includes(search.trim()) && (!onlyAvailable || product.available))
  return <>
    <nav className="top-nav glass-nav"><a href={import.meta.env.BASE_URL}>🍜 เตี๋ยวอิ่มใจ</a><span className="nav-links"><a href="#menu-title">เมนู</a><a className="nav-cart" href="#cart">ตะกร้า <span className="count-pop" key={count}>{count}</span></a><a href={`${import.meta.env.BASE_URL}admin`}>สำหรับร้านค้า</a></span></nav>{demoMode && <p className="demo-strip">โหมดเดโม: ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น เปิดหน้าร้านค้าในเบราว์เซอร์เดียวกันเพื่อดูออเดอร์</p>}<Hero count={count} />
    <main className="container">
      <p className="service-banner">สั่งอาหารแล้วรอร้านยืนยัน • ชำระเงินที่ร้านเมื่อรับอาหาร</p>{menuError && <p className="error" role="alert">โหลดเมนูไม่ได้: {menuError} — ระบบจะลองเชื่อมต่อใหม่</p>}{pending && !sending && <section className="recovery"><h2>ตรวจสอบคำสั่งซื้อก่อนหน้า</h2><p>คำสั่งซื้อของ {pending.customer?.name} ยังยืนยันผลไม่ได้ กดปุ่มด้านล่างเพื่อตรวจสอบหรือส่งรายการเดิมอีกครั้ง</p><button className="primary" disabled={sending} onClick={() => sendOrder(pending)}>{sending ? 'กำลังตรวจสอบ…' : 'ตรวจสอบออเดอร์เดิม'}</button>{error && <p role="alert" className="error">{error}</p>}</section>}
      <Bento products={products} onPick={pick} /><Story />
      <div className="shop-layout"><section aria-labelledby="menu-title"><div className="section-heading"><div><p className="eyebrow">OUR MENU</p><h2 id="menu-title">วันนี้ทานอะไรดี?</h2></div><span>เริ่มต้น 45 บาท</span></div>
        <div className="menu-tools"><label>ค้นหาเมนู<input type="search" placeholder="เช่น ต้มยำ หมูน้ำใส" value={search} onChange={e => setSearch(e.target.value)} /></label><label className="check"><input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} /> เฉพาะเมนูพร้อมเสิร์ฟ</label></div>
        <div className="customer-menu">{menu.map(product => <article className={picked === product.id ? 'product-card picked' : 'product-card'} key={product.id} id={`product-${product.id}`} data-reveal><img className="product-image" src={product.image} alt={product.name} /><div className="menu-title"><h3>{product.name}</h3><span className={product.available ? 'badge' : 'badge sold'}>{product.available ? 'พร้อมเสิร์ฟ' : 'หมดชั่วคราว'}</span></div><p>{product.description}</p><strong className="price">{money(product.price)} <small>/ ชาม</small></strong>
          <form onSubmit={e => add(e, product)}><fieldset disabled={!product.available || Boolean(pending) || sending}><div className="option-grid"><label>เส้น<select name="noodle" defaultValue={product.id === 5 ? 'บะหมี่' : 'เส้นเล็ก'}>{['เส้นเล็ก','เส้นใหญ่','เส้นหมี่','บะหมี่','วุ้นเส้น','เกาเหลา'].map(n => <option key={n}>{n}</option>)}</select></label><label>ขนาด<select name="size"><option>ธรรมดา</option><option value="พิเศษ">พิเศษ (+10 บาท)</option></select></label></div><label>คำขอเพิ่มเติม<input name="note" maxLength={150} placeholder="เช่น ไม่ผัก ไม่เผ็ด" /></label><button className="primary" type="submit">{product.available ? '+ เพิ่มลงตะกร้า' : 'เมนูหมดชั่วคราว'}</button></fieldset></form>
        </article>)}</div>{!menu.length && <p className="empty-message">{!products.length && !menuError ? 'กำลังโหลดเมนู…' : 'ไม่พบเมนูที่ค้นหา'}</p>}
      </section>
      <aside className="cart-panel" id="cart"><p className="eyebrow">YOUR ORDER</p><h2>ตะกร้าของฉัน <span className="count-pop" key={count}>({count})</span></h2><p role="status" className="notice">{notice}</p>
        {!cart.length ? <p className="empty-cart">ยังไม่มีเมนูในตะกร้า<br />เลือกชามโปรดจากเมนูได้เลย</p> : cart.map(item => <div className="cart-item" key={item.key}><strong>{item.name}</strong><p>{item.noodle} · {item.size}</p>{item.note && <p>หมายเหตุ: {item.note}</p>}<div className="cart-row"><div className="stepper"><button type="button" aria-label={`ลดจำนวน ${item.name}`} disabled={Boolean(pending) || sending} onClick={() => quantity(item.key, -1)}>−</button><span>{item.quantity}</span><button type="button" disabled={item.quantity >= 99 || Boolean(pending) || sending} aria-label={`เพิ่มจำนวน ${item.name}`} onClick={() => quantity(item.key, 1)}>+</button></div><strong>{money(item.price * item.quantity)}</strong><button className="remove" type="button" disabled={Boolean(pending) || sending} aria-label={`ลบ ${item.name}`} onClick={() => setCart(cart.filter(x => x.key !== item.key))}>ลบ</button></div></div>)}
        <div className="total"><span>รวมทั้งหมด</span><strong>{money(total)}</strong></div>
        <form className="checkout" onSubmit={checkout}><fieldset disabled={Boolean(pending) || sending}><h3>ข้อมูลสำหรับรับอาหาร</h3><label>ชื่อผู้สั่ง<input required name="name" value={customer.name} onChange={field} maxLength={80} autoComplete="name" /></label><label>เบอร์โทรศัพท์<input required type="tel" name="phone" value={customer.phone} onChange={field} pattern="0[0-9]{8,9}" maxLength={10} placeholder="เช่น 0812345678" autoComplete="tel" /></label><label>รูปแบบการรับ<select name="type" value={customer.type} onChange={field}><option value="dine-in">ทานที่ร้าน</option><option value="takeaway">รับกลับบ้าน</option></select></label>{customer.type === 'dine-in' && <label>หมายเลขโต๊ะ<input required name="table" value={customer.table} onChange={field} maxLength={20} /></label>}<label>หมายเหตุของออเดอร์<textarea name="note" value={customer.note} onChange={field} maxLength={300} placeholder="เช่น แยกน้ำซุป" /></label><p className="payment-note">ชำระเงินที่ร้านเมื่อรับอาหาร</p>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={!cart.length || Boolean(pending) || sending} type="submit">{sending ? 'กำลังส่งออเดอร์…' : `ยืนยันสั่งอาหาร · ${money(total)}`}</button></fieldset></form>
      </aside></div>
      {receipt && <dialog ref={dialog} className="receipt" onClose={() => setReceipt(null)}><p className="eyebrow">ORDER RECEIVED</p><h2>ส่งออเดอร์ถึงร้านแล้ว ✓</h2><p>เลขออเดอร์ <strong>{receipt.id}</strong></p><p>{receipt.customer.name} · {receipt.customer.type === 'dine-in' ? `โต๊ะ ${receipt.customer.table}` : 'รับกลับบ้าน'}</p><ul>{receipt.items.map((item, index) => <li key={index}>{item.name} · {item.noodle} · {item.size} × {item.quantity}{item.note && ` (${item.note})`} — {money(item.price * item.quantity)}</li>)}</ul><strong>ยอดรวม {money(receipt.total)}</strong><p>รอร้านรับออเดอร์ ติดตามสถานะได้ด้านล่าง</p><button className="primary" autoFocus onClick={() => { dialog.current.close(); setReceipt(null); document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }) }}>ดูสถานะออเดอร์</button></dialog>}
      <section className="history" id="history"><h2>ติดตามออเดอร์ของฉัน</h2><p>สถานะอัปเดตทุก 4 วินาที • ประวัติผูกกับเบราว์เซอร์ที่ใช้สั่ง</p>{syncError && <p className="error" role="alert">ยังอัปเดตสถานะไม่ได้: {syncError}</p>}{!orders.length && <p>ยังไม่มีออเดอร์</p>}{orders.map(order => <details key={order.id} open={order.status !== 'completed' && order.status !== 'cancelled'}><summary><span className={`status status-${order.status}`}>{statusLabels[order.status]}</span> {order.id} · {money(order.total)}</summary><p>{new Date(order.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p><ul>{order.items.map((item, index) => <li key={index}>{item.name} · {item.noodle} · {item.size} × {item.quantity}{item.note && ` (${item.note})`} — {money(item.price * item.quantity)}</li>)}</ul><p>{order.customer.type === 'dine-in' ? `โต๊ะ ${order.customer.table}` : 'รับกลับบ้าน'}{order.customer.note && ` · ${order.customer.note}`}</p>{order.status === 'ready' && <p className="notice">อาหารพร้อมแล้ว กรุณารับอาหารหรือรอพนักงานเสิร์ฟ</p>}</details>)}</section>
    </main><footer>เตี๋ยวอิ่มใจ · อร่อยเต็มชาม อิ่มใจทุกคำ</footer>
  </>
}


export default function App() { return window.location.pathname.startsWith(`${import.meta.env.BASE_URL}admin`) ? <Admin /> : <CustomerApp /> }
