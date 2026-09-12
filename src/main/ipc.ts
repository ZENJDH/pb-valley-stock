import { ipcMain } from 'electron'
import type { NotificationSettingsUpdate, ProductFilters, ProductInput } from '../shared/types'
import type { StockDatabase } from './database'
import { exportProducts, importProducts, pickImage } from './files'
import { runExpirationCheck, testExpirationWarning, testNotifications } from './notifications'
import type { AlertScheduler } from './scheduler'

export function registerIpc(db: StockDatabase, scheduler: AlertScheduler): void {
  ipcMain.handle('products:list', (_event, filters?: ProductFilters) => db.listProducts(filters))
  ipcMain.handle('products:create', (_event, input: ProductInput) => db.createProduct(input))
  ipcMain.handle('products:update', (_event, id: number, input: ProductInput) => db.updateProduct(id, input))
  ipcMain.handle('products:adjustQuantity', (_event, id: number, delta: number) => db.adjustQuantity(id, delta))
  ipcMain.handle('products:remove', (_event, id: number) => db.removeProduct(id))
  ipcMain.handle('products:categories', () => db.categories())
  ipcMain.handle('products:categoryOptions', () => db.categoryOptions())
  ipcMain.handle('dashboard:summary', () => db.summary())
  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:save', (_event, input: NotificationSettingsUpdate) => {
    const settings = db.saveSettings(input)
    scheduler.restart()
    return settings
  })
  ipcMain.handle('notifications:test', () => testNotifications(db))
  ipcMain.handle('notifications:testExpiring', () => testExpirationWarning(db))
  ipcMain.handle('notifications:runNow', () => runExpirationCheck(db, false))
  ipcMain.handle('activities:list', (_event, limit?: number) => db.getActivities(limit))
  ipcMain.handle('activities:markAsRead', () => db.markActivitiesAsRead())
  ipcMain.handle('activities:clear', () => db.clearActivities())
  ipcMain.handle('files:import', () => importProducts(db))
  ipcMain.handle('files:export', (_event, format: 'xlsx' | 'csv') => exportProducts(db, format))
  ipcMain.handle('files:pickImage', () => pickImage())
  ipcMain.handle('categories:list', () => db.listCategoryTree())
  ipcMain.handle('categories:createMain', (_event, name: string, imageData?: string | null) => db.createMainCategory(name, imageData))
  ipcMain.handle('categories:setMainImage', (_event, id: number, imageData: string | null) => db.setMainCategoryImage(id, imageData))
  ipcMain.handle('categories:renameMain', (_event, id: number, name: string) => db.renameMainCategory(id, name))
  ipcMain.handle('categories:removeMain', (_event, id: number) => db.removeMainCategory(id))
  ipcMain.handle('categories:createSubcategory', (_event, categoryId: number, name: string, imageData?: string | null) => db.createSubcategory(categoryId, name, imageData))
  ipcMain.handle('categories:setSubcategoryImage', (_event, id: number, imageData: string | null) => db.setSubcategoryImage(id, imageData))
  ipcMain.handle('categories:renameSubcategory', (_event, id: number, name: string) => db.renameSubcategory(id, name))
  ipcMain.handle('categories:removeSubcategory', (_event, id: number) => db.removeSubcategory(id))
}
