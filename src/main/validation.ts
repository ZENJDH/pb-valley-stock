import type { NotificationSettingsUpdate, ProductInput } from '../shared/types'
import { isValidIsoDate } from './expiration'

export function validateProduct(raw: ProductInput): ProductInput {
  const name = String(raw.name ?? '').trim()
  const category = String(raw.category ?? '').trim()
  const subcategory = String(raw.subcategory ?? '').trim()
  const totalQuantity = Number(raw.totalQuantity)
  const quantity = Number(raw.quantity)
  const manufactureDate = raw.manufactureDate ? String(raw.manufactureDate) : null
  const expirationDate = String(raw.expirationDate ?? '')
  const barcode = raw.barcode ? String(raw.barcode).trim() : null
  const notes = raw.notes ? String(raw.notes).trim() : null
  const imageData = raw.imageData && String(raw.imageData).startsWith('data:image/') ? String(raw.imageData) : null

  if (!name) throw new Error('กรุณาระบุชื่อสินค้า')
  if (!category) throw new Error('กรุณาระบุหมวดหมู่')
  if (!Number.isInteger(totalQuantity) || totalQuantity < 0) throw new Error('จำนวนทั้งหมดต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('จำนวนคงเหลือต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
  if (quantity > totalQuantity) throw new Error('จำนวนคงเหลือต้องไม่มากกว่าจำนวนทั้งหมด')
  if (!isValidIsoDate(expirationDate)) throw new Error('วันหมดอายุต้องอยู่ในรูปแบบ YYYY-MM-DD')
  if (manufactureDate && !isValidIsoDate(manufactureDate)) throw new Error('วันที่ผลิตไม่ถูกต้อง')
  if (manufactureDate && manufactureDate > expirationDate) throw new Error('วันที่ผลิตต้องไม่อยู่หลังวันหมดอายุ')
  if (name.length > 200 || category.length > 100 || subcategory.length > 100) throw new Error('ชื่อสินค้าหรือหมวดหมู่ยาวเกินกำหนด')

  if (imageData && imageData.length > 1_500_000) throw new Error('รูปภาพมีขนาดใหญ่เกินไป')

  return { name, category, subcategory, totalQuantity, quantity, manufactureDate, expirationDate, barcode, notes, imageData }
}

export function validateSettings(raw: NotificationSettingsUpdate): NotificationSettingsUpdate {
  const warningDays = Number(raw.warningDays)
  const timezone = String(raw.timezone ?? '').trim()
  if (!Number.isInteger(warningDays) || warningDays < 1 || warningDays > 365) {
    throw new Error('จำนวนวันแจ้งเตือนต้องอยู่ระหว่าง 1–365 วัน')
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.alertTime)) throw new Error('เวลาแจ้งเตือนไม่ถูกต้อง')
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format()
  } catch {
    throw new Error('Timezone ไม่ถูกต้อง กรุณาเลือก Asia/Bangkok สำหรับประเทศไทย')
  }
  if (raw.telegramEnabled && !raw.telegramChatId.trim()) throw new Error('กรุณาระบุ Telegram Chat ID')
  if (raw.lineEnabled && !raw.lineTargetId.trim()) throw new Error('กรุณาระบุ LINE User/Group ID')
  if (raw.lineEnabled && !/^[UCR][0-9a-f]{32}$/i.test(raw.lineTargetId.trim())) {
    throw new Error('LINE ID ไม่ถูกต้อง ต้องเป็น U, C หรือ R ตามด้วยตัวอักษร 32 ตัว')
  }
  return { ...raw, timezone, telegramChatId: raw.telegramChatId.trim(), lineTargetId: raw.lineTargetId.trim() }
}
