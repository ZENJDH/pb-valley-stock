import { safeStorage } from 'electron'

const PREFIX = 'safe:'

export function encryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('ระบบเข้ารหัสของระบบปฏิบัติการยังไม่พร้อม กรุณาปลดล็อกบัญชีผู้ใช้แล้วลองใหม่')
  }
  return PREFIX + safeStorage.encryptString(value).toString('base64')
}

export function decryptSecret(value: string): string {
  if (!value) return ''
  if (!value.startsWith(PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'))
  } catch {
    throw new Error('ไม่สามารถถอดรหัส token ได้ในบัญชีผู้ใช้นี้')
  }
}
