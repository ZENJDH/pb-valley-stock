import React, { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { InventoryMode, UserRole } from '../../src/shared/types'
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
import '../../src/renderer/src/approved-ui.css'

const roleLabels: Record<UserRole, string> = { admin: 'Admin', counter: 'คนนับของ', viewer: 'ผู้ใช้ทั่วไป' }

function WebApp() {
  const [session, setSession] = useState<{ authenticated: boolean; role: UserRole | null; inventoryMode: InventoryMode; needsSetup: boolean; canSetup: boolean; availableRoles: UserRole[] } | null>(null)
  const [password, setPassword] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin')
  const [selectedInventoryMode, setSelectedInventoryMode] = useState<InventoryMode>('products')
  const [accessOpen, setAccessOpen] = useState(false)
  const [accessRole, setAccessRole] = useState<UserRole>('counter')
  const [accessPassword, setAccessPassword] = useState('')
  const [accessBusy, setAccessBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshSession() {
    try {
      setSession(await (await request('/api/session')).json())
      setError('')
    } catch {
      setError('ไม่สามารถเชื่อมต่อ Server ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์เปิดอยู่')
    }
  }

  useEffect(() => {
    void refreshSession()
    const expired = () => {
      setSession((current) => current && { ...current, authenticated: false })
      setError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')
    }
    window.addEventListener('pb-session-expired', expired)
    return () => window.removeEventListener('pb-session-expired', expired)
  }, [])

  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request(session?.needsSetup ? '/api/setup' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, role: session?.needsSetup ? 'admin' : selectedRole, inventoryMode: selectedInventoryMode })
      })
      setPassword('')
      await refreshSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  async function saveAccess(event: FormEvent) {
    event.preventDefault()
    setAccessBusy(true)
    setError('')
    try {
      await request('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: accessRole, password: accessPassword })
      })
      setAccessPassword('')
      setAccessOpen(false)
      await refreshSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกสิทธิ์ไม่สำเร็จ')
    } finally {
      setAccessBusy(false)
    }
  }

  async function handleLogout() {
    try {
      await request('/api/logout', { method: 'POST' })
      await refreshSession()
    } catch {
      setError('ออกจากระบบไม่สำเร็จ')
    }
  }

  if (session?.authenticated) {
    return (
      <>
        {error && <div role="alert" className="web-error-banner">{error}</div>}
        <App role={session.role || 'viewer'} inventoryMode={session.inventoryMode || 'products'} onLogout={handleLogout} onManageAccess={session.role === 'admin' ? () => setAccessOpen(true) : undefined} />
        {accessOpen && (
          <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAccessOpen(false)}>
            <div className="modal settings-modal" role="dialog" aria-modal="true">
              <div className="modal-header">
                <div><span className="eyebrow">ACCESS CONTROL</span><h2>จัดการสิทธิ์การใช้งาน</h2></div>
                <button className="icon-button" onClick={() => setAccessOpen(false)} aria-label="ปิด">×</button>
              </div>
              <form onSubmit={saveAccess}>
                <section className="settings-section">
                  <h3>ตั้งรหัสผ่านตามบทบาท</h3>
                  <p className="hint">Admin ทำได้ทั้งหมด · คนนับของปรับจำนวนคงเหลือได้ · ผู้ใช้ทั่วไปดูข้อมูลอย่างเดียว</p>
                  <div className="form-grid">
                    <label className="field"><span>บทบาท</span><select value={accessRole} onChange={(e) => setAccessRole(e.target.value as UserRole)}><option value="counter">คนนับของ</option><option value="viewer">ผู้ใช้ทั่วไป</option><option value="admin">Admin</option></select></label>
                    <label className="field"><span>รหัสผ่านใหม่</span><input type="password" minLength={accessRole === 'admin' ? 12 : 8} maxLength={128} value={accessPassword} onChange={(e) => setAccessPassword(e.target.value)} placeholder={accessRole === 'admin' ? 'อย่างน้อย 12 ตัวอักษร' : 'อย่างน้อย 8 ตัวอักษร'} /></label>
                  </div>
                  {accessRole !== 'admin' && <p className="hint">เว้นรหัสผ่านว่างแล้วกดบันทึกเพื่อปิดการใช้งานบทบาทนี้</p>}
                </section>
                <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAccessOpen(false)}>ยกเลิก</button><button type="submit" className="button primary" disabled={accessBusy}>{accessBusy ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}</button></div>
              </form>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <main className="login-screen">
      <div className="login-backdrop-decor">
        <div className="decor-circle c1" />
        <div className="decor-circle c2" />
      </div>

      <div className="login-container">
        <div className="login-brand-header">
          <div className="login-logo-wrap">
            <img src={logo} alt="PB VALLEY CHIANG RAI" />
          </div>
          <span className="estate-badge-pill">PB VALLEY CHIANG RAI</span>
          <h1>{selectedInventoryMode === 'agrochemicals' ? 'ระบบนับสต็อกปุ๋ยและสารเคมี' : 'ระบบสต็อกและวันหมดอายุสินค้า'}</h1>
          <p className="login-subtitle">
            {session?.needsSetup
              ? 'ตั้งค่ารหัสผ่านผู้ดูแลระบบครั้งแรกเพื่อเริ่มต้นใช้งาน'
              : selectedInventoryMode === 'agrochemicals'
                ? 'ตรวจนับยอดคงเหลือ แยกตามฝ่าย และติดตามวันที่สั่งเข้ามา'
                : 'กรุณากรอกรหัสผ่านเพื่อเข้าสู่ระบบจัดการคลังสินค้า'}
          </p>
        </div>

        <form className="login-card" onSubmit={login}>
          {error && (
            <div className="login-error-alert" role="alert">
              <span className="error-icon">!</span>
              <span>{error}</span>
            </div>
          )}

          {!session ? (
            <div className="login-connecting-state">
              <div className="spinner" />
              <p>กำลังตรวจสอบการเชื่อมต่อกับเซิร์ฟเวอร์…</p>
              <button type="button" className="button secondary" onClick={refreshSession}>
                ลองเชื่อมต่ออีกครั้ง
              </button>
            </div>
          ) : session.needsSetup && !session.canSetup ? (
            <div className="setup-warning-box">
              <p>⚠️ กรุณาเปิด <code>http://localhost</code> บนเครื่อง Server โดยตรงเพื่อตั้งรหัสผ่านครั้งแรก</p>
            </div>
          ) : (
            <>
              <fieldset className="inventory-mode-fieldset">
                <legend>เลือกประเภทที่ต้องการนับ</legend>
                <div className="inventory-mode-options">
                  <label className={`inventory-mode-option ${selectedInventoryMode === 'products' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="inventoryMode"
                      value="products"
                      checked={selectedInventoryMode === 'products'}
                      onChange={() => setSelectedInventoryMode('products')}
                    />
                    <span className="inventory-mode-icon product-mode" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/><path d="M12 11v10"/></svg>
                    </span>
                    <span className="inventory-mode-copy">
                      <strong>นับจำนวนสินค้า</strong>
                      <small>คลังสินค้าทั่วไป</small>
                    </span>
                    <span className="inventory-mode-check" aria-hidden="true">✓</span>
                  </label>

                  <label className={`inventory-mode-option ${selectedInventoryMode === 'agrochemicals' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="inventoryMode"
                      value="agrochemicals"
                      checked={selectedInventoryMode === 'agrochemicals'}
                      onChange={() => setSelectedInventoryMode('agrochemicals')}
                    />
                    <span className="inventory-mode-icon chemical-mode" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M9 3h6"/><path d="M10 3v5l-5.2 9a2.7 2.7 0 0 0 2.3 4h9.8a2.7 2.7 0 0 0 2.3-4L14 8V3"/><path d="M7.8 15h8.4"/></svg>
                    </span>
                    <span className="inventory-mode-copy">
                      <strong>นับจำนวนปุ๋ย/สารเคมี</strong>
                      <small>คลังวัสดุการเกษตร</small>
                    </span>
                    <span className="inventory-mode-check" aria-hidden="true">✓</span>
                  </label>
                </div>
              </fieldset>

              {selectedInventoryMode === 'agrochemicals' && (
                <div className="department-preview" aria-label="ฝ่ายในคลังปุ๋ยและสารเคมี">
                  <div className="department-preview-heading">
                    <span>แบ่งสต็อกตาม 3 ฝ่ายหลัก</span>
                    <small>เลือกฝ่ายภายในหน้าคลัง</small>
                  </div>
                  <div className="department-preview-list">
                    <span className="department-preview-chip"><b>OP</b><small>งานปฏิบัติการ</small></span>
                    <span className="department-preview-chip cocoa"><b>โกโก้</b><small>แปลงและงานผลิตโกโก้</small></span>
                    <span className="department-preview-chip extension"><b>ส่งเสริม</b><small>งานส่งเสริมการเกษตร</small></span>
                  </div>
                </div>
              )}

              {!session.needsSetup && (
                <div className="login-field">
                  <label htmlFor="role">ประเภทผู้ใช้งาน</label>
                  <select id="role" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as UserRole)}>
                    {(['admin', 'counter', 'viewer'] as UserRole[]).map((role) => <option key={role} value={role} disabled={!session.availableRoles.includes(role)}>{roleLabels[role]}{!session.availableRoles.includes(role) ? ' (ยังไม่เปิดใช้)' : ''}</option>)}
                  </select>
                </div>
              )}
              <div className="login-field">
                <label htmlFor="password">
                  {session.needsSetup ? 'ตั้งรหัสผ่านผู้ดูแลใหม่ (อย่างน้อย 12 ตัวอักษร)' : 'รหัสผ่านเข้าใช้งาน'}
                </label>
                <div className="password-input-wrap">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={session.needsSetup ? 'new-password' : 'current-password'}
                    minLength={session.needsSetup ? 12 : undefined}
                    maxLength={128}
                    required
                    autoFocus
                    placeholder="กรอกรหัสผ่านของคุณ..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="toggle-password-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    {showPassword ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>

              <button className="login-submit-btn" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <span className="button-spinner" />
                    <span>กำลังตรวจสอบข้อมูล…</span>
                  </>
                ) : session.needsSetup ? (
                  'บันทึกรหัสผ่านและเริ่มต้นใช้งาน'
                ) : (
                  `เข้าสู่${selectedInventoryMode === 'agrochemicals' ? 'คลังปุ๋ย/สารเคมี' : 'คลังสินค้า'}`
                )}
              </button>

              <div className="login-footer-info">
                <span>ระบบรักษาความปลอดภัยเครือข่าย PB VALLEY CHIANG RAI · {selectedInventoryMode === 'agrochemicals' ? 'Department Stock Control' : 'FEFO Stock Engine'}</span>
              </div>
            </>
          )}
        </form>
      </div>
    </main>
  )
}

document.documentElement.setAttribute('data-web', '')
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>
)
