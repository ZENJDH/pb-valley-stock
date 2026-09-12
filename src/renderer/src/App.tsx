import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { CategoryOption, CategorySummary, DashboardSummary, ExpirationStatus, InventoryMode, Product, StockActivity, UserRole } from '../../shared/types'
import { CatalogLevelView } from './components/CatalogLevelView'
import { ProductModal } from './components/ProductModal'
import { SettingsModal } from './components/SettingsModal'
import logoPb from '../../../logo-pb.png'

type ActiveTab = 'inventory' | 'expiring' | 'expired' | 'categories'
type StatusFilter = ExpirationStatus | 'all'
type ViewMode = 'table' | 'cards'
type CatalogSection = 'main' | 'sub' | 'products' | null

interface AppProps {
  role?: UserRole
  inventoryMode?: InventoryMode
  onLogout?: () => void
  onManageAccess?: () => void
}

const emptySummary: DashboardSummary = {
  totalProducts: 0,
  totalUnits: 0,
  totalCapacity: 0,
  expired: 0,
  expiring: 0,
  safe: 0
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function displayDate(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(year, month - 1, day))
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
    const date = new Date(iso)
    if (isNaN(date.getTime())) return dateStr
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return 'เมื่อสักครู่'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24 && now.toDateString() === date.toDateString()) {
      return `วันนี้ ${date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`
    }
    return (
      date.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' น.'
    )
  } catch {
    return dateStr
  }
}

function statusLabel(product: Product): string {
  if (product.status === 'expired') {
    const days = Math.abs(product.daysRemaining)
    return days === 0 ? 'หมดอายุวันนี้' : `หมดอายุแล้ว ${days} วัน`
  }
  if (product.status === 'expiring') {
    return product.daysRemaining === 0 ? 'หมดอายุวันนี้' : `เหลือ ${product.daysRemaining} วัน`
  }
  return `เหลือ ${product.daysRemaining} วัน`
}

function expirationBandClass(product: Product): string {
  if (product.status === 'expired') return 'expiry-overdue'
  if (product.daysRemaining <= 10) return 'expiry-critical'
  if (product.daysRemaining <= 20) return 'expiry-high'
  if (product.daysRemaining <= 30) return 'expiry-medium'
  return 'expiry-safe'
}

function urgencyTagText(product: Product): string {
  if (product.status === 'expired') return 'หมดอายุแล้ว'
  if (product.daysRemaining <= 10) return 'ใกล้หมดอายุ'
  if (product.daysRemaining <= 20) return 'เร่งด่วน 11–20 วัน'
  if (product.daysRemaining <= 30) return 'เฝ้าระวัง 21–30 วัน'
  return 'ปกติ (>30 วัน)'
}

function stockHealthClass(product: Product): string {
  if (product.quantity === 0) return 'stock-empty'
  if (product.totalQuantity > 0 && product.quantity / product.totalQuantity <= 0.25) return 'stock-low'
  return 'stock-ready'
}

function stockHealthText(product: Product): string {
  if (product.quantity === 0) return 'หมดสต็อก'
  if (product.totalQuantity > 0 && product.quantity / product.totalQuantity <= 0.25) return 'ควรสั่งเพิ่ม'
  return 'พร้อมใช้งาน'
}

function getCategoryEmoji(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'op') return '⚙️'
  if (lower.includes('ส่งเสริม')) return '🌱'
  if (lower.includes('กาแฟ') || lower.includes('coffee')) return '☕'
  if (lower.includes('โกโก้') || lower.includes('cocoa') || lower.includes('chocolate')) return '🥔'
  if (lower.includes('ชา') || lower.includes('tea')) return '🍵'
  if (lower.includes('ไวน์') || lower.includes('wine')) return '🍷'
  if (lower.includes('น้ำ') || lower.includes('juice') || lower.includes('drink')) return '🧃'
  if (lower.includes('ผง') || lower.includes('powder')) return '🥄'
  if (lower.includes('เมล็ด') || lower.includes('bean') || lower.includes('seed')) return '🫘'
  if (lower.includes('ขนม') || lower.includes('snack') || lower.includes('bakery')) return '🥐'
  return '📦'
}

function getSubcategoryEmoji(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('ผง')) return '🥄'
  if (lower.includes('เมล็ด')) return '🫘'
  if (lower.includes('คั่ว')) return '🔥'
  if (lower.includes('ดริป') || lower.includes('drip')) return '☕'
  if (lower.includes('ซอง') || lower.includes('bag')) return '🛍️'
  if (lower.includes('ขวด') || lower.includes('bottle')) return '🍾'
  return '📁'
}

/* Modern Inline SVG Icons */
const Icons = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" />
    </svg>
  ),
  Expiring: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Expired: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Folder: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  ),
  FolderPlus: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <line x1="12" y1="10" x2="12" y2="16" />
      <line x1="9" y1="13" x2="15" y2="13" />
    </svg>
  ),
  TableView: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  CardView: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Close: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Edit: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Logout: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  Bell: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Import: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Export: () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Package: () => (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  Photo: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  Calendar: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Filter: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  GridDots: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Barcode: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
    </svg>
  ),
  PlusSquare: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  MinusSquare: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  BarChart: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  PackageSolid: () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.78 0l-8-4A2 2 0 0 1 2 16.76V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z" />
    </svg>
  ),
  Camera: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  PlusMini: () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  CheckMini: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function App({ role = 'admin', inventoryMode = 'products', onLogout, onManageAccess }: AppProps = {}) {
  const canAdmin = role === 'admin'
  const canCount = role === 'admin' || role === 'counter'
  const isAgrochemical = inventoryMode === 'agrochemicals'
  const roleLabel = role === 'admin' ? 'Admin' : role === 'counter' ? 'คนนับของ' : 'ผู้ใช้ทั่วไป'
  const inventoryLabel = inventoryMode === 'agrochemicals' ? 'ปุ๋ย/สารเคมี' : 'สินค้า'
  const inventoryTitle = inventoryMode === 'agrochemicals' ? 'คลังปุ๋ยและสารเคมี' : 'คลังสินค้า'
  const [activeTab, setActiveTab] = useState<ActiveTab>('inventory')
  const [catalogSection, setCatalogSection] = useState<CatalogSection>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const savedView = localStorage.getItem('pb_stock_view_mode') as ViewMode | null
    return savedView || (window.matchMedia('(max-width: 760px)').matches ? 'cards' : 'table')
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('pb_theme') as 'light' | 'dark') || 'dark'
  })
  const [products, setProducts] = useState<Product[]>([])
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [summary, setSummary] = useState(emptySummary)
  const [categories, setCategories] = useState<string[]>([])
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([])
  const [categoryTree, setCategoryTree] = useState<CategorySummary[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set())
  const [collapsedSubcategories, setCollapsedSubcategories] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)

  // Modals & Menu States
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [createProductCategory, setCreateProductCategory] = useState('')
  const [createProductSubcategory, setCreateProductSubcategory] = useState('')
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryImage, setNewCategoryImage] = useState<string | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)
  const [subcategoryEditor, setSubcategoryEditor] = useState<{ categoryId: number; mainName: string } | null>(null)
  const [newSubcategoryName, setNewSubcategoryName] = useState('')
  const [newSubcategoryImage, setNewSubcategoryImage] = useState<string | null>(null)
  const [subcategorySaving, setSubcategorySaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inboundModalOpen, setInboundModalOpen] = useState(false)
  const [outboundModalOpen, setOutboundModalOpen] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const [sidebarCatOpen, setSidebarCatOpen] = useState(true)
  const [adjustingId, setAdjustingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)

  // Quick adjust form state for Inbound / Outbound modals
  const [selectedProductId, setSelectedProductId] = useState<number | ''>('')
  const [adjustAmount, setAdjustAmount] = useState<number>(1)
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)
  const [pendingAdjustments, setPendingAdjustments] = useState<Record<number, number>>({})

  const [activities, setActivities] = useState<StockActivity[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [activityFilter, setActivityFilter] = useState<'all' | 'in' | 'out'>('all')
  const bellRef = useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(() => activities.filter((a) => !a.isRead).length, [activities])

  const filteredActivities = useMemo(() => {
    if (activityFilter === 'in') return activities.filter((a) => a.actionType === 'increase' || a.delta > 0)
    if (activityFilter === 'out') return activities.filter((a) => a.actionType === 'decrease' || a.actionType === 'delete' || a.delta < 0)
    return activities
  }, [activities, activityFilter])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    if (notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [notificationsOpen])

  async function handleToggleNotifications() {
    const nextOpen = !notificationsOpen
    setNotificationsOpen(nextOpen)
    if (nextOpen && unreadCount > 0) {
      try {
        await window.stockApi.activities.markAsRead()
        setActivities((prev) => prev.map((a) => ({ ...a, isRead: true })))
      } catch (err) {
        console.error(err)
      }
    }
  }

  async function handleClearActivities() {
    if (!window.confirm('ลบประวัติการแจ้งเตือนการเคลื่อนไหวสต็อกทั้งหมดหรือไม่?')) return
    try {
      await window.stockApi.activities.clear()
      setActivities([])
      showToast('ล้างประวัติการแจ้งเตือนเรียบร้อยแล้ว')
    } catch (err) {
      showToast(cleanError(err), 'error')
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pb_theme', theme)
  }, [theme])

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message: cleanError(message), kind })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  const switchViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem('pb_stock_view_mode', mode)
  }

  const switchTab = (tab: ActiveTab) => {
    setCatalogSection(null)
    setActiveTab(tab)
    if (tab === 'inventory') {
      setStatus('all')
    } else if (tab === 'expiring') {
      setStatus('expiring')
      setCategory('')
      setSubcategory('')
    } else if (tab === 'expired') {
      setStatus('expired')
      setCategory('')
      setSubcategory('')
    }
  }

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const currentStatusFilter = activeTab === 'expiring' ? 'expiring' : activeTab === 'expired' ? 'expired' : status
      const [nextProducts, nextAllProducts, nextSummary, nextCategories, nextCategoryOptions, nextCategoryTree, nextActivities] = await Promise.all([
        window.stockApi.products.list({
          search,
          category: currentStatusFilter === 'expiring' || currentStatusFilter === 'expired' ? '' : category,
          subcategory: currentStatusFilter === 'expiring' || currentStatusFilter === 'expired' ? '' : subcategory,
          status: currentStatusFilter
        }),
        window.stockApi.products.list(),
        window.stockApi.dashboard.summary(),
        window.stockApi.products.categories(),
        window.stockApi.products.categoryOptions(),
        window.stockApi.categoryManager.list(),
        window.stockApi.activities.list(40).catch(() => [])
      ])
      setProducts(nextProducts)
      setAllProducts(nextAllProducts)
      setSummary(nextSummary)
      setCategories(nextCategories)
      setCategoryOptions(nextCategoryOptions)
      setCategoryTree(nextCategoryTree)
      setActivities(nextActivities)
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      if (!background) setLoading(false)
    }
  }, [search, category, subcategory, status, activeTab, showToast])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 150)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!document.documentElement.hasAttribute('data-web')) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh(true)
    }, 15000)
    const onFocus = () => { void refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const availableSubcategories = useMemo(() => [
    ...new Set(
      categoryOptions
        .filter((option) => !category || option.mainCategory === category)
        .map((option) => option.subcategory)
        .filter(Boolean)
    )
  ], [categoryOptions, category])

  const totalSubcategories = useMemo(
    () => categoryTree.reduce((total, item) => total + item.subcategories.length, 0),
    [categoryTree]
  )

  const urgentItems = useMemo(() => {
    return allProducts
      .filter((p) => p.status === 'expired' || p.status === 'expiring')
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
  }, [allProducts])

  const donutStyle = useMemo(() => {
    if (summary.totalProducts === 0) return { background: '#202730' } as CSSProperties
    const total = Math.max(1, summary.totalProducts)
    const expiredEnd = (summary.expired / total) * 100
    const expiringEnd = expiredEnd + (summary.expiring / total) * 100
    return {
      background: `conic-gradient(#f85149 0 ${expiredEnd}%, #f0883e ${expiredEnd}% ${expiringEnd}%, #10b981 ${expiringEnd}% 100%)`
    } as CSSProperties
  }, [summary])

  const capacityPercent = useMemo(() => {
    if (summary.totalCapacity <= 0) return 0
    return Math.min(100, Math.round((summary.totalUnits / summary.totalCapacity) * 100))
  }, [summary.totalUnits, summary.totalCapacity])

  const agroDepartments = useMemo(() => ['OP', 'โกโก้', 'ส่งเสริม'].map((name) => {
    const items = allProducts.filter((product) => product.category === name)
    return {
      name,
      itemCount: items.length,
      remainingUnits: items.reduce((total, product) => total + product.quantity, 0),
      lowStockCount: items.filter((product) => stockHealthClass(product) !== 'stock-ready').length
    }
  }), [allProducts])

  const lowStockItems = useMemo(() => allProducts
    .filter((product) => stockHealthClass(product) !== 'stock-ready')
    .sort((left, right) => {
      const leftRatio = left.totalQuantity > 0 ? left.quantity / left.totalQuantity : 0
      const rightRatio = right.totalQuantity > 0 ? right.quantity / right.totalQuantity : 0
      return leftRatio - rightRatio
    }), [allProducts])

  const recentOrders = useMemo(() => [...allProducts]
    .sort((left, right) => right.expirationDate.localeCompare(left.expirationDate))
    .slice(0, 3), [allProducts])

  const groupedProducts = useMemo(() => {
    const mainGroups = new Map<string, Map<string, Product[]>>()
    const showCategoryDefinitions = !search && !subcategory && status === 'all'
    if (showCategoryDefinitions) {
      for (const definition of categoryTree) {
        if (category && definition.name !== category) continue
        const subGroups = new Map<string, Product[]>()
        for (const subcategoryItem of definition.subcategories) subGroups.set(subcategoryItem.name, [])
        mainGroups.set(definition.name, subGroups)
      }
    }
    for (const product of products) {
      const mainName = product.category.trim() || 'ไม่ระบุหมวดหมู่หลัก'
      const subName = product.subcategory.trim() || 'ไม่ระบุหมวดหมู่รอง'
      if (category && mainName !== category) continue
      if (subcategory && subName !== subcategory) continue
      if (!mainGroups.has(mainName)) mainGroups.set(mainName, new Map())
      const subGroups = mainGroups.get(mainName)!
      if (!subGroups.has(subName)) subGroups.set(subName, [])
      subGroups.get(subName)!.push(product)
    }
    return [...mainGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([name, subGroups]) => {
        const catDef = categoryTree.find((item) => item.name === name)
        return {
          name,
          id: catDef?.id,
          imageData: catDef?.imageData ?? null,
          products: [...subGroups.values()].flat(),
          subcategories: [...subGroups.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'th'))
            .map(([subName, items]) => {
              const subDef = catDef?.subcategories.find((s) => s.name === subName)
              return {
                name: subName,
                id: subDef?.id,
                imageData: subDef?.imageData ?? null,
                products: items
              }
            })
        }
      })
  }, [products, categoryTree, search, category, subcategory, status])

  const flatStatusView = catalogSection === 'products' || activeTab === 'expiring' || activeTab === 'expired' || status === 'expiring' || status === 'expired'
  const flatStatusProducts = useMemo(() => {
    return [...products].sort((left, right) => {
      if (isAgrochemical) {
        const departmentOrder = ['OP', 'โกโก้', 'ส่งเสริม']
        const departmentDiff = departmentOrder.indexOf(left.category) - departmentOrder.indexOf(right.category)
        if (departmentDiff !== 0) return departmentDiff
        return right.expirationDate.localeCompare(left.expirationDate) || left.name.localeCompare(right.name, 'th')
      }
      if (left.daysRemaining !== right.daysRemaining) return left.daysRemaining - right.daysRemaining
      return left.name.localeCompare(right.name, 'th')
    })
  }, [products, isAgrochemical])

  function clearFilters() {
    setSearch('')
    setCategory('')
    setSubcategory('')
    setStatus('all')
  }

  function showCatalogSection(section: Exclude<CatalogSection, null>) {
    setCatalogSection(section)
    setSearch('')
    setCategory('')
    setSubcategory('')
    setStatus('all')
    setActiveTab(section === 'products' ? 'inventory' : 'categories')
  }

  function toggleCategory(name: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleSubcategory(mainName: string, subName: string) {
    const key = `${mainName}\u0000${subName}`
    setCollapsedSubcategories((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openCreate(categoryName = '', subcategoryName = '') {
    setEditingProduct(null)
    setCreateProductCategory(categoryName)
    setCreateProductSubcategory(subcategoryName)
    setProductModalOpen(true)
  }

  function openCategoryModal() {
    setNewCategoryName('')
    setNewCategoryImage(null)
    setCategoryModalOpen(true)
  }

  async function pickNewCategoryImage() {
    try {
      const result = await window.stockApi.files.pickImage()
      if (result.dataUrl) setNewCategoryImage(result.dataUrl)
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function pickNewSubcategoryImage() {
    try {
      const result = await window.stockApi.files.pickImage()
      if (result.dataUrl) setNewSubcategoryImage(result.dataUrl)
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function pickAndSetMainImage(categoryId: number, name: string) {
    try {
      const result = await window.stockApi.files.pickImage()
      if (!result.dataUrl) return
      await window.stockApi.categoryManager.setMainImage(categoryId, result.dataUrl)
      showToast(`อัปเดตรูปหมวดหมู่ “${name}” เรียบร้อยแล้ว`)
      await refresh(true)
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function pickAndSetSubImage(subcategoryId: number, name: string) {
    try {
      const result = await window.stockApi.files.pickImage()
      if (!result.dataUrl) return
      await window.stockApi.categoryManager.setSubcategoryImage(subcategoryId, result.dataUrl)
      showToast(`อัปเดตรูปหมวดหมู่รอง “${name}” เรียบร้อยแล้ว`)
      await refresh(true)
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  function openEdit(product: Product) {
    setEditingProduct(product)
    setCreateProductCategory('')
    setCreateProductSubcategory('')
    setProductModalOpen(true)
  }

  function openSubcategoryModal(mainName: string) {
    const definition = categoryTree.find((item) => item.name === mainName)
    if (!definition) return
    setNewSubcategoryName('')
    setNewSubcategoryImage(null)
    setSubcategoryEditor({ categoryId: definition.id, mainName })
  }

  async function createSubcategory(event: FormEvent) {
    event.preventDefault()
    if (!subcategoryEditor) return
    setSubcategorySaving(true)
    try {
      await window.stockApi.categoryManager.createSubcategory(subcategoryEditor.categoryId, newSubcategoryName, newSubcategoryImage)
      setSubcategoryEditor(null)
      setNewSubcategoryName('')
      setNewSubcategoryImage(null)
      showToast('เพิ่มหมวดหมู่รองแล้ว')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setSubcategorySaving(false)
    }
  }

  async function createMainCategory(event: FormEvent) {
    event.preventDefault()
    setCategorySaving(true)
    try {
      await window.stockApi.categoryManager.createMain(newCategoryName, newCategoryImage)
      setCategoryModalOpen(false)
      setNewCategoryName('')
      setNewCategoryImage(null)
      showToast('เพิ่มหมวดหมู่หลักแล้ว')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setCategorySaving(false)
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`ลบ “${product.name}” ออกจากสต็อกหรือไม่?\nการดำเนินการนี้ย้อนกลับไม่ได้`)) return
    try {
      await window.stockApi.products.remove(product.id)
      showToast(`ลบ${inventoryLabel}แล้ว`)
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  function handleStepDraft(product: Product, delta: -1 | 1) {
    const currentQty = pendingAdjustments[product.id] ?? product.quantity
    const nextQty = currentQty + delta
    if (nextQty < 0 || nextQty > product.totalQuantity) return
    if (nextQty === product.quantity) {
      setPendingAdjustments((prev) => {
        const copy = { ...prev }
        delete copy[product.id]
        return copy
      })
    } else {
      setPendingAdjustments((prev) => ({
        ...prev,
        [product.id]: nextQty
      }))
    }
  }

  function handleCancelDraft(productId: number) {
    setPendingAdjustments((prev) => {
      const copy = { ...prev }
      delete copy[productId]
      return copy
    })
  }

  async function handleConfirmDraft(product: Product) {
    const nextQty = pendingAdjustments[product.id]
    if (nextQty === undefined || nextQty === product.quantity) return
    const delta = nextQty - product.quantity
    setAdjustingId(product.id)
    try {
      const updated = await window.stockApi.products.adjustQuantity(product.id, delta)
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setAllProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      handleCancelDraft(product.id)
      showToast(`อัปเดตสต็อก “${product.name}” เป็น ${updated.quantity.toLocaleString('th-TH')} หน่วยเรียบร้อย`)
      await refresh(true)
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setAdjustingId(null)
    }
  }

  async function adjustQuantity(product: Product, delta: -1 | 1) {
    setAdjustingId(product.id)
    try {
      const updated = await window.stockApi.products.adjustQuantity(product.id, delta)
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setAllProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      await refresh(true)
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setAdjustingId(null)
    }
  }

  async function handleBatchAdjust(isOutbound: boolean) {
    if (!selectedProductId) {
      showToast(`กรุณาเลือก${inventoryLabel}`, 'error')
      return
    }
    const targetProduct = allProducts.find((p) => p.id === Number(selectedProductId))
    if (!targetProduct) return
    const delta = isOutbound ? -Math.abs(adjustAmount) : Math.abs(adjustAmount)
    setAdjustSubmitting(true)
    try {
      await window.stockApi.products.adjustQuantity(targetProduct.id, delta as -1 | 1)
      showToast(isOutbound ? `เบิกออก ${adjustAmount} หน่วยสำเร็จ` : `รับเข้า ${adjustAmount} หน่วยสำเร็จ`)
      setInboundModalOpen(false)
      setOutboundModalOpen(false)
      setSelectedProductId('')
      setAdjustAmount(1)
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setAdjustSubmitting(false)
    }
  }

  async function exportFile(format: 'xlsx' | 'csv') {
    try {
      const result = await window.stockApi.files.export(format)
      if (result.path) showToast(`ส่งออกไฟล์แล้ว: ${result.path}`)
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function testExpiringAlert() {
    try {
      const result = await window.stockApi.notifications.testExpiring()
      const entries = Object.entries(result)
      const failed = entries.some(([, value]) => !value.ok)
      showToast(entries.map(([name, value]) => `${name}: ${value.message}`).join(' · '), failed ? 'error' : 'success')
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  function renderProductCardItem(product: Product) {
    const urgencyClass = isAgrochemical ? stockHealthClass(product) : expirationBandClass(product)
    const draftQty = pendingAdjustments[product.id]
    const hasPending = draftQty !== undefined && draftQty !== product.quantity
    const displayQty = draftQty ?? product.quantity
    const stockPercent = product.totalQuantity > 0 ? Math.min(100, (displayQty / product.totalQuantity) * 100) : 0
    const diffDelta = hasPending ? draftQty - product.quantity : 0

    return (
      <div key={product.id} className={`product-bento-card ${urgencyClass}`}>
        {/* 1. Card Top: Thumb + Name + Barcode + Shield Urgency Tag */}
        <div className="card-product-top">
          <div className="card-product-profile">
            <div className={`card-product-thumb ${product.imageData ? 'has-img' : ''}`}>
              {product.imageData ? <img src={product.imageData} alt="" /> : <Icons.PackageSolid />}
            </div>
            <div className="card-product-headings">
              <span className="card-product-name" title={product.name}>{product.name}</span>
              <div className="card-product-subtext">
                {product.barcode && <span className="barcode-tag">{product.barcode}</span>}
              </div>
            </div>
          </div>
          <span className={`urgency-shield-badge ${urgencyClass}`}>
            <span>{isAgrochemical ? '◉' : '🛡️'}</span>
            <span>{isAgrochemical ? stockHealthText(product) : urgencyTagText(product)}</span>
          </span>
        </div>

        {/* 2. Metadata Box: Category, Dates, Notes */}
        <div className="card-product-details-box">
          <div className="card-detail-row">
            <span className="card-detail-label">{isAgrochemical ? 'ฝ่าย / ประเภท:' : 'หมวดหมู่:'}</span>
            <span className="card-detail-val">{product.category || '—'} &gt; {product.subcategory || '—'}</span>
          </div>
          {isAgrochemical ? (
            <div className="card-detail-row">
              <span className="card-detail-label">วันที่สั่งเข้ามา:</span>
              <span className="card-detail-val">{displayDate(product.expirationDate)}</span>
            </div>
          ) : (
            <>
              <div className="card-detail-row">
                <span className="card-detail-label">วันที่ผลิต:</span>
                <span className="card-detail-val">{displayDate(product.manufactureDate)}</span>
              </div>
              <div className="card-detail-row">
                <span className="card-detail-label">วันหมดอายุ (FEFO):</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="card-detail-val">{displayDate(product.expirationDate)}</span>
                  <span className={`exp-remaining-tag ${urgencyClass}`}>
                    ({statusLabel(product)})
                  </span>
                </div>
              </div>
            </>
          )}
          {product.notes && (
            <div className="card-detail-row card-notes-row">
              <span className="card-detail-label">หมายเหตุ:</span>
              <span className="card-detail-val card-notes-val" title={product.notes}>
                {product.notes}
              </span>
            </div>
          )}
        </div>

        {/* 3. Stock Stepper & Capacity Bar */}
        <div className="card-stock-stepper-wrap">
          <div className="card-stock-label-row">
            <span>สต็อกคงเหลือ:</span>
            <span>
              <strong>{displayQty.toLocaleString('th-TH')}</strong>
              {hasPending && (
                <span className={`pending-diff-tag ${diffDelta > 0 ? 'plus' : 'minus'}`}>
                  ({diffDelta > 0 ? `+${diffDelta}` : diffDelta})
                </span>
              )}
              {' '} / {product.totalQuantity.toLocaleString('th-TH')}
            </span>
          </div>
          <div className="card-stock-stepper-row">
            <div className="card-stepper-and-actions">
              <div className={`stepper-box ${hasPending ? 'has-pending' : ''}`}>
                <button
                  type="button"
                  disabled={!canCount || adjustingId === product.id || displayQty <= 0}
                  onClick={() => handleStepDraft(product, -1)}
                  className="stepper-btn minus"
                  title="ลด 1 หน่วย"
                >
                  −
                </button>
                <span className={`stepper-value ${hasPending ? 'pending-val' : ''}`}>
                  {displayQty.toLocaleString('th-TH')}
                </span>
                <button
                  type="button"
                  disabled={!canCount || adjustingId === product.id || displayQty >= product.totalQuantity}
                  onClick={() => handleStepDraft(product, 1)}
                  className="stepper-btn plus"
                  title="เพิ่ม 1 หน่วย"
                >
                  +
                </button>
              </div>

              {hasPending && (
                <div className="stepper-pending-actions">
                  <button
                    type="button"
                    className="stepper-confirm-btn"
                    onClick={() => handleConfirmDraft(product)}
                    disabled={adjustingId === product.id}
                    title={`ยืนยันปรับสต็อกเป็น ${displayQty} หน่วย`}
                  >
                    <Icons.CheckMini />
                    <span>ตกลง</span>
                  </button>
                  <button
                    type="button"
                    className="stepper-cancel-btn"
                    onClick={() => handleCancelDraft(product.id)}
                    disabled={adjustingId === product.id}
                    title="ยกเลิก"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            <div className="card-stock-progress-track">
              <div className="card-stock-progress-fill" style={{ width: `${stockPercent}%` }} />
            </div>
          </div>
        </div>

        {/* 4. Footer Actions (Edit / Delete) */}
        <div className="card-footer-action-row">
          <span style={{ fontSize: '11px', color: '#8b949e' }}>
            ID #{product.id}
          </span>
          <div className="row-action-btns">
            <button type="button" className="row-btn" title={`แก้ไข${inventoryLabel}`} onClick={() => openEdit(product)}>
              <Icons.Edit />
            </button>
            <button type="button" className="row-btn delete-btn" title={`ลบ${inventoryLabel}`} onClick={() => remove(product)}>
              <Icons.Trash />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-layout-root theme-${theme} role-${role} inventory-${inventoryMode}`}>
      {/* 1. LEFT SIDEBAR NAVIGATION */}
      <aside className="app-sidebar">
        <div className="sidebar-top">
          {/* Brand Header */}
          <div className="sidebar-brand" onClick={() => { switchTab('inventory'); clearFilters(); }}>
            <div className="sidebar-monogram">
              <img src={logoPb} alt="PB Valley Chiang Rai" />
            </div>
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-title">
                <span className="brand-name">PB VALLEY</span>
                <span className="brand-badge-gold">CHIANG RAI</span>
              </div>
              <div className="sidebar-brand-sub">{inventoryTitle}</div>
            </div>
          </div>

          {/* Menu Items */}
          <nav className="sidebar-nav" aria-label="เมนูหลัก">
            <button
              className={`sidebar-nav-item ${!catalogSection && activeTab === 'inventory' && !category && status === 'all' && !search ? 'active' : ''}`}
              onClick={() => { switchTab('inventory'); clearFilters(); }}
            >
              <span className="nav-icon"><Icons.Dashboard /></span>
              <span className="nav-label">ภาพรวม</span>
            </button>

            <div className="sidebar-nav-group">
              <button
                type="button"
                className={`sidebar-nav-item ${catalogSection ? 'active' : ''}`}
                onClick={() => {
                  setSidebarCatOpen((prev) => !prev)
                }}
                aria-expanded={sidebarCatOpen}
              >
                <span className="nav-icon"><Icons.Folder /></span>
              <span className="nav-label">{isAgrochemical ? 'ฝ่ายและประเภทวัสดุ' : `หมวดหมู่${inventoryLabel}`}</span>
                <span className="nav-chevron">{sidebarCatOpen ? '⌄' : '›'}</span>
              </button>

              {sidebarCatOpen && (
                <div className="sidebar-subnav">
                  <button
                    type="button"
                    className={`sidebar-subnav-item ${catalogSection === 'main' ? 'active' : ''}`}
                    onClick={() => showCatalogSection('main')}
                  >
                    <span className="subnav-bullet"><Icons.Folder /></span>
                    <span className="subnav-cat-name">{isAgrochemical ? 'ฝ่ายหลัก' : 'หมวดหมู่หลัก'}</span>
                    <span className="subnav-cat-count">{categoryTree.length}</span>
                  </button>

                  <button
                    type="button"
                    className={`sidebar-subnav-item ${catalogSection === 'sub' ? 'active' : ''}`}
                    onClick={() => showCatalogSection('sub')}
                  >
                    <span className="subnav-bullet"><Icons.FolderPlus /></span>
                    <span className="subnav-cat-name">{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}</span>
                    <span className="subnav-cat-count">{totalSubcategories}</span>
                  </button>

                  <button
                    type="button"
                    className={`sidebar-subnav-item ${catalogSection === 'products' ? 'active' : ''}`}
                    onClick={() => showCatalogSection('products')}
                  >
                    <span className="subnav-bullet"><Icons.Package /></span>
                    <span className="subnav-cat-name">{inventoryLabel}</span>
                    <span className="subnav-cat-count">{summary.totalProducts}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              className="sidebar-nav-item"
              onClick={() => {
                if (allProducts.length > 0) setSelectedProductId(allProducts[0].id)
                setInboundModalOpen(true)
              }}
            >
              <span className="nav-icon"><Icons.PlusSquare /></span>
              <span className="nav-label">รับเข้า</span>
            </button>

            <button
              className="sidebar-nav-item"
              onClick={() => {
                if (allProducts.length > 0) setSelectedProductId(allProducts[0].id)
                setOutboundModalOpen(true)
              }}
            >
              <span className="nav-icon"><Icons.MinusSquare /></span>
              <span className="nav-label">เบิกออก</span>
            </button>

            <button
              className="sidebar-nav-item"
              onClick={() => setReportModalOpen(true)}
            >
              <span className="nav-icon"><Icons.BarChart /></span>
              <span className="nav-label">รายงาน</span>
            </button>

            <button
              className="sidebar-nav-item"
              onClick={() => setSettingsOpen(true)}
            >
              <span className="nav-icon"><Icons.Settings /></span>
              <span className="nav-label">ตั้งค่า</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer Profile */}
        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="sidebar-user-avatar">
              <span>{role === 'admin' ? 'A' : 'U'}</span>
            </div>
            <div className="sidebar-user-info">
              <span className="user-name-text">{roleLabel}</span>
              <span className="user-role-text">ผู้ดูแลระบบ</span>
            </div>
          </div>
          {onLogout && (
            <button className="sidebar-logout-btn" onClick={onLogout} title="ออกจากระบบ">
              <Icons.Logout />
              <span>ออกจากระบบ</span>
            </button>
          )}
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <div className="app-main-area">
        {/* Topbar */}
        <header className="main-topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">
              {catalogSection === 'main'
                ? (isAgrochemical ? 'ฝ่ายหลัก' : 'หมวดหมู่หลัก')
                : catalogSection === 'sub'
                  ? (isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง')
                  : catalogSection === 'products' ? inventoryLabel : inventoryTitle}
            </h1>
            <span className={`inventory-mode-pill ${inventoryMode}`}>{inventoryMode === 'agrochemicals' ? 'โหมดปุ๋ย/สารเคมี' : 'โหมดสินค้า'}</span>
            <p className="topbar-subtitle">
              {catalogSection === 'main'
                ? (isAgrochemical ? 'ดูสต็อกที่รับผิดชอบโดย OP, โกโก้ และส่งเสริม' : 'จัดการเฉพาะหมวดหมู่หลักในระบบ')
                : catalogSection === 'sub'
                  ? (isAgrochemical ? 'จัดกลุ่มเป็นปุ๋ย สารเคมี และวัสดุการเกษตร' : 'จัดการเฉพาะหมวดหมู่รองในระบบ')
                  : catalogSection === 'products'
                    ? `แสดงรายการ${inventoryLabel}โดยไม่จัดกลุ่มตามหมวดหมู่`
                    : isAgrochemical
                      ? 'ตรวจนับยอดคงเหลือ แยกฝ่าย และติดตามวันที่สั่งเข้ามา'
                      : `จัดการ${inventoryLabel} หมวดหมู่ และจำนวนคงเหลือในคลัง`}
            </p>
          </div>

          <div className="topbar-right">
            {/* Global Search Bar */}
            <div className="topbar-search-box">
              <span className="topbar-search-icon"><Icons.Search /></span>
              <input
                type="search"
                className="topbar-search-input"
                placeholder={`ค้นหา${inventoryLabel}, หมวดหมู่, รหัส...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Notification Bell & Popover */}
            <div className="topbar-bell-wrapper" ref={bellRef}>
              <button
                type="button"
                className={`topbar-bell-btn ${notificationsOpen ? 'is-active' : ''}`}
                title="การแจ้งเตือนและการเคลื่อนไหวสต็อก"
                onClick={handleToggleNotifications}
              >
                <Icons.Bell />
                {unreadCount > 0 ? (
                  <span className="bell-badge-count">{unreadCount > 99 ? '99+' : unreadCount}</span>
                ) : (
                  !isAgrochemical && (summary.expired > 0 || summary.expiring > 0) && <span className="bell-alert-dot" />
                )}
              </button>

              {notificationsOpen && (
                <div className="topbar-notifications-popover">
                  {/* Header */}
                  <div className="notif-popover-header">
                    <div className="notif-title-row">
                      <div className="notif-title-left">
                        <span className="notif-bell-icon"><Icons.Bell /></span>
                        <div>
                          <div className="notif-title-text">การแจ้งเตือนสต็อก</div>
                          <div className="notif-subtitle-text">ประวัติการเพิ่ม-ลดและเคลื่อนไหวสต็อก</div>
                        </div>
                      </div>
                      {activities.length > 0 && (
                        <button
                          type="button"
                          className="notif-clear-btn"
                          onClick={handleClearActivities}
                          title="ล้างประวัติทั้งหมด"
                        >
                          ล้างประวัติ
                        </button>
                      )}
                    </div>

                    {/* FEFO alert summary banner inside popover */}
                    {!isAgrochemical && (summary.expired > 0 || summary.expiring > 0) && (
                      <div className="notif-fefo-banner">
                        <div className="notif-fefo-text">
                          {summary.expired > 0 && (
                            <button
                              type="button"
                              className="notif-fefo-badge expired"
                              onClick={() => { setNotificationsOpen(false); switchTab('expired'); }}
                            >
                              🔴 หมดอายุ {summary.expired}
                            </button>
                          )}
                          {summary.expiring > 0 && (
                            <button
                              type="button"
                              className="notif-fefo-badge expiring"
                              onClick={() => { setNotificationsOpen(false); switchTab('expiring'); }}
                            >
                              🟠 ใกล้หมดอายุ {summary.expiring}
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          className="notif-test-alert-btn"
                          title="ทดสอบส่งแจ้งเตือน LINE/Telegram"
                          onClick={testExpiringAlert}
                        >
                          ทดสอบเตือน
                        </button>
                      </div>
                    )}

                    {/* Filter Tabs */}
                    <div className="notif-tabs-row">
                      <button
                        type="button"
                        className={`notif-tab ${activityFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setActivityFilter('all')}
                      >
                        ทั้งหมด ({activities.length})
                      </button>
                      <button
                        type="button"
                        className={`notif-tab ${activityFilter === 'in' ? 'active' : ''}`}
                        onClick={() => setActivityFilter('in')}
                      >
                        เพิ่มสต็อก (+)
                      </button>
                      <button
                        type="button"
                        className={`notif-tab ${activityFilter === 'out' ? 'active' : ''}`}
                        onClick={() => setActivityFilter('out')}
                      >
                        ลดสต็อก (−)
                      </button>
                    </div>
                  </div>

                  {/* Activity List */}
                  <div className="notif-items-list">
                    {filteredActivities.length === 0 ? (
                      <div className="notif-empty-state">
                        <span className="notif-empty-icon">📦</span>
                        <span className="notif-empty-title">ไม่มีรายการแจ้งเตือน</span>
                        <span className="notif-empty-sub">เมื่อมีการเพิ่มหรือลด{inventoryLabel} รายการจะแสดงที่นี่</span>
                      </div>
                    ) : (
                      filteredActivities.map((act) => {
                        const isIncrease = act.actionType === 'increase' || act.delta > 0
                        const isCreate = act.actionType === 'create'
                        const isDelete = act.actionType === 'delete'
                        return (
                          <div key={act.id} className={`notif-item ${!act.isRead ? 'unread' : ''}`}>
                            <div className={`notif-action-icon ${isIncrease ? 'icon-in' : isDelete ? 'icon-del' : 'icon-out'}`}>
                              {isIncrease ? '▲' : isDelete ? '✕' : '▼'}
                            </div>
                            <div className="notif-item-body">
                              <div className="notif-item-top">
                                <span className="notif-item-name">{act.productName}</span>
                                <span className={`notif-delta-badge ${isIncrease ? 'delta-in' : isDelete ? 'delta-del' : 'delta-out'}`}>
                                  {isIncrease ? `+${act.delta}` : `${act.delta}`} {act.unit || 'ชิ้น'}
                                </span>
                              </div>
                              <div className="notif-item-desc">
                                {isCreate ? (
                                  <span>เพิ่ม{inventoryLabel}ใหม่ ({act.newQuantity} {act.unit || 'ชิ้น'})</span>
                                ) : isDelete ? (
                                  <span>ลบ{inventoryLabel}ออกจากคลัง</span>
                                ) : (
                                  <span>สต็อก: {act.previousQuantity} → {act.newQuantity} {act.unit || 'ชิ้น'}</span>
                                )}
                              </div>
                              <div className="notif-item-time">{formatRelativeTime(act.createdAt)}</div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Dark Mode Switch */}
            <div
              className="topbar-theme-switch"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
            >
              <span className="theme-switch-icon">☀️</span>
              <span className="theme-switch-label">Dark Mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={theme === 'dark'}
                className={`theme-toggle-track ${theme === 'dark' ? 'is-dark' : ''}`}
              >
                <span className="theme-toggle-thumb" />
              </button>
            </div>
          </div>
        </header>

        {/* Content Body */}
        <main className="main-content-scroll">
          {activeTab === 'categories' ? (
            <CatalogLevelView
              level={catalogSection === 'sub' ? 'sub' : 'main'}
              inventoryMode={inventoryMode}
              categories={categoryTree}
              loading={loading}
              onRefresh={refresh}
              onMessage={showToast}
            />
          ) : (
            <>
              {/* 3. BENTO 4 SUMMARY CARDS */}
              {catalogSection !== 'products' && (
                isAgrochemical ? (
                  <section className="agro-overview-grid" aria-label="ภาพรวมคลังปุ๋ยและสารเคมี">
                    <article className="agro-overview-card agro-total-card">
                      <div className="agro-card-kicker">AGRICULTURAL STORE</div>
                      <div className="agro-total-main">
                        <div>
                          <span className="agro-total-label">คงเหลือรวมทุกฝ่าย</span>
                          <strong>{summary.totalUnits.toLocaleString('th-TH')}</strong>
                          <span className="agro-total-unit">หน่วย</span>
                        </div>
                        <div className="agro-total-ring" style={{ '--stock-level': `${capacityPercent * 3.6}deg` } as CSSProperties}>
                          <span>{capacityPercent}%</span>
                          <small>คงเหลือ</small>
                        </div>
                      </div>
                      <div className="agro-total-foot">
                        <span>{summary.totalProducts.toLocaleString('th-TH')} รายการ</span>
                        <span>ยอดตั้งต้น {summary.totalCapacity.toLocaleString('th-TH')} หน่วย</span>
                      </div>
                    </article>

                    <article className="agro-overview-card agro-department-card">
                      <div className="agro-card-heading">
                        <div>
                          <span className="agro-card-kicker">3 ฝ่ายหลัก</span>
                          <h2>เลือกดูสต็อกตามฝ่าย</h2>
                        </div>
                        <button type="button" className="agro-view-all" onClick={() => { setCategory(''); setSubcategory(''); }}>ดูทั้งหมด</button>
                      </div>
                      <div className="agro-department-list">
                        {agroDepartments.map((department) => (
                          <button
                            key={department.name}
                            type="button"
                            className={`agro-department-row dept-${department.name === 'OP' ? 'op' : department.name === 'โกโก้' ? 'cocoa' : 'extension'} ${category === department.name ? 'active' : ''}`}
                            onClick={() => { setCategory(category === department.name ? '' : department.name); setSubcategory(''); }}
                          >
                            <span className="agro-dept-mark">{department.name === 'OP' ? 'OP' : department.name.slice(0, 1)}</span>
                            <span className="agro-dept-copy"><b>{department.name}</b><small>{department.itemCount} รายการ</small></span>
                            <span className="agro-dept-units"><b>{department.remainingUnits.toLocaleString('th-TH')}</b><small>หน่วยคงเหลือ</small></span>
                            {department.lowStockCount > 0 && <span className="agro-dept-alert">ต้องเติม {department.lowStockCount}</span>}
                          </button>
                        ))}
                      </div>
                    </article>

                    <article className="agro-overview-card agro-attention-card">
                      <div className="agro-card-heading">
                        <div>
                          <span className="agro-card-kicker warning">จุดที่ต้องตรวจ</span>
                          <h2>สต็อกต่ำ / หมดสต็อก</h2>
                        </div>
                        <strong className="agro-alert-count">{lowStockItems.length}</strong>
                      </div>
                      <div className="agro-mini-list">
                        {lowStockItems.slice(0, 3).map((item) => (
                          <button key={item.id} type="button" onClick={() => openEdit(item)}>
                            <span><b>{item.name}</b><small>{item.category} · {item.subcategory}</small></span>
                            <em className={stockHealthClass(item)}>{item.quantity}/{item.totalQuantity}</em>
                          </button>
                        ))}
                        {lowStockItems.length === 0 && <div className="agro-empty-state">ยอดคงเหลือยังอยู่ในระดับพร้อมใช้งาน</div>}
                      </div>
                    </article>

                    <article className="agro-overview-card agro-recent-card">
                      <div className="agro-card-heading">
                        <div>
                          <span className="agro-card-kicker">ORDER HISTORY</span>
                          <h2>รายการสั่งเข้าล่าสุด</h2>
                        </div>
                      </div>
                      <div className="agro-mini-list">
                        {recentOrders.map((item) => (
                          <button key={item.id} type="button" onClick={() => openEdit(item)}>
                            <span><b>{item.name}</b><small>{item.category} · {item.subcategory}</small></span>
                            <time dateTime={item.expirationDate}>{displayDate(item.expirationDate)}</time>
                          </button>
                        ))}
                        {recentOrders.length === 0 && <div className="agro-empty-state">ยังไม่มีรายการสั่งเข้า</div>}
                      </div>
                    </article>
                  </section>
                ) : (
                <section className="bento-cards-grid">
                {/* Card 1: สัดส่วนสถานะสินค้า */}
                <div className="bento-card bento-card-status">
                  <div className="bento-card-header">
                    <div className="header-icon-title">
                      <span className="bento-icon gold"><Icons.GridDots /></span>
                      <span className="bento-card-title">สัดส่วนสถานะสินค้า</span>
                    </div>
                  </div>
                  <div className="bento-status-body">
                    <div className="donut-chart-box" style={donutStyle}>
                      <div className="donut-hole-center">
                        <span className="donut-total-num">{summary.totalProducts.toLocaleString('th-TH')}</span>
                        <span className="donut-total-sub">รายการ</span>
                      </div>
                    </div>
                    <div className="bento-status-legend">
                      <div className="status-legend-item" onClick={() => { switchTab('inventory'); setStatus('safe'); }}>
                        <div className="legend-dot-label">
                          <span className="legend-dot safe" />
                          <span>ปกติ</span>
                        </div>
                        <span className="count-val">{summary.safe}</span>
                      </div>
                      <div className="status-legend-item" onClick={() => switchTab('expiring')}>
                        <div className="legend-dot-label">
                          <span className="legend-dot expiring" />
                          <span>ใกล้หมดอายุ</span>
                        </div>
                        <span className="count-val">{summary.expiring}</span>
                      </div>
                      <div className="status-legend-item" onClick={() => switchTab('expired')}>
                        <div className="legend-dot-label">
                          <span className="legend-dot expired" />
                          <span>หมดอายุ</span>
                        </div>
                        <span className="count-val">{summary.expired}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 2: สินค้าหมดอายุแล้ว */}
                <div className="bento-card bento-card-alert" onClick={() => switchTab('expired')}>
                  <div className="bento-card-header">
                    <div className="header-icon-title">
                      <span className="bento-icon orange"><Icons.AlertTriangle /></span>
                      <span className="bento-card-title">สินค้าหมดอายุแล้ว</span>
                    </div>
                  </div>
                  <div className="bento-alert-body">
                    <div className="alert-hero-row">
                      <span className="big-alert-num">{summary.expired}</span>
                      <div className="alert-hero-copy">
                        <span className="alert-hero-title">รายการหมดอายุแล้ว</span>
                        <span className="alert-hero-sub">ต้องคัดแยกออกจากชั้นวางทันที</span>
                      </div>
                    </div>
                    <div className="alert-items-list">
                      {urgentItems.slice(0, 2).map((item) => (
                        <div key={item.id} className="alert-mini-item" onClick={(e) => { e.stopPropagation(); openEdit(item); }}>
                          <span className="alert-item-name">{item.name}</span>
                          <span className="alert-item-badge">
                            {item.status === 'expired'
                              ? (item.daysRemaining === 0 ? 'หมดอายุวันนี้' : `หมดอายุแล้ว ${Math.abs(item.daysRemaining)} วัน`)
                              : `เหลือ ${item.daysRemaining} วัน`}
                          </span>
                        </div>
                      ))}
                      {urgentItems.length === 0 && (
                        <span className="alert-empty-text">ไม่มีสินค้าที่ต้องคัดแยก</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card 3: ปริมาณสินค้าในคลัง */}
                <div className="bento-card bento-card-capacity">
                  <div className="bento-card-header">
                    <div className="header-icon-title">
                      <span className="bento-icon gold"><Icons.Package /></span>
                      <span className="bento-card-title">ปริมาณสินค้าในคลัง</span>
                    </div>
                  </div>
                  <div className="bento-capacity-body">
                    <div className="capacity-top-row">
                      <div className="cap-left">
                        <span className="cap-label">หน่วยสินค้าคงเหลือ</span>
                        <span className="cap-val">{summary.totalUnits.toLocaleString('th-TH')}</span>
                      </div>
                      <div className="cap-right">
                        <span className="cap-total-label">ความจุรวมทั้งหมด</span>
                        <span className="cap-total-val">{summary.totalCapacity.toLocaleString('th-TH')} หน่วย</span>
                      </div>
                    </div>
                    <div className="capacity-progress-track">
                      <div className="capacity-progress-fill" style={{ width: `${capacityPercent}%` }} />
                    </div>
                    <span className="capacity-bottom-text">
                      ใช้งานไป {capacityPercent}% ของความจุคลัง
                    </span>
                  </div>
                </div>

                {/* Card 4: หมวดหมู่หลักในคลัง */}
                <div className="bento-card bento-card-cats">
                  <div className="bento-card-header">
                    <div className="header-icon-title">
                      <span className="bento-icon gold"><Icons.Folder /></span>
                      <span className="bento-card-title">หมวดหมู่สินค้าในคลัง</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="bento-header-link"
                        style={{ color: '#10b981', fontWeight: 600 }}
                        onClick={openCategoryModal}
                      >
                        + เพิ่มหมวดหมู่
                      </button>
                      <button
                        type="button"
                        className="bento-header-link"
                        onClick={() => showCatalogSection('main')}
                      >
                        จัดการ →
                      </button>
                    </div>
                  </div>
                  <div className="bento-chips-body">
                    {categoryTree.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`bento-cat-chip ${category === cat.name ? 'active' : ''}`}
                        onClick={() => {
                          setCategory(category === cat.name ? '' : cat.name)
                          setSubcategory('')
                        }}
                      >
                        <span>{cat.name}</span>
                        <span className="chip-count">{cat.productCount}</span>
                      </button>
                    ))}
                    {categoryTree.length === 0 && (
                      <span className="alert-empty-text">ยังไม่มีหมวดหมู่</span>
                    )}
                  </div>
                </div>
                </section>
                )
              )}

              {/* 4. CATEGORY FILTER TABS & ACTIONS TOOLBAR */}
              <div className="category-actions-bar">
                {/* Left Category Pills */}
                {catalogSection !== 'products' && <div className="category-filter-pills">
                  <button
                    type="button"
                    className={`cat-pill ${!category ? 'active' : ''}`}
                    onClick={() => { setCategory(''); setSubcategory(''); }}
                  >
                    {isAgrochemical ? 'ทุกฝ่าย' : 'สินค้าทั้งหมด'}
                  </button>
                  {categoryTree.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`cat-pill ${category === cat.name ? 'active' : ''}`}
                      onClick={() => {
                        setCategory(category === cat.name ? '' : cat.name)
                        setSubcategory('')
                      }}
                    >
                      {cat.name} {cat.productCount}
                    </button>
                  ))}
                  {!isAgrochemical && <button
                    type="button"
                    className="cat-pill add-cat-pill"
                    onClick={openCategoryModal}
                    title="เพิ่มหมวดหมู่สินค้าใหม่"
                  >
                    <Icons.PlusMini />
                    <span>+ เพิ่มหมวดหมู่สินค้า</span>
                  </button>}
                </div>}

                {/* Right Action Buttons */}
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className={`action-btn-dark ${filterMenuOpen ? 'active' : ''}`}
                    onClick={() => setFilterMenuOpen((prev) => !prev)}
                    title={isAgrochemical ? 'ตัวกรองประเภทวัสดุ' : 'ตัวกรองสถานะสินค้า'}
                  >
                    <Icons.Filter />
                    <span>ตัวกรอง</span>
                  </button>

                  {/* View Mode Dropdown */}
                  <div className="view-mode-dropdown-wrap">
                    <button
                      type="button"
                      className={`action-btn-dark ${viewDropdownOpen ? 'active' : ''}`}
                      onClick={() => setViewDropdownOpen((prev) => !prev)}
                      title="เลือกรูปแบบมุมมอง (แบบแถว / แบบการ์ด)"
                    >
                      {viewMode === 'table' ? <Icons.TableView /> : <Icons.CardView />}
                      <span>มุมมอง: {viewMode === 'table' ? 'แบบแถว' : 'แบบการ์ด'} ⌄</span>
                    </button>

                    {viewDropdownOpen && (
                      <div className="view-dropdown-menu">
                        <button
                          type="button"
                          className={`view-dropdown-item ${viewMode === 'table' ? 'active' : ''}`}
                          onClick={() => {
                            switchViewMode('table')
                            setViewDropdownOpen(false)
                          }}
                        >
                          <Icons.TableView />
                          <span>แบบแถว (ตาราง)</span>
                          {viewMode === 'table' && <span className="check-mark">✓</span>}
                        </button>
                        <button
                          type="button"
                          className={`view-dropdown-item ${viewMode === 'cards' ? 'active' : ''}`}
                          onClick={() => {
                            switchViewMode('cards')
                            setViewDropdownOpen(false)
                          }}
                        >
                          <Icons.CardView />
                          <span>แบบการ์ด</span>
                          {viewMode === 'cards' && <span className="check-mark">✓</span>}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* + เพิ่มสินค้า Dropdown Menu */}
                  <div className="add-product-dropdown-wrapper">
                    <button
                      type="button"
                      className="add-product-btn-primary"
                      onClick={() => {
                        if (catalogSection === 'products') openCreate()
                        else setCreateMenuOpen((prev) => !prev)
                      }}
                    >
                      <span>+ เพิ่ม{inventoryLabel}</span>
                      {catalogSection !== 'products' && <span className="dropdown-chevron">⌄</span>}
                    </button>

                    {catalogSection !== 'products' && createMenuOpen && (
                      <div className="create-menu-dropdown">
                        {!isAgrochemical && <button
                          type="button"
                          className="create-menu-item"
                          onClick={() => {
                            setCreateMenuOpen(false)
                            openCategoryModal()
                          }}
                        >
                          <Icons.Package />
                          <span>เพิ่มหมวดหมู่หลัก</span>
                        </button>}
                        <button
                          type="button"
                          className="create-menu-item"
                          onClick={() => {
                            setCreateMenuOpen(false)
                            openSubcategoryModal(category || categoryTree[0]?.name || '')
                          }}
                        >
                          <Icons.FolderPlus />
                          <span>{isAgrochemical ? 'เพิ่มประเภทวัสดุ' : 'เพิ่มหมวดหมู่รอง'}</span>
                        </button>
                        <button
                          type="button"
                          className="create-menu-item"
                          onClick={() => {
                            setCreateMenuOpen(false)
                            openCreate(category, subcategory)
                          }}
                        >
                          <Icons.PlusSquare />
                          <span>เพิ่ม{inventoryLabel}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Subcategory Filter Strip when category is selected */}
              {category && (
                <div className="subcategory-filter-strip">
                  <span className="subcat-strip-label">
                    {isAgrochemical ? 'กำลังแสดงฝ่าย:' : 'กำลังแสดงเฉพาะหมวดหมู่:'} <strong>{category}</strong>
                  </span>
                  <button
                    type="button"
                    className={`subcat-pill ${!subcategory ? 'active' : ''}`}
                    onClick={() => setSubcategory('')}
                  >
                    {isAgrochemical ? 'ทุกประเภทในฝ่ายนี้' : 'ทั้งหมดในหมวดหมู่นี้'} ({products.length})
                  </button>
                  {categoryTree.find((c) => c.name === category)?.subcategories.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      className={`subcat-pill ${subcategory === sub.name ? 'active' : ''}`}
                      onClick={() => setSubcategory(subcategory === sub.name ? '' : sub.name)}
                    >
                      {sub.name} ({sub.productCount})
                    </button>
                  ))}
                  <button
                    type="button"
                    className="subcat-pill add-sub-pill"
                    onClick={() => openSubcategoryModal(category)}
                    title={`+ เพิ่ม${isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}ใน ${category}`}
                  >
                    + เพิ่ม{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}
                  </button>
                  <button
                    type="button"
                    className="subcat-strip-clear"
                    onClick={() => { setCategory(''); setSubcategory(''); }}
                    title="กลับไปดูสินค้าทั้งหมด"
                  >
                    ✕ {isAgrochemical ? 'แสดงทุกฝ่าย' : 'แสดงสินค้าทั้งหมด'}
                  </button>
                </div>
              )}

              {/* Extra Filter Drawer if open */}
              {filterMenuOpen && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#12171e', padding: '10px 16px', borderRadius: '8px', border: '1px solid #1f2732' }}>
                  {!isAgrochemical && <><span style={{ fontSize: '12.5px', color: '#8b949e' }}>กรองสถานะ:</span>
                  <select
                    style={{ background: '#161c24', color: '#f0f6fc', border: '1px solid #252d37', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  >
                    <option value="all">ทุกสถานะ</option>
                    <option value="safe">ปกติ</option>
                    <option value="expiring">ใกล้หมดอายุ</option>
                    <option value="expired">หมดอายุแล้ว</option>
                  </select></>}

                  {availableSubcategories.length > 0 && (
                    <>
                      <span style={{ fontSize: '12.5px', color: '#8b949e' }}>{isAgrochemical ? 'ประเภทวัสดุ:' : 'หมวดหมู่รอง:'}</span>
                      <select
                        style={{ background: '#161c24', color: '#f0f6fc', border: '1px solid #252d37', borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
                        value={subcategory}
                        onChange={(e) => setSubcategory(e.target.value)}
                      >
                        <option value="">ทั้งหมด</option>
                        {availableSubcategories.map((sub) => (
                          <option key={sub} value={sub}>{sub}</option>
                        ))}
                      </select>
                    </>
                  )}

                  <button
                    type="button"
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '12.5px' }}
                    onClick={clearFilters}
                  >
                    ล้างตัวกรอง
                  </button>
                </div>
              )}

              {/* 5. GROUPED 7-COLUMN HIERARCHICAL INVENTORY TABLE */}
              <div className="inventory-table-card">
                <div className="table-card-topbar">
                  <div className="table-card-header-line">
                    <div className="table-header-title-box">
                      <div className="table-brand-icon">
                        <Icons.PackageSolid />
                      </div>
                      <div>
                        <h2>
                          {category ? `รายการ${inventoryLabel}: ${category}` : `รายการ${inventoryLabel}`}
                          {subcategory ? ` > ${subcategory}` : ''}
                        </h2>
                        <span className="table-items-count-sub">
                          {loading ? 'กำลังโหลดข้อมูล...' : (
                            category
                              ? `แสดงเฉพาะ${isAgrochemical ? 'ฝ่าย' : 'หมวดหมู่'} “${category}” พบทั้งหมด ${products.length.toLocaleString('th-TH')} รายการ`
                              : `พบทั้งหมด ${products.length.toLocaleString('th-TH')} รายการ`
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="table-in-card-search">
                    <span className="table-search-icon"><Icons.Search /></span>
                    <input
                      type="search"
                      className="table-search-input"
                      placeholder={isAgrochemical ? 'ค้นหาชื่อปุ๋ย/สารเคมี, รหัส, ฝ่าย...' : 'ค้นหาชื่อสินค้า, รหัสสินค้า, หมวดหมู่...'}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button type="button" className="table-search-clear" onClick={() => setSearch('')}>
                        <Icons.Close />
                      </button>
                    )}
                  </div>
                </div>

                {viewMode === 'table' ? (
                  <div className="table-responsive-wrapper">
                  <table className="fefo-hierarchical-table">
                    <thead>
                      <tr>
                        <th className="col-product">{isAgrochemical ? 'รายการและรหัส' : 'สินค้าและบาร์โค้ด'}</th>
                        <th className="col-cats">{isAgrochemical ? 'ฝ่าย / ประเภทวัสดุ' : 'หมวดหมู่หลัก / รอง'}</th>
                        <th className="col-total-qty">จำนวนทั้งหมด</th>
                        <th className="col-stock">สต็อกคงเหลือ</th>
                        {!isAgrochemical && <th className="col-mfg">วันที่ผลิต</th>}
                        <th className="col-exp">{isAgrochemical ? 'วันที่สั่งเข้ามา' : 'วันหมดอายุ (FEFO)'}</th>
                        <th className="col-urgency">{isAgrochemical ? 'สถานะสต็อก' : 'สถานะความเร่งด่วน'}</th>
                        <th className="col-actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {/* Flattened View for Expiring or Expired */}
                      {flatStatusView ? (
                        flatStatusProducts.map((product) => {
                          const urgencyClass = isAgrochemical ? stockHealthClass(product) : expirationBandClass(product)
                          const draftQty = pendingAdjustments[product.id]
                          const hasPending = draftQty !== undefined && draftQty !== product.quantity
                          const displayQty = draftQty ?? product.quantity
                          const stockPercent = product.totalQuantity > 0 ? Math.min(100, (displayQty / product.totalQuantity) * 100) : 0
                          const diffDelta = hasPending ? draftQty - product.quantity : 0

                          return (
                            <tr key={product.id} className={`product-data-row ${urgencyClass}`}>
                              <td className="col-product">
                                <div className="product-info-cell">
                                  <div className={`product-thumb ${product.imageData ? 'has-img' : ''}`}>
                                    {product.imageData ? <img src={product.imageData} alt="" /> : <Icons.PackageSolid />}
                                  </div>
                                  <div className="product-text">
                                    <span className="product-title" title={product.name}>{product.name}</span>
                                    <div className="product-sub">
                                      {product.barcode && <span className="barcode-tag">{product.barcode}</span>}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="col-cats">
                                <span className="cat-breadcrumb">
                                  {product.category || '—'} &gt; {product.subcategory || '—'}
                                </span>
                              </td>
                              <td className="col-total-qty">
                                <span className="total-qty-num">{product.totalQuantity.toLocaleString('th-TH')}</span>
                              </td>
                              <td className="col-stock">
                                <div className="stock-stepper-cell">
                                  <div className="stepper-control-row">
                                    <div className={`stepper-box ${hasPending ? 'has-pending' : ''}`}>
                                      <button
                                        type="button"
                                        disabled={!canCount || adjustingId === product.id || displayQty <= 0}
                                        onClick={() => handleStepDraft(product, -1)}
                                        className="stepper-btn minus"
                                        title="ลด 1 หน่วย"
                                      >
                                        −
                                      </button>
                                      <span className={`stepper-value ${hasPending ? 'pending-val' : ''}`}>
                                        {displayQty.toLocaleString('th-TH')}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={!canCount || adjustingId === product.id || displayQty >= product.totalQuantity}
                                        onClick={() => handleStepDraft(product, 1)}
                                        className="stepper-btn plus"
                                        title="เพิ่ม 1 หน่วย"
                                      >
                                        +
                                      </button>
                                    </div>

                                    {hasPending && (
                                      <div className="stepper-pending-actions">
                                        <button
                                          type="button"
                                          className="stepper-confirm-btn"
                                          onClick={() => handleConfirmDraft(product)}
                                          disabled={adjustingId === product.id}
                                          title={`ยืนยันปรับสต็อกเป็น ${displayQty} หน่วย`}
                                        >
                                          <Icons.CheckMini />
                                          <span>ตกลง</span>
                                        </button>
                                        <button
                                          type="button"
                                          className="stepper-cancel-btn"
                                          onClick={() => handleCancelDraft(product.id)}
                                          disabled={adjustingId === product.id}
                                          title="ยกเลิก"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {hasPending && (
                                    <span className={`pending-diff-tag ${diffDelta > 0 ? 'plus' : 'minus'}`}>
                                      {diffDelta > 0 ? `+${diffDelta}` : diffDelta} หน่วย
                                    </span>
                                  )}

                                  <div className="stock-mini-bar-track">
                                    <div className="stock-mini-bar-fill" style={{ width: `${stockPercent}%` }} />
                                  </div>
                                </div>
                              </td>
                              {!isAgrochemical && <td className="col-mfg">
                                <span className="date-display">{displayDate(product.manufactureDate)}</span>
                              </td>}
                              <td className="col-exp">
                                <div className="exp-cell">
                                  <strong className="exp-date">{displayDate(product.expirationDate)}</strong>
                                  {!isAgrochemical && <span className={`exp-remaining-tag ${urgencyClass}`}>
                                    {statusLabel(product)}
                                  </span>}
                                  {product.notes && (
                                    <span className="exp-notes-text" title={product.notes}>
                                      หมายเหตุ: {product.notes}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="col-urgency">
                                <span className={`urgency-shield-badge ${urgencyClass}`}>
                                  <span>{isAgrochemical ? '◉' : '🛡️'}</span>
                                  <span>{isAgrochemical ? stockHealthText(product) : urgencyTagText(product)}</span>
                                </span>
                              </td>
                              <td className="col-actions">
                                <div className="row-action-btns">
                                  <button type="button" className="row-btn" title={`แก้ไข${inventoryLabel}`} onClick={() => openEdit(product)}>
                                    <Icons.Edit />
                                  </button>
                                  <button type="button" className="row-btn delete-btn" title={`ลบ${inventoryLabel}`} onClick={() => remove(product)}>
                                    <Icons.Trash />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        /* Hierarchical 2-level Grouped View */
                        groupedProducts.map((mainGroup) => {
                          const mainCollapsed = collapsedCategories.has(mainGroup.name)
                          const mainEmoji = getCategoryEmoji(mainGroup.name)

                          return (
                            <Fragment key={`main-${mainGroup.name}`}>
                              {/* Level 1 Main Category Row */}
                              <tr
                                className="category-level-1-row"
                                onClick={() => toggleCategory(mainGroup.name)}
                              >
                                <td colSpan={isAgrochemical ? 4 : 5}>
                                  <div className="cat-row-content">
                                    <span className={`cat-chevron ${mainCollapsed ? 'closed' : ''}`}>⌄</span>
                                    <div className="cat-media-box">
                                      {mainGroup.imageData ? (
                                        <img src={mainGroup.imageData} alt="" className="cat-img-thumb" />
                                      ) : (
                                        <span className="cat-emoji">{mainEmoji}</span>
                                      )}
                                      {canAdmin && mainGroup.id && (
                                        <button
                                          type="button"
                                          className="cat-thumb-upload-btn"
                                          title={`เปลี่ยนรูปหมวดหมู่ “${mainGroup.name}”`}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void pickAndSetMainImage(mainGroup.id!, mainGroup.name)
                                          }}
                                        >
                                          <Icons.Camera />
                                        </button>
                                      )}
                                    </div>
                                    <strong className="cat-name">{mainGroup.name}</strong>
                                    <span className="cat-badge">{mainGroup.products.length} รายการ</span>
                                  </div>
                                </td>
                                <td colSpan={3} className="cat-right-count" onClick={(e) => e.stopPropagation()}>
                                  <div className="cat-actions-cluster">
                                    <span className="cat-total-count-text">{mainGroup.products.length} รายการ</span>
                                    <button
                                      type="button"
                                      className="cat-quick-add-btn primary"
                                      title={`+ เพิ่ม${isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}ใน “${mainGroup.name}”`}
                                      onClick={() => openSubcategoryModal(mainGroup.name)}
                                    >
                                      <Icons.FolderPlus />
                                      <span>+ เพิ่ม{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Level 2 Subcategories */}
                              {!mainCollapsed && mainGroup.subcategories.map((subGroup) => {
                                const subKey = `${mainGroup.name}\u0000${subGroup.name}`
                                const subCollapsed = collapsedSubcategories.has(subKey)
                                const subEmoji = getSubcategoryEmoji(subGroup.name)

                                return (
                                  <Fragment key={`sub-${subKey}`}>
                                    <tr
                                      className="category-level-2-row"
                                      onClick={() => toggleSubcategory(mainGroup.name, subGroup.name)}
                                    >
                                      <td colSpan={isAgrochemical ? 4 : 5}>
                                        <div className="subcat-row-content">
                                          <span className={`subcat-chevron ${subCollapsed ? 'closed' : ''}`}>⌄</span>
                                          <div className="cat-media-box subcat">
                                            {subGroup.imageData ? (
                                              <img src={subGroup.imageData} alt="" className="subcat-img-thumb" />
                                            ) : (
                                              <span className="subcat-emoji">{subEmoji}</span>
                                            )}
                                            {canAdmin && subGroup.id && (
                                              <button
                                                type="button"
                                                className="cat-thumb-upload-btn"
                                                title={`เปลี่ยนรูปหมวดหมู่รอง “${subGroup.name}”`}
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  void pickAndSetSubImage(subGroup.id!, subGroup.name)
                                                }}
                                              >
                                                <Icons.Camera />
                                              </button>
                                            )}
                                          </div>
                                          <strong className="subcat-name">{subGroup.name}</strong>
                                          <span className="subcat-badge">{subGroup.products.length} รายการ</span>
                                        </div>
                                      </td>
                                      <td colSpan={3} className="subcat-right-count" onClick={(e) => e.stopPropagation()}>
                                        <div className="cat-actions-cluster">
                                          <span className="cat-total-count-text">{subGroup.products.length} รายการ</span>
                                          <button
                                            type="button"
                                            className="cat-quick-add-btn primary"
                                            title={`+ เพิ่ม${inventoryLabel}ใน ${mainGroup.name} > ${subGroup.name}`}
                                            onClick={() => openCreate(mainGroup.name, subGroup.name)}
                                          >
                                            <Icons.PlusMini />
                                            <span>+ เพิ่ม{inventoryLabel}</span>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>

                                    {/* Level 3 Product Rows */}
                                     {!subCollapsed && subGroup.products.map((product) => {
                                       const urgencyClass = isAgrochemical ? stockHealthClass(product) : expirationBandClass(product)
                                       const draftQty = pendingAdjustments[product.id]
                                       const hasPending = draftQty !== undefined && draftQty !== product.quantity
                                       const displayQty = draftQty ?? product.quantity
                                       const stockPercent = product.totalQuantity > 0 ? Math.min(100, (displayQty / product.totalQuantity) * 100) : 0
                                       const diffDelta = hasPending ? draftQty - product.quantity : 0

                                       return (
                                         <tr key={product.id} className={`product-data-row ${urgencyClass}`}>
                                           <td className="col-product">
                                             <div className="product-info-cell">
                                               <div className={`product-thumb ${product.imageData ? 'has-img' : ''}`}>
                                                 {product.imageData ? <img src={product.imageData} alt="" /> : <Icons.PackageSolid />}
                                               </div>
                                               <div className="product-text">
                                                 <span className="product-title" title={product.name}>{product.name}</span>
                                                 <div className="product-sub">
                                                   {product.barcode && <span className="barcode-tag">{product.barcode}</span>}
                                                 </div>
                                               </div>
                                             </div>
                                           </td>

                                           <td className="col-cats">
                                             <span className="cat-breadcrumb">
                                               {product.category || '—'} &gt; {product.subcategory || '—'}
                                             </span>
                                           </td>

                                           <td className="col-total-qty">
                                             <span className="total-qty-num">{product.totalQuantity.toLocaleString('th-TH')}</span>
                                           </td>

                                           <td className="col-stock">
                                             <div className="stock-stepper-cell">
                                               <div className="stepper-control-row">
                                                 <div className={`stepper-box ${hasPending ? 'has-pending' : ''}`}>
                                                   <button
                                                     type="button"
                                                     disabled={!canCount || adjustingId === product.id || displayQty <= 0}
                                                     onClick={() => handleStepDraft(product, -1)}
                                                     className="stepper-btn minus"
                                                     title="ลด 1 หน่วย"
                                                   >
                                                     −
                                                   </button>
                                                   <span className={`stepper-value ${hasPending ? 'pending-val' : ''}`}>
                                                     {displayQty.toLocaleString('th-TH')}
                                                   </span>
                                                   <button
                                                     type="button"
                                                     disabled={!canCount || adjustingId === product.id || displayQty >= product.totalQuantity}
                                                     onClick={() => handleStepDraft(product, 1)}
                                                     className="stepper-btn plus"
                                                     title="เพิ่ม 1 หน่วย"
                                                   >
                                                     +
                                                   </button>
                                                 </div>

                                                 {hasPending && (
                                                   <div className="stepper-pending-actions">
                                                     <button
                                                       type="button"
                                                       className="stepper-confirm-btn"
                                                       onClick={() => handleConfirmDraft(product)}
                                                       disabled={adjustingId === product.id}
                                                       title={`ยืนยันปรับสต็อกเป็น ${displayQty} หน่วย`}
                                                     >
                                                       <Icons.CheckMini />
                                                       <span>ตกลง</span>
                                                     </button>
                                                     <button
                                                       type="button"
                                                       className="stepper-cancel-btn"
                                                       onClick={() => handleCancelDraft(product.id)}
                                                       disabled={adjustingId === product.id}
                                                       title="ยกเลิก"
                                                     >
                                                       ✕
                                                     </button>
                                                   </div>
                                                 )}
                                               </div>

                                               {hasPending && (
                                                 <span className={`pending-diff-tag ${diffDelta > 0 ? 'plus' : 'minus'}`}>
                                                   {diffDelta > 0 ? `+${diffDelta}` : diffDelta} หน่วย
                                                 </span>
                                               )}

                                               <div className="stock-mini-bar-track">
                                                 <div className="stock-mini-bar-fill" style={{ width: `${stockPercent}%` }} />
                                               </div>
                                             </div>
                                           </td>

                                          {!isAgrochemical && <td className="col-mfg">
                                            <span className="date-display">{displayDate(product.manufactureDate)}</span>
                                          </td>}

                                          <td className="col-exp">
                                            <div className="exp-cell">
                                              <strong className="exp-date">{displayDate(product.expirationDate)}</strong>
                                              {!isAgrochemical && <span className={`exp-remaining-tag ${urgencyClass}`}>
                                                {statusLabel(product)}
                                              </span>}
                                              {product.notes && (
                                                <span className="exp-notes-text" title={product.notes}>
                                                  หมายเหตุ: {product.notes}
                                                </span>
                                              )}
                                            </div>
                                          </td>

                                          <td className="col-urgency">
                                            <span className={`urgency-shield-badge ${urgencyClass}`}>
                                              <span>{isAgrochemical ? '◉' : '🛡️'}</span>
                                              <span>{isAgrochemical ? stockHealthText(product) : urgencyTagText(product)}</span>
                                            </span>
                                          </td>

                                          <td className="col-actions">
                                            <div className="row-action-btns">
                                              <button type="button" className="row-btn" title={`แก้ไข${inventoryLabel}`} onClick={() => openEdit(product)}>
                                                <Icons.Edit />
                                              </button>
                                              <button type="button" className="row-btn delete-btn" title={`ลบ${inventoryLabel}`} onClick={() => remove(product)}>
                                                <Icons.Trash />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </Fragment>
                                )
                              })}
                            </Fragment>
                          )
                        })
                      )}

                      {/* Empty state in table */}
                      {!loading && products.length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '40px 16px', color: '#8b949e' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '28px' }}>📦</span>
                              <strong>ไม่พบ{inventoryLabel}ในรายการนี้</strong>
                              <span style={{ fontSize: '12px' }}>ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่น</span>
                              <button
                                type="button"
                                className="cat-pill"
                                style={{ marginTop: '8px' }}
                                onClick={clearFilters}
                              >
                                ล้างตัวกรอง
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="inventory-cards-container">
                  {flatStatusView ? (
                    flatStatusProducts.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8b949e' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '32px' }}>📦</span>
                          <strong>ไม่พบ{inventoryLabel}ในรายการนี้</strong>
                          <span style={{ fontSize: '12px' }}>ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่น</span>
                          <button
                            type="button"
                            className="cat-pill"
                            style={{ marginTop: '8px' }}
                            onClick={clearFilters}
                          >
                            ล้างตัวกรอง
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="cards-grid">
                        {flatStatusProducts.map(renderProductCardItem)}
                      </div>
                    )
                  ) : products.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8b949e' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '32px' }}>📦</span>
                        <strong>ไม่พบ{inventoryLabel}ในรายการนี้</strong>
                        <span style={{ fontSize: '12px' }}>ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่น</span>
                        <button
                          type="button"
                          className="cat-pill"
                          style={{ marginTop: '8px' }}
                          onClick={clearFilters}
                        >
                          ล้างตัวกรอง
                        </button>
                      </div>
                    </div>
                  ) : (
                    groupedProducts.map((mainGroup) => {
                      const mainCollapsed = collapsedCategories.has(mainGroup.name)
                      const mainEmoji = getCategoryEmoji(mainGroup.name)

                      return (
                        <div key={`main-card-${mainGroup.name}`} className="cards-category-group">
                          {/* Level 1 Main Category Card Header */}
                          <div
                            className="cards-group-header"
                            onClick={() => toggleCategory(mainGroup.name)}
                          >
                            <div className="cat-row-content">
                              <span className={`cat-chevron ${mainCollapsed ? 'closed' : ''}`}>⌄</span>
                              <div className="cat-media-box">
                                {mainGroup.imageData ? (
                                  <img src={mainGroup.imageData} alt="" className="cat-img-thumb" />
                                ) : (
                                  <span className="cat-emoji">{mainEmoji}</span>
                                )}
                                {canAdmin && mainGroup.id && (
                                  <button
                                    type="button"
                                    className="cat-thumb-upload-btn"
                                    title={`เปลี่ยนรูปหมวดหมู่ “${mainGroup.name}”`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void pickAndSetMainImage(mainGroup.id!, mainGroup.name)
                                    }}
                                  >
                                    <Icons.Camera />
                                  </button>
                                )}
                              </div>
                              <strong className="cat-name">{mainGroup.name}</strong>
                              <span className="cat-badge">{mainGroup.products.length} รายการ</span>
                            </div>
                            <div className="cat-actions-cluster" onClick={(e) => e.stopPropagation()}>
                              <span className="cat-total-count-text">{mainGroup.products.length} รายการ</span>
                              <button
                                type="button"
                                className="cat-quick-add-btn primary"
                                title={`+ เพิ่ม${isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}ใน “${mainGroup.name}”`}
                                onClick={() => openSubcategoryModal(mainGroup.name)}
                              >
                                <Icons.FolderPlus />
                                <span>+ เพิ่ม{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Level 2 Subcategories */}
                          {!mainCollapsed &&
                            mainGroup.subcategories.map((subGroup) => {
                              const subKey = `${mainGroup.name}\u0000${subGroup.name}`
                              const subCollapsed = collapsedSubcategories.has(subKey)
                              const subEmoji = getSubcategoryEmoji(subGroup.name)

                              return (
                                <div key={`sub-card-${subKey}`} className="cards-subgroup-section">
                                  <div
                                    className="cards-subgroup-header"
                                    onClick={() => toggleSubcategory(mainGroup.name, subGroup.name)}
                                  >
                                    <div className="subcat-row-content">
                                      <span className={`subcat-chevron ${subCollapsed ? 'closed' : ''}`}>⌄</span>
                                      <div className="cat-media-box subcat">
                                        {subGroup.imageData ? (
                                          <img src={subGroup.imageData} alt="" className="subcat-img-thumb" />
                                        ) : (
                                          <span className="subcat-emoji">{subEmoji}</span>
                                        )}
                                        {canAdmin && subGroup.id && (
                                          <button
                                            type="button"
                                            className="cat-thumb-upload-btn"
                                            title={`เปลี่ยนรูปหมวดหมู่รอง “${subGroup.name}”`}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              void pickAndSetSubImage(subGroup.id!, subGroup.name)
                                            }}
                                          >
                                            <Icons.Camera />
                                          </button>
                                        )}
                                      </div>
                                      <strong className="subcat-name">{subGroup.name}</strong>
                                      <span className="subcat-badge">{subGroup.products.length} รายการ</span>
                                    </div>
                                    <div className="cat-actions-cluster" onClick={(e) => e.stopPropagation()}>
                                      <span className="cat-total-count-text">{subGroup.products.length} รายการ</span>
                                      <button
                                        type="button"
                                        className="cat-quick-add-btn primary"
                                        title={`+ เพิ่ม${inventoryLabel}ใน ${mainGroup.name} > ${subGroup.name}`}
                                        onClick={() => openCreate(mainGroup.name, subGroup.name)}
                                      >
                                        <Icons.PlusMini />
                                        <span>+ เพิ่ม{inventoryLabel}</span>
                                      </button>
                                    </div>
                                  </div>

                                  {!subCollapsed && (
                                    <div className="cards-grid">
                                      {subGroup.products.map(renderProductCardItem)}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
            </>
          )}
        </main>

        {/* 6. FOOTER */}
        <footer className="app-footer">
          <div className="footer-left">
            <strong>PB VALLEY | Stock Operations</strong>
            <span className="footer-dot">·</span>
            <span>จัดการ{inventoryTitle}อย่างมีประสิทธิภาพ</span>
          </div>
          <div className="footer-right">
            <span>เวอร์ชั่น 1.0.0</span>
            <span className="footer-dot">·</span>
            <span>อัปเดตล่าสุด 10 ก.ย. 2026 22:39</span>
          </div>
        </footer>
      </div>

      {/* MODALS */}
      {/* Product Create / Edit Modal */}
      {productModalOpen && (
        <ProductModal
          product={editingProduct}
          initialCategory={createProductCategory}
          initialSubcategory={createProductSubcategory}
          itemLabel={inventoryLabel}
          inventoryMode={inventoryMode}
          categories={categories}
          categoryOptions={categoryOptions}
          onClose={() => setProductModalOpen(false)}
          onSaved={async () => {
            setProductModalOpen(false)
            showToast(`บันทึก${inventoryLabel}เรียบร้อยแล้ว`)
            await refresh()
          }}
          onError={(message) => showToast(cleanError(message), 'error')}
        />
      )}

      {/* Main Category Create Modal */}
      {categoryModalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCategoryModalOpen(false)}>
          <div className="modal category-editor" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <span className="eyebrow">MAIN CATEGORY</span>
                <h2>เพิ่มหมวดหมู่หลัก</h2>
              </div>
              <button className="icon-button" onClick={() => setCategoryModalOpen(false)}>×</button>
            </div>
            <form onSubmit={createMainCategory}>
              <div className="product-image-field category-image-field">
                <button
                  className={`image-preview ${newCategoryImage ? 'has-image' : ''}`}
                  type="button"
                  onClick={pickNewCategoryImage}
                >
                  {newCategoryImage ? <img src={newCategoryImage} alt="รูปหมวดหมู่" /> : <><span>＋</span><small>เพิ่มรูป</small></>}
                </button>
                <div className="image-field-copy">
                  <strong>รูปหมวดหมู่</strong>
                  <span>ไม่ใส่ก็ได้ ระบบจะแสดงไอคอนตามชื่อแทน</span>
                  <div>
                    <button className="button secondary" type="button" onClick={pickNewCategoryImage}>
                      {newCategoryImage ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                    </button>
                    {newCategoryImage && (
                      <button className="button ghost danger-text" type="button" onClick={() => setNewCategoryImage(null)}>
                        เอารูปออก
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <label className="field">
                <span>ชื่อหมวดหมู่หลัก *</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="เช่น กาแฟ, โกโก้, ชา, ไวน์"
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setCategoryModalOpen(false)}>ยกเลิก</button>
                <button className="button primary" disabled={categorySaving} type="submit">
                  {categorySaving ? 'กำลังบันทึก…' : 'สร้างหมวดหมู่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subcategory Create Modal */}
      {subcategoryEditor && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSubcategoryEditor(null)}>
          <div className="modal category-editor" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <span className="eyebrow">SUBCATEGORY</span>
                <h2>เพิ่ม{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}</h2>
                <p className="modal-subtitle">ภายใต้{isAgrochemical ? 'ฝ่าย' : 'หมวดหมู่หลัก'} “{subcategoryEditor.mainName}”</p>
              </div>
              <button className="icon-button" onClick={() => setSubcategoryEditor(null)}>×</button>
            </div>
            <form onSubmit={createSubcategory}>
              <div className="product-image-field category-image-field">
                <button
                  className={`image-preview ${newSubcategoryImage ? 'has-image' : ''}`}
                  type="button"
                  onClick={pickNewSubcategoryImage}
                >
                  {newSubcategoryImage ? <img src={newSubcategoryImage} alt="รูปหมวดหมู่รอง" /> : <><span>＋</span><small>เพิ่มรูป</small></>}
                </button>
                <div className="image-field-copy">
                  <strong>รูปหมวดหมู่รอง</strong>
                  <span>ไม่ใส่ก็ได้ ระบบจะแสดงไอคอนตามชื่อแทน</span>
                  <div>
                    <button className="button secondary" type="button" onClick={pickNewSubcategoryImage}>
                      {newSubcategoryImage ? 'เปลี่ยนรูป' : 'เลือกรูป'}
                    </button>
                    {newSubcategoryImage && (
                      <button className="button ghost danger-text" type="button" onClick={() => setNewSubcategoryImage(null)}>
                        เอารูปออก
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <label className="field">
                <span>ชื่อ{isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'} *</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={newSubcategoryName}
                  onChange={(e) => setNewSubcategoryName(e.target.value)}
                  placeholder="เช่น ผงกาแฟ, เมล็ดคั่ว, ดริปแบ็ก"
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setSubcategoryEditor(null)}>ยกเลิก</button>
                <button className="button primary" disabled={subcategorySaving} type="submit">
                  {subcategorySaving ? 'กำลังบันทึก…' : `สร้าง${isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inbound Quick Modal (รับเข้า) */}
      {inboundModalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setInboundModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">INBOUND</span>
                <h2>รับเข้า{inventoryLabel}</h2>
                <p className="modal-subtitle">เพิ่มจำนวนสต็อกเข้าคลัง{inventoryLabel}</p>
              </div>
              <button className="icon-button" onClick={() => setInboundModalOpen(false)}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void handleBatchAdjust(false); }}>
              <label className="field" style={{ marginBottom: '14px' }}>
                <span>เลือก{inventoryLabel} *</span>
                <select
                  required
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                >
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (คงเหลือ {p.quantity} / {p.totalQuantity} หน่วย)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: '20px' }}>
                <span>จำนวนที่รับเข้า (หน่วย) *</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(Math.max(1, Number(e.target.value)))}
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setInboundModalOpen(false)}>ยกเลิก</button>
                <button className="button primary" disabled={adjustSubmitting} type="submit">
                  {adjustSubmitting ? 'กำลังบันทึก...' : '+ บันทึกรับเข้า'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Outbound Quick Modal (เบิกออก) */}
      {outboundModalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOutboundModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">OUTBOUND</span>
                <h2>เบิกออก{inventoryLabel}</h2>
                <p className="modal-subtitle">จ่าย{inventoryLabel}ออกจากคลังสต็อก</p>
              </div>
              <button className="icon-button" onClick={() => setOutboundModalOpen(false)}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void handleBatchAdjust(true); }}>
              <label className="field" style={{ marginBottom: '14px' }}>
                <span>เลือก{inventoryLabel} *</span>
                <select
                  required
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                >
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (คงเหลือ {p.quantity} หน่วย)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginBottom: '20px' }}>
                <span>จำนวนที่เบิกออก (หน่วย) *</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(Math.max(1, Number(e.target.value)))}
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setOutboundModalOpen(false)}>ยกเลิก</button>
                <button className="button primary" disabled={adjustSubmitting} style={{ backgroundColor: '#f85149' }} type="submit">
                  {adjustSubmitting ? 'กำลังบันทึก...' : '− ยืนยันการเบิกออก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reports Quick Modal */}
      {reportModalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReportModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">REPORTS & EXPORT</span>
                <h2>รายงานและส่งออกข้อมูล</h2>
                <p className="modal-subtitle">ส่งออกรายงาน{inventoryTitle}เพื่อทำบัญชีหรือตรวจสอบ</p>
              </div>
              <button className="icon-button" onClick={() => setReportModalOpen(false)}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
              <div style={{ background: '#161c24', padding: '14px', borderRadius: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div>
                  <small style={{ color: '#8b949e', fontSize: '11px' }}>จำนวนรายการ{inventoryLabel}ทั้งหมด</small>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f0f6fc' }}>{summary.totalProducts} รายการ</div>
                </div>
                <div>
                  <small style={{ color: '#8b949e', fontSize: '11px' }}>ยอดหน่วย{inventoryLabel}คงเหลือ</small>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981' }}>{summary.totalUnits} หน่วย</div>
                </div>
                <div>
                  <small style={{ color: '#8b949e', fontSize: '11px' }}>{isAgrochemical ? 'สต็อกต่ำ' : 'ใกล้หมดอายุ (FEFO)'}</small>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f0883e' }}>{isAgrochemical ? lowStockItems.filter((item) => item.quantity > 0).length : summary.expiring} รายการ</div>
                </div>
                <div>
                  <small style={{ color: '#8b949e', fontSize: '11px' }}>{isAgrochemical ? 'หมดสต็อก' : 'หมดอายุแล้ว'}</small>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#f85149' }}>{isAgrochemical ? lowStockItems.filter((item) => item.quantity === 0).length : summary.expired} รายการ</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="button primary"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  onClick={() => {
                    setReportModalOpen(false)
                    void exportFile('xlsx')
                  }}
                >
                  <Icons.Export />
                  <span>ส่งออก Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  onClick={() => {
                    setReportModalOpen(false)
                    void exportFile('csv')
                  }}
                >
                  <Icons.Export />
                  <span>ส่งออก CSV (.csv)</span>
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setReportModalOpen(false)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={refresh} onMessage={showToast} />
      )}

      {/* Floating Notification Toast */}
      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span className="toast-icon">{toast.kind === 'success' ? <Icons.Check /> : <Icons.Expired />}</span>
          <span className="toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  )
}
