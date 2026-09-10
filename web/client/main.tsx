import React, { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/kanit/400.css'
import '@fontsource/kanit/500.css'
import '@fontsource/kanit/600.css'
import '@fontsource/kanit/700.css'
import './api'
import { request } from './api'
import App from '../../src/renderer/src/App'
import logo from '../../logo-pb.png'
import '../../src/renderer/src/styles.css'
import './web.css'

function WebApp() {
  const [session, setSession] = useState<{ authenticated: boolean; needsSetup: boolean; canSetup: boolean } | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function refreshSession() {
    try { setSession(await (await request('/api/session')).json()); setError('') } catch { setError('เชื่อมต่อ Server ไม่ได้ กรุณาลองใหม่') }
  }
  useEffect(() => {
    void refreshSession()
    const expired = () => { setSession((current) => current && { ...current, authenticated: false }); setError('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง') }
    window.addEventListener('pb-session-expired', expired)
    return () => window.removeEventListener('pb-session-expired', expired)
  }, [])
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request(session?.needsSetup ? '/api/setup' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      setPassword(''); await refreshSession()
    } catch (e) { setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ') } finally { setBusy(false) }
  }
  if (session?.authenticated) return <><button className="web-logout" onClick={async () => { try { await request('/api/logout', { method: 'POST' }); await refreshSession() } catch { setError('ออกจากระบบไม่สำเร็จ') } }}>ออกจากระบบ</button>{error && <div role="alert" className="web-error">{error}</div>}<App /></>
  return <main className="login-screen"><form className="login-card" onSubmit={login}><div className="login-logo"><img src={logo} alt="PB Valley" /></div><p className="login-brand">PB VALLEY</p><h1>{session?.needsSetup ? 'เริ่มต้นใช้งานระบบสต็อก' : 'เข้าสู่ระบบสต็อก'}</h1><p>{session?.needsSetup ? 'ตั้งรหัสผ่านผู้ดูแลครั้งแรกที่เครื่อง Server' : 'ใช้รหัสผ่านของทีมเพื่อจัดการสินค้า'}</p>{error && <p className="login-error" role="alert">{error}</p>}{!session ? <button type="button" onClick={refreshSession}>ลองเชื่อมต่ออีกครั้ง</button> : session.needsSetup && !session.canSetup ? <p>เปิด http://localhost:3080 บนเครื่อง Server เพื่อตั้งค่าครั้งแรก</p> : <><label htmlFor="password">รหัสผ่าน{session.needsSetup ? ' (อย่างน้อย 12 ตัวอักษร)' : ''}</label><input id="password" type="password" autoComplete={session.needsSetup ? 'new-password' : 'current-password'} minLength={session.needsSetup ? 12 : undefined} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} /><button disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : session.needsSetup ? 'ตั้งรหัสผ่านและเริ่มใช้งาน' : 'เข้าสู่ระบบ'}</button></>}</form></main>
}
document.documentElement.setAttribute('data-web', '')
createRoot(document.getElementById('root')!).render(<React.StrictMode><WebApp /></React.StrictMode>)
