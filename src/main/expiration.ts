import type { ExpirationStatus } from '../shared/types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function localDateSerial(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function todayIso(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function daysUntil(expirationDate: string, today = todayIso()): number {
  return Math.round((localDateSerial(expirationDate) - localDateSerial(today)) / 86_400_000)
}

export function expirationStatus(daysRemaining: number, warningDays: number): ExpirationStatus {
  if (daysRemaining < 0) return 'expired'
  if (daysRemaining <= warningDays) return 'expiring'
  return 'safe'
}
