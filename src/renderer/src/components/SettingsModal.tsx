import { useEffect, useState, type FormEvent } from 'react'
import type { NotificationSettingsPublic, NotificationSettingsUpdate } from '../../../shared/types'

interface Props {
  onClose(): void
  onSaved(): void
  onMessage(message: string, kind?: 'success' | 'error'): void
}

export function SettingsModal({ onClose, onSaved, onMessage }: Props) {
  const [settings, setSettings] = useState<NotificationSettingsPublic | null>(null)
  const [telegramToken, setTelegramToken] = useState('')
  const [lineToken, setLineToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    window.stockApi.settings.get().then(setSettings).catch((error) => onMessage(error.message, 'error'))
  }, [onMessage])

  function patch(values: Partial<NotificationSettingsPublic>) {
    setSettings((current) => current ? { ...current, ...values } : current)
  }

  async function save(event?: FormEvent): Promise<boolean> {
    event?.preventDefault()
    if (!settings) return false
    setSaving(true)
    const update: NotificationSettingsUpdate = {
      warningDays: settings.warningDays,
      alertTime: settings.alertTime,
      timezone: settings.timezone,
      telegramEnabled: settings.telegramEnabled,
      telegramChatId: settings.telegramChatId,
      telegramBotToken: telegramToken || undefined,
      lineEnabled: settings.lineEnabled,
      lineTargetId: settings.lineTargetId,
      lineChannelAccessToken: lineToken || undefined
    }
    try {
      const saved = await window.stockApi.settings.save(update)
      setSettings(saved)
      setTelegramToken('')
      setLineToken('')
      onSaved()
      onMessage('บันทึกการตั้งค่าแล้ว')
      return true
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      const saved = await save()
      if (!saved) return
      const result = await window.stockApi.notifications.test()
      const message = Object.entries(result).map(([channel, value]) => `${channel}: ${value.message}`).join(' · ')
      const failed = Object.values(result).some((value) => !value.ok)
      onMessage(message || 'ไม่มีช่องทางที่เปิดใช้งาน', failed ? 'error' : 'success')
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  if (!settings) return <div className="modal-backdrop"><div className="modal loading-card">กำลังโหลดการตั้งค่า…</div></div>

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal settings-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div><span className="eyebrow">AUTOMATION</span><h2>ตั้งค่าการแจ้งเตือน</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="ปิด">×</button>
        </div>
        <form onSubmit={save}>
          <section className="settings-section">
            <h3>กำหนดเวลาและเกณฑ์</h3>
            <div className="form-grid three">
              <label className="field"><span>แจ้งเตือนล่วงหน้า (วัน)</span><input type="number" min="1" max="365" value={settings.warningDays} onChange={(e) => patch({ warningDays: Number(e.target.value) })} /></label>
              <label className="field"><span>เวลาตรวจสอบทุกวัน</span><input type="time" value={settings.alertTime} onChange={(e) => patch({ alertTime: e.target.value })} /></label>
              <label className="field"><span>Timezone</span><select value={settings.timezone} onChange={(e) => patch({ timezone: e.target.value })}><option value="Asia/Bangkok">Asia/Bangkok (ประเทศไทย)</option><option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh</option><option value="Asia/Singapore">Asia/Singapore</option><option value="UTC">UTC</option></select></label>
            </div>
            <p className="hint">Scheduler ทำงานเมื่อเปิดแอปอยู่ หากต้องการทำงานแม้ปิดแอป ให้ตั้งค่า auto-start ของระบบปฏิบัติการ</p>
          </section>

          <section className="settings-section channel-section">
            <div className="channel-heading">
              <div className="channel-icon telegram">T</div><div><h3>Telegram Bot</h3><p>ส่งผ่าน Bot API ไปยังผู้ใช้หรือกลุ่ม</p></div>
              <label className="switch"><input type="checkbox" checked={settings.telegramEnabled} onChange={(e) => patch({ telegramEnabled: e.target.checked })} /><span /></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>Chat ID</span><input value={settings.telegramChatId} onChange={(e) => patch({ telegramChatId: e.target.value })} placeholder="เช่น -1001234567890" /></label>
              <label className="field"><span>Bot Token</span><input type="password" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder={settings.telegramTokenConfigured ? '•••••••• (บันทึกไว้แล้ว)' : '123456:ABC...'} /></label>
            </div>
          </section>

          <section className="settings-section channel-section">
            <div className="channel-heading">
              <div className="channel-icon line">L</div><div><h3>LINE Messaging API</h3><p>ส่ง Push Message จาก LINE Official Account</p></div>
              <label className="switch"><input type="checkbox" checked={settings.lineEnabled} onChange={(e) => patch({ lineEnabled: e.target.checked })} /><span /></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>User ID / Group ID</span><input value={settings.lineTargetId} onChange={(e) => patch({ lineTargetId: e.target.value })} placeholder="Uxxxxxxxx หรือ Cxxxxxxxx" /></label>
              <label className="field"><span>Channel Access Token</span><input type="password" value={lineToken} onChange={(e) => setLineToken(e.target.value)} placeholder={settings.lineTokenConfigured ? '•••••••• (บันทึกไว้แล้ว)' : 'Channel access token'} /></label>
            </div>
          </section>

          <div className="modal-actions split">
            <button className="button secondary" type="button" disabled={testing || saving} onClick={test}>{testing ? 'กำลังทดสอบ…' : 'ส่งข้อความทดสอบ'}</button>
            <div><button className="button ghost" type="button" onClick={onClose}>ยกเลิก</button><button className="button primary" disabled={saving} type="submit">{saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button></div>
          </div>
        </form>
      </div>
    </div>
  )
}
