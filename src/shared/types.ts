export type ExpirationStatus = 'expired' | 'expiring' | 'safe'

export interface ProductInput {
  name: string
  category: string
  subcategory: string
  totalQuantity: number
  quantity: number
  manufactureDate: string | null
  expirationDate: string
  barcode: string | null
  notes: string | null
  imageData: string | null
}

export interface Product extends ProductInput {
  id: number
  createdAt: string
  updatedAt: string
  daysRemaining: number
  status: ExpirationStatus
}

export interface ProductFilters {
  search?: string
  category?: string
  subcategory?: string
  status?: ExpirationStatus | 'all'
}

export interface DashboardSummary {
  totalProducts: number
  totalUnits: number
  totalCapacity: number
  expired: number
  expiring: number
  safe: number
}

export interface CategoryOption {
  mainCategory: string
  subcategory: string
}

export interface SubcategorySummary {
  id: number
  name: string
  productCount: number
  remainingUnits: number
}

export interface CategorySummary {
  id: number
  name: string
  imageData: string | null
  productCount: number
  remainingUnits: number
  subcategories: SubcategorySummary[]
}

export interface NotificationSettingsPublic {
  warningDays: number
  alertTime: string
  timezone: string
  telegramEnabled: boolean
  telegramChatId: string
  telegramTokenConfigured: boolean
  lineEnabled: boolean
  lineTargetId: string
  lineTokenConfigured: boolean
}

export interface NotificationSettingsUpdate {
  warningDays: number
  alertTime: string
  timezone: string
  telegramEnabled: boolean
  telegramChatId: string
  telegramBotToken?: string
  clearTelegramToken?: boolean
  lineEnabled: boolean
  lineTargetId: string
  lineChannelAccessToken?: string
  clearLineToken?: boolean
}

export interface NotificationTestResult {
  telegram?: { ok: boolean; message: string }
  line?: { ok: boolean; message: string }
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  canceled?: boolean
}

export interface ExportResult {
  path?: string
  canceled?: boolean
}

export interface StockApi {
  products: {
    list(filters?: ProductFilters): Promise<Product[]>
    create(input: ProductInput): Promise<Product>
    update(id: number, input: ProductInput, expected?: ProductInput): Promise<Product>
    adjustQuantity(id: number, delta: number): Promise<Product>
    remove(id: number): Promise<void>
    categories(): Promise<string[]>
    categoryOptions(): Promise<CategoryOption[]>
  }
  dashboard: {
    summary(): Promise<DashboardSummary>
  }
  settings: {
    get(): Promise<NotificationSettingsPublic>
    save(input: NotificationSettingsUpdate): Promise<NotificationSettingsPublic>
  }
  notifications: {
    test(): Promise<NotificationTestResult>
    testExpiring(): Promise<NotificationTestResult>
    runNow(): Promise<NotificationTestResult>
  }
  files: {
    import(): Promise<ImportResult>
    export(format: 'xlsx' | 'csv'): Promise<ExportResult>
    pickImage(): Promise<{ dataUrl?: string; canceled?: boolean }>
  }
  categoryManager: {
    list(): Promise<CategorySummary[]>
    createMain(name: string, imageData?: string | null): Promise<void>
    setMainImage(id: number, imageData: string | null): Promise<void>
    renameMain(id: number, name: string): Promise<void>
    removeMain(id: number): Promise<void>
    createSubcategory(categoryId: number, name: string): Promise<void>
    renameSubcategory(id: number, name: string): Promise<void>
    removeSubcategory(id: number): Promise<void>
  }
}
