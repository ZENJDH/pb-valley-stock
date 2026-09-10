import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function key(): Buffer {
  if (!process.env.PB_SECRET_KEY) throw new Error('Server encryption key is not configured')
  return Buffer.from(process.env.PB_SECRET_KEY, 'hex')
}
export function encryptSecret(value: string): string {
  if (!value) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return 'web:' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}
export function decryptSecret(value: string): string {
  if (!value) return ''
  if (!value.startsWith('web:')) throw new Error('กรุณาตั้งค่า Token ใหม่ในเว็บ')
  const data = Buffer.from(value.slice(4), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}
