import { useEffect, useRef, useState } from 'react'
import { money } from './api'

const img = n => `${import.meta.env.BASE_URL}images/noodle-${n}.jpg`
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Thai vowels and tone marks combine with the previous letter, so split by grapheme, not by code unit.
function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(s => s.segment)
  return [text]
}

const vertex = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'
// Slowly swirling broth with rising steam; the pointer adds a warm glow.
const fragment = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 q=uv;q.x*=r.x/r.y;
  float w=fbm(q*3.-vec2(0.,t*.12));
  float f=fbm(q*2.2+vec2(t*.04,-t*.06)+w*1.4);
  vec3 c=mix(vec3(.24,.05,.04),vec3(.55,.16,.1),f);
  c=mix(c,vec3(.93,.6,.27),smoothstep(.55,.85,f)*.55);
  float s=fbm(vec2(q.x*3.5,q.y*1.6-t*.35));
  c+=vec3(1.,.9,.78)*smoothstep(.58,.9,s)*uv.y*.22;
  vec2 mp=m;mp.x*=r.x/r.y;
  c+=vec3(.95,.55,.2)*.28*exp(-length(q-mp)*2.6);
  c*=1.-.45*length(uv-.5);
  gl_FragColor=vec4(c,1.);
}`

function useBrothShader() {
  const canvas = useRef(null)
  useEffect(() => {
    const el = canvas.current
    const gl = el?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) return // The CSS gradient behind the canvas stays visible as the fallback.
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uR = gl.getUniformLocation(program, 'r'), uT = gl.getUniformLocation(program, 't'), uM = gl.getUniformLocation(program, 'm')
    const mouse = { x: .7, y: .6 }, target = { x: .7, y: .6 }
    const still = reducedMotion()
    let frame = 0, visible = true, start = performance.now()
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      el.width = Math.max(1, Math.round(el.clientWidth * dpr * .6)); el.height = Math.max(1, Math.round(el.clientHeight * dpr * .6))
      gl.viewport(0, 0, el.width, el.height)
    }
    function draw(now) {
      mouse.x += (target.x - mouse.x) * .05; mouse.y += (target.y - mouse.y) * .05
      gl.uniform2f(uR, el.width, el.height); gl.uniform1f(uT, still ? 8 : (now - start) / 1000); gl.uniform2f(uM, mouse.x, mouse.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!still && visible) frame = requestAnimationFrame(draw)
    }
    const onMove = e => { const b = el.getBoundingClientRect(); target.x = (e.clientX - b.left) / b.width; target.y = 1 - (e.clientY - b.top) / b.height }
    const sizer = new ResizeObserver(() => { resize(); if (still || !visible) draw(performance.now()) })
    const watcher = new IntersectionObserver(([entry]) => {
      const was = visible; visible = entry.isIntersecting
      if (visible && !was && !still) { start = performance.now() - 8000; frame = requestAnimationFrame(draw) }
    })
    sizer.observe(el); watcher.observe(el); resize()
    window.addEventListener('pointermove', onMove, { passive: true })
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); sizer.disconnect(); watcher.disconnect(); window.removeEventListener('pointermove', onMove) }
  }, [])
  return canvas
}

// Writes scroll progress and pointer position into CSS variables; the stylesheet does the actual parallax.
function useParallax() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion()) return
    let frame = 0
    const update = () => { frame = 0; el.style.setProperty('--scroll', String(Math.min(window.scrollY, el.offsetHeight))) }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    const onMove = e => { el.style.setProperty('--mx', (e.clientX / window.innerWidth - .5).toFixed(3)); el.style.setProperty('--my', (e.clientY / window.innerHeight - .5).toFixed(3)) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('pointermove', onMove, { passive: true })
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('pointermove', onMove) }
  }, [])
  return ref
}

const rotating = ['น้ำซุปเคี่ยว 12 ชั่วโมง', 'เส้นสดลวกใหม่ทุกชาม', 'สั่งง่าย ชำระที่ร้าน']

export function Hero({ count }) {
  const hero = useParallax(), canvas = useBrothShader()
  const [word, setWord] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return
    const timer = setInterval(() => setWord(w => (w + 1) % rotating.length), 2600)
    return () => clearInterval(timer)
  }, [])
  return <header className="hero" ref={hero}>
    <canvas className="hero-gl" ref={canvas} aria-hidden="true" />
    <div className="hero-inner">
      <div className="hero-copy">
        <p className="hero-kicker">สดใหม่ทุกชาม • อิ่มอร่อยทุกคำ</p>
        <h1 className="kinetic" aria-label="เตี๋ยวอิ่มใจ">{graphemes('เตี๋ยวอิ่มใจ').map((g, i) => <span key={i} aria-hidden="true" style={{ '--i': i }}>{g}</span>)}</h1>
        <p className="hero-rotator" aria-live="off"><span key={word}>{rotating[word]}</span></p>
        <div className="hero-actions"><a className="cta" href="#menu-title">เลือกเมนูเลย</a><a className="cta ghost" href="#cart">ตะกร้า <span className="count-pop" key={count}>{count}</span></a></div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="bowl-ring" />
        <img className="bowl" src={img(2)} alt="" />
        <div className="glass-chip chip-a">🔥 ร้อนจากหม้อ</div>
        <div className="glass-chip chip-b">🌶 ปรุงตามใจ</div>
        <div className="glass-chip chip-c">เริ่ม {money(45)}</div>
      </div>
    </div>
    <div className="marquee" aria-hidden="true"><div>{Array.from({ length: 2 }, (_, k) => <span key={k}>เส้นเล็ก ✦ เส้นใหญ่ ✦ เส้นหมี่ ✦ บะหมี่ ✦ วุ้นเส้น ✦ เกาเหลา ✦ ต้มยำ ✦ น้ำใส ✦ เย็นตาโฟ ✦ น้ำตก ✦ </span>)}</div></div>
  </header>
}

const steps = [
  { title: 'เคี่ยวน้ำซุปตั้งแต่ตีห้า', text: 'กระดูกหมู หัวไชเท้า และเครื่องเทศ เคี่ยวไฟอ่อนนาน 12 ชั่วโมงจนหวานกลมกล่อม', image: 1, stat: '12 ชม.' },
  { title: 'ลวกเส้นสดทีละชาม', text: 'ไม่ลวกทิ้งไว้ล่วงหน้า เส้นจึงนุ่ม เหนียว ไม่อืด เลือกได้ 6 แบบ', image: 3, stat: '6 เส้น' },
  { title: 'ท็อปปิ้งจัดเต็ม', text: 'หมูชิ้น หมูสับ ลูกชิ้นทำเอง กากหมูกรอบ โรยผักสดก่อนเสิร์ฟ', image: 4, stat: 'จัดเต็ม' },
  { title: 'เสิร์ฟถึงโต๊ะคุณ', text: 'สั่งผ่านเว็บ ร้านรับออเดอร์ทันที ติดตามสถานะได้สดๆ จนอาหารพร้อม', image: 6, stat: 'สด' },
]

export function Story() {
  const [active, setActive] = useState(0)
  const refs = useRef([])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) setActive(Number(e.target.dataset.step)) }), { rootMargin: '-45% 0px -45% 0px' })
    refs.current.forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [])
  return <section className="story" aria-labelledby="story-title">
    <div className="story-head" data-reveal><p className="eyebrow">OUR STORY</p><h2 id="story-title">กว่าจะเป็นหนึ่งชาม</h2></div>
    <div className="story-grid">
      <div className="story-stage" aria-hidden="true">
        <div className="story-card">
          {steps.map((s, i) => <img key={i} src={img(s.image)} alt="" className={i === active ? 'on' : ''} />)}
          <div className="story-meta"><span className="story-num">0{active + 1}</span><span className="story-stat" key={active}>{steps[active].stat}</span></div>
          <div className="story-progress"><i style={{ transform: `scaleX(${(active + 1) / steps.length})` }} /></div>
        </div>
      </div>
      <ol className="story-steps">{steps.map((s, i) => <li key={i} ref={el => { refs.current[i] = el }} data-step={i} className={i === active ? 'on' : ''}><span>0{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></li>)}</ol>
    </div>
  </section>
}

export function Bento({ products, onPick }) {
  const ready = products.filter(p => p.available)
  const [hero, second] = ready.length ? [ready[0], ready[1] || ready[0]] : [null, null]
  const cheapest = products.length ? Math.min(...products.map(p => p.price)) : 45
  return <section className="bento" aria-labelledby="bento-title">
    <div className="story-head" data-reveal><p className="eyebrow">HIGHLIGHTS</p><h2 id="bento-title">ทำไมต้องเตี๋ยวอิ่มใจ</h2></div>
    <div className="bento-grid">
      {hero && <article className="tile tile-feature" data-reveal><img src={hero.image} alt="" /><div className="tile-glass"><p className="eyebrow">เมนูแนะนำ</p><h3>{hero.name}</h3><p>{hero.description}</p><button type="button" className="cta" onClick={() => onPick(hero.id)}>เลือกเมนูนี้ · {money(hero.price)}</button></div></article>}
      <article className="tile tile-stat" data-reveal><strong>{money(cheapest)}</strong><span>ราคาเริ่มต้นต่อชาม</span></article>
      <article className="tile tile-live" data-reveal><span className="live-dot" /> <strong>{ready.length}/{products.length || 0}</strong><span>เมนูพร้อมเสิร์ฟตอนนี้</span></article>
      <article className="tile tile-track" data-reveal><h3>ติดตามออเดอร์สด</h3><p>รู้ทันทีเมื่อร้านรับออเดอร์ กำลังทำ และอาหารพร้อม</p><div className="track-bar"><i /><i /><i /></div></article>
      {second && <button type="button" className="tile tile-wide" data-reveal onClick={() => onPick(second.id)}><img src={second.image} alt="" /><span><strong>{second.name}</strong><small>{money(second.price)} / ชาม</small></span><span className="tile-arrow" aria-hidden="true">→</span></button>}
      <article className="tile tile-pay" data-reveal><h3>ชำระที่ร้าน</h3><p>ไม่ต้องผูกบัตร สั่งก่อน จ่ายตอนรับอาหาร</p></article>
    </div>
  </section>
}
