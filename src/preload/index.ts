import { contextBridge, ipcRenderer } from 'electron'
import type { StockApi } from '../shared/types'

const api: StockApi = {
  products: {
    list: (filters) => ipcRenderer.invoke('products:list', filters),
    create: (input) => ipcRenderer.invoke('products:create', input),
    update: (id, input) => ipcRenderer.invoke('products:update', id, input),
    adjustQuantity: (id, delta) => ipcRenderer.invoke('products:adjustQuantity', id, delta),
    remove: (id) => ipcRenderer.invoke('products:remove', id),
    categories: () => ipcRenderer.invoke('products:categories'),
    categoryOptions: () => ipcRenderer.invoke('products:categoryOptions')
  },
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input)
  },
  notifications: {
    test: () => ipcRenderer.invoke('notifications:test'),
    testExpiring: () => ipcRenderer.invoke('notifications:testExpiring'),
    runNow: () => ipcRenderer.invoke('notifications:runNow')
  },
  files: {
    import: () => ipcRenderer.invoke('files:import'),
    export: (format) => ipcRenderer.invoke('files:export', format),
    pickImage: () => ipcRenderer.invoke('files:pickImage')
  },
  categoryManager: {
    list: () => ipcRenderer.invoke('categories:list'),
    createMain: (name, imageData) => ipcRenderer.invoke('categories:createMain', name, imageData),
    setMainImage: (id, imageData) => ipcRenderer.invoke('categories:setMainImage', id, imageData),
    renameMain: (id, name) => ipcRenderer.invoke('categories:renameMain', id, name),
    removeMain: (id) => ipcRenderer.invoke('categories:removeMain', id),
    createSubcategory: (categoryId, name) => ipcRenderer.invoke('categories:createSubcategory', categoryId, name),
    renameSubcategory: (id, name) => ipcRenderer.invoke('categories:renameSubcategory', id, name),
    removeSubcategory: (id) => ipcRenderer.invoke('categories:removeSubcategory', id)
  }
}

contextBridge.exposeInMainWorld('stockApi', api)
