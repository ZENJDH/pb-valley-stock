import type { NotificationTestResult, Product } from '../shared/types'
import type { StockDatabase } from './database'

function productLine(product: Product): string {
  const productCode = product.barcode || `#${product.id}`
  const categoryPath = product.subcategory ? `${product.category} › ${product.subcategory}` : product.category
  if (product.status === 'expired') {
    return `🔴 ${product.name}\nหมวดหมู่: ${categoryPath}\nรหัสสินค้า: ${productCode} | คงเหลือ: ${product.quantity}/${product.totalQuantity} ชิ้น\nหมดอายุแล้ว ${Math.abs(product.daysRemaining)} วัน [${product.expirationDate}]`
  }
  return `🟠 ${product.name}\nหมวดหมู่: ${categoryPath}\nรหัสสินค้า: ${productCode} | คงเหลือ: ${product.quantity}/${product.totalQuantity} ชิ้น\nเหลือ ${product.daysRemaining} วัน [${product.expirationDate}]`
}

export function buildAlertMessages(products: Product[], warningDays: number): string[] {
  const header = `📦 แจ้งเตือนสต็อกและวันหมดอายุ\nเกณฑ์แจ้งเตือน: ภายใน ${warningDays} วัน\n`
  const lines = products.map(productLine)
  const messages: string[] = []
  let current = header

  for (const line of lines) {
    if (`${current}\n${line}`.length > 3900) {
      messages.push(current)
      current = `📦 รายการต่อ (เกณฑ์ ${warningDays} วัน)\n${line}`
    } else {
      current += `\n${line}`
    }
  }
  if (current.trim()) messages.push(current)
  return messages
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text()
  try {
    const parsed = JSON.parse(body) as { description?: string; message?: string; details?: Array<{ message?: string; property?: string }> }
    const main = parsed.description ?? parsed.message ?? body
    const details = parsed.details?.map((detail) => [detail.property, detail.message].filter(Boolean).join(': ')).filter(Boolean).join(' · ')
    return details ? `${main} — ${details}` : main
  } catch {
    return body || `HTTP ${response.status}`
  }
}

export async function sendTelegram(token: string, chatId: string, messages: string[]): Promise<void> {
  for (const message of messages) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
    })
    if (!response.ok) throw new Error(`Telegram: ${await responseError(response)}`)
  }
}

export async function sendLine(channelAccessToken: string, targetId: string, messages: string[]): Promise<void> {
  if (!/^[UCR][0-9a-f]{32}$/i.test(targetId)) {
    throw new Error('LINE ID รูปแบบไม่ถูกต้อง ต้องขึ้นต้น U, C หรือ R และตามด้วยตัวอักษร 32 ตัว')
  }

  const targetType = targetId.charAt(0).toUpperCase()
  const verifyUrl = targetType === 'U'
    ? `https://api.line.me/v2/bot/profile/${targetId}`
    : targetType === 'C'
      ? `https://api.line.me/v2/bot/group/${targetId}/summary`
      : null
  if (verifyUrl) {
    const verification = await fetch(verifyUrl, { headers: { Authorization: `Bearer ${channelAccessToken}` } })
    if (verification.status === 401 || verification.status === 403) {
      throw new Error('Channel Access Token ไม่ถูกต้อง หมดอายุ หรือถูก Reissue แล้ว')
    }
    if (verification.status === 404) {
      throw new Error(targetType === 'U'
        ? 'ไม่พบ User ID นี้ กรุณาใช้ Your user ID จาก Provider เดียวกับ Token และเพิ่ม Official Account เป็นเพื่อนก่อน'
        : 'ไม่พบ Group ID นี้ กรุณาเพิ่ม Official Account เข้ากลุ่มและใช้ Group ID จาก webhook ของกลุ่มเดียวกัน')
    }
    if (!verification.ok) throw new Error(`ตรวจสอบปลายทาง LINE ไม่สำเร็จ: ${await responseError(verification)}`)
  }

  for (let i = 0; i < messages.length; i += 5) {
    const batch = messages.slice(i, i + 5)
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: targetId,
        messages: batch.map((text) => ({ type: 'text', text }))
      })
    })
    if (!response.ok) {
      const detail = await responseError(response)
      if (response.status === 401 || response.status === 403) throw new Error('Channel Access Token ไม่ถูกต้อง หมดอายุ หรือถูก Reissue แล้ว')
      if (detail.includes('Failed to send messages')) {
        throw new Error('LINE ส่งข้อความไม่ได้ กรุณาตรวจว่า ID และ Token มาจาก Provider เดียวกัน และผู้รับยังเป็นเพื่อนกับ Official Account')
      }
      throw new Error(detail)
    }
  }
}

export async function testNotifications(db: StockDatabase): Promise<NotificationTestResult> {
  const settings = db.getNotificationSettings()
  const result: NotificationTestResult = {}
  const message = [`✅ ทดสอบการแจ้งเตือนสำเร็จ\nStock Expiration Tracker เชื่อมต่อช่องทางนี้แล้ว`]

  if (settings.telegramEnabled) {
    try {
      await sendTelegram(settings.telegramBotToken, settings.telegramChatId, message)
      result.telegram = { ok: true, message: 'ส่งข้อความทดสอบสำเร็จ' }
    } catch (error) {
      result.telegram = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (settings.lineEnabled) {
    try {
      await sendLine(settings.lineChannelAccessToken, settings.lineTargetId, message)
      result.line = { ok: true, message: 'ส่งข้อความทดสอบสำเร็จ' }
    } catch (error) {
      result.line = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (!settings.telegramEnabled && !settings.lineEnabled) {
    throw new Error('กรุณาเปิดใช้งาน Telegram หรือ LINE อย่างน้อยหนึ่งช่องทาง')
  }
  return result
}

export async function testExpirationWarning(db: StockDatabase): Promise<NotificationTestResult> {
  const settings = db.getNotificationSettings()
  const result: NotificationTestResult = {}
  const sampleDays = Math.min(7, settings.warningDays)
  const message = [
    `🧪 ทดสอบแจ้งเตือนใกล้หมดอายุ\nเกณฑ์แจ้งเตือน: ภายใน ${settings.warningDays} วัน\n\n🟠 สินค้าทดสอบ\nหมวดหมู่: โกโก้ › เมล็ดแห้ง\nรหัสสินค้า: TEST-001 | คงเหลือ: 8/10 ชิ้น\nเหลือ ${sampleDays} วัน\n\nนี่เป็นข้อความทดสอบ ไม่มีผลต่อข้อมูลสต็อกจริง`
  ]

  if (settings.telegramEnabled) {
    try {
      await sendTelegram(settings.telegramBotToken, settings.telegramChatId, message)
      result.telegram = { ok: true, message: 'ส่งตัวอย่างใกล้หมดอายุสำเร็จ' }
    } catch (error) {
      result.telegram = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (settings.lineEnabled) {
    try {
      await sendLine(settings.lineChannelAccessToken, settings.lineTargetId, message)
      result.line = { ok: true, message: 'ส่งตัวอย่างใกล้หมดอายุสำเร็จ' }
    } catch (error) {
      result.line = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (!settings.telegramEnabled && !settings.lineEnabled) {
    throw new Error('กรุณาเปิดใช้งาน Telegram หรือ LINE อย่างน้อยหนึ่งช่องทาง')
  }
  return result
}

export async function runExpirationCheck(db: StockDatabase, scheduled = false): Promise<NotificationTestResult> {
  const settings = db.getNotificationSettings()
  const products = db.productsNeedingAlert()
  const result: NotificationTestResult = {}
  if (products.length === 0) return result
  const messages = buildAlertMessages(products, settings.warningDays)

  if (settings.telegramEnabled && (!scheduled || !db.wasAlertSentToday('telegram'))) {
    try {
      await sendTelegram(settings.telegramBotToken, settings.telegramChatId, messages)
      if (scheduled) db.recordAlertRun('telegram', products.length)
      result.telegram = { ok: true, message: `ส่ง ${products.length} รายการสำเร็จ` }
    } catch (error) {
      result.telegram = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (settings.lineEnabled && (!scheduled || !db.wasAlertSentToday('line'))) {
    try {
      await sendLine(settings.lineChannelAccessToken, settings.lineTargetId, messages)
      if (scheduled) db.recordAlertRun('line', products.length)
      result.line = { ok: true, message: `ส่ง ${products.length} รายการสำเร็จ` }
    } catch (error) {
      result.line = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  return result
}
