import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { CategoryOption, CategorySummary, DashboardSummary, ExpirationStatus, Product } from '../../shared/types'
import { ProductModal } from './components/ProductModal'
import { SettingsModal } from './components/SettingsModal'
import pbLogo from '../../../logo-pb.png'

type StatusFilter = ExpirationStatus | 'all'

const emptySummary: DashboardSummary = { totalProducts: 0, totalUnits: 0, totalCapacity: 0, expired: 0, expiring: 0, safe: 0 }

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function displayDate(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day))
}

function statusLabel(product: Product): string {
  if (product.status === 'expired') return `หมดอายุ ${Math.abs(product.daysRemaining)} วัน`
  if (product.status === 'expiring') return product.daysRemaining === 0 ? 'หมดอายุวันนี้' : `เหลือ ${product.daysRemaining} วัน`
  return `เหลือ ${product.daysRemaining} วัน`
}

function expirationBandClass(product: Product): string {
  if (product.status === 'expired') return 'expiry-overdue'
  if (product.daysRemaining <= 10) return 'expiry-critical'
  if (product.daysRemaining <= 20) return 'expiry-high'
  if (product.daysRemaining <= 30) return 'expiry-medium'
  return 'expiry-watch'
}

export default function App() {
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
  const [subcategorySaving, setSubcategorySaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [adjustingId, setAdjustingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message: cleanError(message), kind })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const [nextProducts, nextAllProducts, nextSummary, nextCategories, nextCategoryOptions, nextCategoryTree] = await Promise.all([
        window.stockApi.products.list({ search, category: status === 'expiring' || status === 'expired' ? '' : category, subcategory: status === 'expiring' || status === 'expired' ? '' : subcategory, status }),
        window.stockApi.products.list(),
        window.stockApi.dashboard.summary(),
        window.stockApi.products.categories(),
        window.stockApi.products.categoryOptions(),
        window.stockApi.categoryManager.list()
      ])
      setProducts(nextProducts)
      setAllProducts(nextAllProducts)
      setSummary(nextSummary)
      setCategories(nextCategories)
      setCategoryOptions(nextCategoryOptions)
      setCategoryTree(nextCategoryTree)
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      if (!background) setLoading(false)
    }
  }, [search, category, subcategory, status, showToast])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 150)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!document.documentElement.hasAttribute('data-web')) return
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true) }, 15000)
    const onFocus = () => { void refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  const visibleLabel = useMemo(() => {
    if (loading) return 'กำลังโหลด…'
    return `แสดง ${products.length.toLocaleString('th-TH')} รายการ`
  }, [loading, products.length])

  const availableSubcategories = useMemo(() => [...new Set(categoryOptions
    .filter((option) => !category || option.mainCategory === category)
    .map((option) => option.subcategory)
    .filter(Boolean))], [categoryOptions, category])

  const attentionProducts = useMemo(() => allProducts.filter((product) => product.status === 'expiring').slice(0, 3), [allProducts])
  const donutStyle = useMemo(() => {
    if (summary.totalProducts === 0) return { background: '#e6ece6' } as CSSProperties
    const total = Math.max(1, summary.totalProducts)
    const expiredEnd = (summary.expired / total) * 100
    const expiringEnd = expiredEnd + (summary.expiring / total) * 100
    return { background: `conic-gradient(#ef4b55 0 ${expiredEnd}%, #f39a2e ${expiredEnd}% ${expiringEnd}%, #2cac70 ${expiringEnd}% 100%)` } as CSSProperties
  }, [summary])

  const todayLabel = useMemo(() => new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
  }).format(new Date()), [])

  const groupedProducts = useMemo(() => {
    const mainGroups = new Map<string, Map<string, Product[]>>()
    const showCategoryDefinitions = !search && !subcategory && status === 'all'
    if (showCategoryDefinitions) {
      for (const definition of categoryTree) {
        if (category && definition.name !== category) continue
        const subGroups = new Map<string, Product[]>()
        for (const subcategory of definition.subcategories) subGroups.set(subcategory.name, [])
        mainGroups.set(definition.name, subGroups)
      }
    }
    for (const product of products) {
      const mainName = product.category.trim() || 'ไม่ระบุหมวดหมู่หลัก'
      const subName = product.subcategory.trim() || 'ไม่ระบุหมวดหมู่รอง'
      if (!mainGroups.has(mainName)) mainGroups.set(mainName, new Map())
      const subGroups = mainGroups.get(mainName)!
      if (!subGroups.has(subName)) subGroups.set(subName, [])
      subGroups.get(subName)!.push(product)
    }
    return [...mainGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'th'))
      .map(([name, subGroups]) => ({
        name,
        imageData: categoryTree.find((item) => item.name === name)?.imageData ?? null,
        products: [...subGroups.values()].flat(),
        subcategories: [...subGroups.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'th'))
          .map(([subName, items]) => ({ name: subName, products: items }))
      }))
  }, [products, categoryTree, search, category, subcategory, status])

  const flatStatusView = status === 'expiring' || status === 'expired'
  const flatStatusProducts = useMemo(() => [...products].sort((left, right) => {
    if (left.daysRemaining !== right.daysRemaining) return left.daysRemaining - right.daysRemaining
    return left.name.localeCompare(right.name, 'th')
  }), [products])

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

  async function changeMainCategoryImage(name: string) {
    const definition = categoryTree.find((item) => item.name === name)
    if (!definition) return
    try {
      const result = await window.stockApi.files.pickImage()
      if (!result.dataUrl) return
      await window.stockApi.categoryManager.setMainImage(definition.id, result.dataUrl)
      showToast('บันทึกรูปหมวดหมู่แล้ว')
      await refresh()
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
    setSubcategoryEditor({ categoryId: definition.id, mainName })
  }

  async function createSubcategory(event: FormEvent) {
    event.preventDefault()
    if (!subcategoryEditor) return
    setSubcategorySaving(true)
    try {
      await window.stockApi.categoryManager.createSubcategory(subcategoryEditor.categoryId, newSubcategoryName)
      setSubcategoryEditor(null)
      setNewSubcategoryName('')
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

  async function removeMainCategory(name: string) {
    const definition = categoryTree.find((item) => item.name === name)
    if (!definition) return
    if (!window.confirm(`ลบหมวดหมู่หลัก “${name}” หรือไม่?\nหมวดหมู่รองที่ว่างอยู่ภายในจะถูกลบด้วย`)) return
    try {
      await window.stockApi.categoryManager.removeMain(definition.id)
      showToast('ลบหมวดหมู่หลักแล้ว')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function removeSubcategory(mainName: string, subName: string) {
    const definition = categoryTree.find((item) => item.name === mainName)
      ?.subcategories.find((item) => item.name === subName)
    if (!definition) return
    if (!window.confirm(`ลบหมวดหมู่รอง “${subName}” หรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeSubcategory(definition.id)
      showToast('ลบหมวดหมู่รองแล้ว')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`ลบ “${product.name}” ออกจากสต็อกหรือไม่?\nการดำเนินการนี้ย้อนกลับไม่ได้`)) return
    try {
      await window.stockApi.products.remove(product.id)
      showToast('ลบสินค้าแล้ว')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  async function adjustQuantity(product: Product, delta: -1 | 1) {
    setAdjustingId(product.id)
    try {
      const updated = await window.stockApi.products.adjustQuantity(product.id, delta)
      setProducts((current) => current.map((item) => item.id === updated.id ? updated : item))
      setSummary(await window.stockApi.dashboard.summary())
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setAdjustingId(null)
    }
  }

  async function importFile() {
    try {
      const result = await window.stockApi.files.import()
      if (result.canceled) return
      const details = result.errors.length ? ` ข้าม ${result.skipped} แถว: ${result.errors.slice(0, 2).join(' / ')}` : ''
      showToast(`นำเข้าสำเร็จ ${result.imported} รายการ${details}`, result.errors.length ? 'error' : 'success')
      await refresh()
    } catch (error) {
      showToast(cleanError(error), 'error')
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

  async function runAlerts() {
    try {
      const result = await window.stockApi.notifications.runNow()
      const entries = Object.entries(result)
      if (entries.length === 0) {
        showToast('ไม่มีสินค้าที่หมดอายุหรือใกล้หมดอายุ')
        return
      }
      const failed = entries.some(([, value]) => !value.ok)
      showToast(entries.map(([name, value]) => `${name}: ${value.message}`).join(' · '), failed ? 'error' : 'success')
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

  function renderProductRow(product: Product, nested: boolean) {
    const urgencyClass = flatStatusView ? expirationBandClass(product) : ''
    return (
      <tr key={product.id} className={`product-row row-${product.status} ${nested ? 'nested-product-row' : 'flat-product-row'} ${urgencyClass}`}>
        <td><div className="product-cell"><div className={`product-avatar ${product.status} ${product.imageData ? 'has-image' : ''}`}>{product.imageData ? <img src={product.imageData} alt="" /> : product.name.charAt(0).toUpperCase()}</div><div className="product-copy"><strong>{product.name}</strong><small><span>รหัส</span> {product.barcode || '—'}</small></div></div></td>
        {nested && <td><div className="category-cell"><span className="category-path">{product.category || 'ไม่ระบุ'} › {product.subcategory || 'ไม่ระบุ'}</span></div></td>}
        <td className="number quantity total-quantity">{product.totalQuantity.toLocaleString('th-TH')}</td>
        <td><div className="stock-control"><div className="quantity-stepper"><button disabled={adjustingId === product.id || product.quantity === 0} onClick={() => adjustQuantity(product, -1)} aria-label="ลดจำนวน">−</button><strong>{product.quantity.toLocaleString('th-TH')}</strong><button disabled={adjustingId === product.id || product.quantity >= product.totalQuantity} onClick={() => adjustQuantity(product, 1)} aria-label="เพิ่มจำนวน">+</button></div><span className="stock-meter"><i style={{ width: `${product.totalQuantity > 0 ? (product.quantity / product.totalQuantity) * 100 : 0}%` }} /></span></div></td>
        <td>{displayDate(product.manufactureDate)}</td>
        <td><strong>{displayDate(product.expirationDate)}</strong></td>
        <td><span className={`status-badge ${product.status}`}><i />{statusLabel(product)}</span></td>
        <td><div className="row-actions"><button title="แก้ไขสินค้า" aria-label={`แก้ไข ${product.name}`} onClick={() => openEdit(product)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg></button><button className="danger" title="ลบสินค้า" aria-label={`ลบ ${product.name}`} onClick={() => remove(product)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></button></div></td>
      </tr>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-logo"><img src={pbLogo} alt="PB Valley" /></div><div><strong>PB VALLEY</strong><span>Stock &amp; Expiration</span></div></div>
        <nav>
          <span className="nav-label">เมนูหลัก</span>
          <button className={`nav-item ${status === 'all' ? 'active' : ''}`} onClick={() => { setSearch(''); setCategory(''); setSubcategory(''); setStatus('all') }}><span>▦</span>ภาพรวมสต็อก</button>
          <button className={`nav-item ${status === 'expiring' ? 'active' : ''}`} onClick={() => { setSearch(''); setCategory(''); setSubcategory(''); setStatus('expiring') }}><span>◉</span>ใกล้หมดอายุ <b>{summary.expiring}</b></button>
          <button className={`nav-item ${status === 'expired' ? 'active' : ''}`} onClick={() => { setSearch(''); setCategory(''); setSubcategory(''); setStatus('expired') }}><span>◷</span>หมดอายุแล้ว <b>{summary.expired}</b></button>
          <span className="nav-label tools">เครื่องมือ</span>
          <button className="nav-item" onClick={runAlerts}><span>↗</span>แจ้งเตือนตอนนี้</button>
          <button className="nav-item" onClick={importFile}><span>⇩</span>นำเข้าข้อมูล</button>
          <button className="nav-item" onClick={() => exportFile('xlsx')}><span>⇧</span>ส่งออก Excel</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note"><span className="pulse" /><div><strong>ระบบแจ้งเตือนพร้อมทำงาน</strong><small>ตรวจสอบตามเวลาที่ตั้งค่า</small></div></div>
        <button className="nav-item" onClick={() => setSettingsOpen(true)}><span>⚙</span>ตั้งค่าระบบ</button>
      </aside>

      <main className="main-content">
        <header className="workspace-topbar toolbar-only">
          <div className="workspace-actions">
            <button className="top-action test" onClick={testExpiringAlert} title="ทดสอบข้อความใกล้หมดอายุ"><span>◷</span>ทดสอบแจ้งเตือน</button>
            <button className="top-action" onClick={() => exportFile('csv')} title="ส่งออก CSV">CSV</button>
            <div className="admin-chip"><span>A</span><div><strong>Admin</strong><small>ผู้ดูแลระบบ</small></div></div>
          </div>
        </header>

        <section className="welcome-card">
          <div className="welcome-copy"><span className="welcome-sprout">♧</span><div><h1>สวัสดีครับ Admin</h1><p>นี่คือภาพรวมคลังสินค้าของคุณในวันนี้</p></div></div>
          <div className="welcome-quote"><span>❧</span><strong>“จัดการสต็อกให้ฉลาด<br />ลดของเสีย เพิ่มกำไร”</strong></div>
          <div className="date-card"><span>▣</span><div><strong>{todayLabel.split(' ').slice(1).join(' ')}</strong><small>{todayLabel.split(' ')[0]}</small></div></div>
        </section>

        <section className="stats-grid">
          <article className="stat-card total"><div className="stat-icon">◇</div><div><span>รายการสินค้าทั้งหมด</span><strong>{summary.totalProducts.toLocaleString('th-TH')}</strong><small>จากทั้งหมด {summary.totalCapacity.toLocaleString('th-TH')} หน่วย</small></div><i className="stat-watermark">◇</i></article>
          <article className="stat-card expired"><div className="stat-icon">!</div><div><span>หมดอายุแล้ว</span><strong>{summary.expired.toLocaleString('th-TH')}</strong><small>ควรนำออกจากคลัง</small></div><i className="stat-watermark">!</i></article>
          <article className="stat-card expiring"><div className="stat-icon">◷</div><div><span>ใกล้หมดอายุ</span><strong>{summary.expiring.toLocaleString('th-TH')}</strong><small>อยู่ในช่วงแจ้งเตือน</small></div><i className="stat-watermark">◷</i></article>
          <article className="stat-card safe"><div className="stat-icon">✓</div><div><span>สถานะปกติ</span><strong>{summary.safe.toLocaleString('th-TH')}</strong><small>คงเหลือ {summary.totalUnits.toLocaleString('th-TH')} หน่วย</small></div><i className="stat-watermark">◇</i></article>
        </section>

        {!flatStatusView && <section className="insights-grid">
          <article className="insight-card status-overview">
            <div className="insight-heading"><span className="insight-icon">◇</span><h2>สรุปสถานะสินค้า</h2></div>
            <div className="donut-layout"><div className="status-donut" style={donutStyle}><div><strong>{summary.totalProducts.toLocaleString('th-TH')}</strong><span>รายการ</span></div></div>
              <div className="donut-legend"><span><i className="dot expiring" /><b>ใกล้หมดอายุ</b><em>{summary.expiring}</em></span><span><i className="dot expired" /><b>หมดอายุแล้ว</b><em>{summary.expired}</em></span><span><i className="dot safe" /><b>ปกติ</b><em>{summary.safe}</em></span></div>
            </div>
          </article>

          <article className="insight-card attention-card">
            <div className="insight-heading"><span className="insight-icon orange">●</span><h2>สินค้าใกล้หมดอายุ</h2><button onClick={() => { setSearch(''); setCategory(''); setSubcategory(''); setStatus('expiring') }}>ดูทั้งหมด →</button></div>
            <div className="attention-list">
              {attentionProducts.map((product) => <button key={product.id} className="attention-item" onClick={() => openEdit(product)}>
                <span className={`attention-photo ${product.imageData ? 'has-image' : ''}`}>{product.imageData ? <img src={product.imageData} alt="" /> : product.name.charAt(0).toUpperCase()}</span>
                <span className="attention-name"><strong>{product.name}</strong><small>{product.quantity.toLocaleString('th-TH')} หน่วย · หมดอายุ {displayDate(product.expirationDate)}</small></span>
                <span className={`status-badge ${product.status}`}><i />{statusLabel(product)}</span>
              </button>)}
              {attentionProducts.length === 0 && <div className="mini-empty"><span>✓</span><strong>ไม่มีสินค้าที่ต้องเร่งจัดการ</strong></div>}
            </div>
          </article>

          <article className="insight-card category-overview">
            <div className="insight-heading"><span className="insight-icon">▦</span><h2>หมวดหมู่สินค้า</h2><div className="category-status-legend"><span><i className="dot safe" />ปกติ</span><span><i className="dot expiring" />ใกล้หมดอายุ</span><span><i className="dot expired" />หมดอายุ</span></div></div>
            <div className="category-summary-list" id="category-summary-items">
              {(showAllCategories ? categoryTree : categoryTree.slice(0, 5)).map((item) => {
                const categoryProducts = allProducts.filter((product) => product.category === item.name)
                const statusTotal = Math.max(1, categoryProducts.length)
                const expiredCount = categoryProducts.filter((product) => product.status === 'expired').length
                const expiringCount = categoryProducts.filter((product) => product.status === 'expiring').length
                const safeCount = categoryProducts.filter((product) => product.status === 'safe').length
                return <button key={item.id} onClick={() => { setCategory(item.name); setSubcategory(''); setStatus('all'); setSearch('') }}>
                  <span className={`category-mini-photo ${item.imageData ? 'has-image' : ''}`}>{item.imageData ? <img src={item.imageData} alt="" /> : item.name.charAt(0).toUpperCase()}</span>
                  <strong>{item.name}</strong><span className="category-progress status-progress" title={`ปกติ ${safeCount} · ใกล้หมดอายุ ${expiringCount} · หมดอายุ ${expiredCount}`}><i className="safe" style={{ width: `${(safeCount / statusTotal) * 100}%` }} /><i className="expiring" style={{ width: `${(expiringCount / statusTotal) * 100}%` }} /><i className="expired" style={{ width: `${(expiredCount / statusTotal) * 100}%` }} /></span><small>{item.productCount} รายการ</small>
                </button>
              })}
              {categoryTree.length === 0 && <div className="mini-empty"><strong>ยังไม่มีหมวดหมู่</strong></div>}
            </div>
            {categoryTree.length > 5 && <div className="category-summary-footer"><span>แสดง {showAllCategories ? categoryTree.length : 5} จาก {categoryTree.length} หมวดหมู่</span><button type="button" aria-expanded={showAllCategories} aria-controls="category-summary-items" onClick={() => setShowAllCategories((current) => !current)}>{showAllCategories ? 'ย่อรายการ ↑' : 'ดูทั้งหมด →'}</button></div>}
          </article>
        </section>}

        <section className="inventory-card" id="inventory">
          <div className="inventory-heading"><div className="inventory-title"><span>◇</span><div><h2>{status === 'expiring' ? 'รายการสินค้าใกล้หมดอายุ' : status === 'expired' ? 'รายการสินค้าหมดอายุแล้ว' : 'รายการสินค้า'}</h2><p>{visibleLabel}</p></div></div>{status === 'expiring' ? <div className="urgency-legend"><span><i className="urgency-swatch critical" />0–10 วัน</span><span><i className="urgency-swatch high" />11–20 วัน</span><span><i className="urgency-swatch medium" />21–30 วัน</span><span><i className="urgency-swatch watch" />มากกว่า 30 วัน</span></div> : status === 'expired' ? <div className="urgency-legend"><span><i className="urgency-swatch overdue" />หมดอายุแล้ว</span></div> : <div className="legend"><span><i className="dot expired" />หมดอายุ</span><span><i className="dot expiring" />ใกล้หมดอายุ</span><span><i className="dot safe" />ปกติ</span></div>}</div>
          <div className="filters">
            <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาสินค้า หมวดหมู่ หรือบาร์โค้ด..." />{search && <button type="button" onClick={() => setSearch('')} aria-label="ล้างคำค้นหา">×</button>}</label>
            {!flatStatusView && <select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory('') }}><option value="">ทุกหมวดหมู่หลัก</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            {!flatStatusView && <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}><option value="">ทุกหมวดหมู่รอง</option>{availableSubcategories.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}><option value="all">ทุกสถานะ</option><option value="expired">หมดอายุแล้ว</option><option value="expiring">ใกล้หมดอายุ</option><option value="safe">ปกติ</option></select>
            {(search || category || subcategory || status !== 'all') && <button className="text-button" onClick={() => { setSearch(''); setCategory(''); setSubcategory(''); setStatus('all') }}>ล้างตัวกรอง</button>}
            {!flatStatusView && <button className="button primary inventory-add-category" onClick={openCategoryModal}>＋ เพิ่มหมวดหมู่หลัก</button>}
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>สินค้า</th>{!flatStatusView && <th>หมวดหมู่หลัก / รอง</th>}<th className="number">ทั้งหมด</th><th>คงเหลือ</th><th>วันที่ผลิต</th><th>วันหมดอายุ</th><th>สถานะ</th><th aria-label="การทำงาน" /></tr></thead>
              <tbody>
                {!loading && flatStatusView && flatStatusProducts.map((product) => renderProductRow(product, false))}
                {!loading && !flatStatusView && groupedProducts.map((mainGroup) => {
                  const mainCollapsed = collapsedCategories.has(mainGroup.name)
                  const mainRemaining = mainGroup.products.reduce((sum, item) => sum + item.quantity, 0)
                  const mainTotal = mainGroup.products.reduce((sum, item) => sum + item.totalQuantity, 0)
                  return <Fragment key={`main-${mainGroup.name}`}><tr className="main-group-row"><td colSpan={8}>
                    <div className="main-group-bar">
                      <button className="group-toggle main" onClick={() => toggleCategory(mainGroup.name)} aria-expanded={!mainCollapsed}>
                        <span className={`group-chevron ${mainCollapsed ? '' : 'open'}`}>›</span>
                        <span className={`group-icon ${mainGroup.imageData ? 'has-image' : ''}`}>{mainGroup.imageData ? <img src={mainGroup.imageData} alt="" /> : mainGroup.name.charAt(0).toUpperCase()}</span>
                        <span className="group-name"><small>หมวดหมู่หลัก</small><strong>{mainGroup.name}</strong></span>
                        <span className="group-metrics"><span><b>{mainGroup.products.length.toLocaleString('th-TH')}</b> รายการ</span><i /><span>คงเหลือ <b>{mainRemaining.toLocaleString('th-TH')} / {mainTotal.toLocaleString('th-TH')}</b></span></span>
                      </button>
                      <button className="group-photo-button" title="เลือกหรือเปลี่ยนรูปหมวดหมู่" onClick={() => void changeMainCategoryImage(mainGroup.name)}>▧ รูป</button>
                      <button className="group-add-button" onClick={() => openSubcategoryModal(mainGroup.name)}>＋ เพิ่มหมวดหมู่รอง</button>
                      <button className="group-delete-button main-delete" title="ลบหมวดหมู่หลัก" aria-label={`ลบหมวดหมู่หลัก ${mainGroup.name}`} onClick={() => void removeMainCategory(mainGroup.name)}>×</button>
                    </div>
                  </td></tr>
                  {mainGroup.subcategories.map((subGroup) => {
                    if (mainCollapsed) return null
                    const subKey = `${mainGroup.name}\u0000${subGroup.name}`
                    const subCollapsed = collapsedSubcategories.has(subKey)
                    const subRemaining = subGroup.products.reduce((sum, item) => sum + item.quantity, 0)
                    const subTotal = subGroup.products.reduce((sum, item) => sum + item.totalQuantity, 0)
                    return <Fragment key={`sub-${subKey}`}>
                      <tr className="sub-group-row"><td colSpan={8}>
                        <div className="sub-group-bar">
                          <button className="group-toggle sub" onClick={() => toggleSubcategory(mainGroup.name, subGroup.name)} aria-expanded={!subCollapsed}>
                            <span className={`group-chevron ${subCollapsed ? '' : 'open'}`}>›</span>
                            <span className="group-name"><small>หมวดหมู่รอง</small><strong>{subGroup.name}</strong></span>
                            <span className="group-metrics sub-metrics"><span><b>{subGroup.products.length.toLocaleString('th-TH')}</b> รายการ</span><i /><span>คงเหลือ <b>{subRemaining.toLocaleString('th-TH')} / {subTotal.toLocaleString('th-TH')}</b></span></span>
                          </button>
                          <button className="sub-add-button" onClick={() => openCreate(mainGroup.name, subGroup.name)}>＋ เพิ่มสินค้า</button>
                          <button className="group-delete-button sub-delete" title="ลบหมวดหมู่รอง" aria-label={`ลบหมวดหมู่รอง ${subGroup.name}`} onClick={() => void removeSubcategory(mainGroup.name, subGroup.name)}>×</button>
                        </div>
                      </td></tr>
                      {!subCollapsed && subGroup.products.map((product) => renderProductRow(product, true))}
                      {!subCollapsed && subGroup.products.length === 0 && <tr className="empty-subgroup-row"><td colSpan={8}><span>ยังไม่มีสินค้าในหมวดหมู่รองนี้</span><button onClick={() => openCreate(mainGroup.name, subGroup.name)}>＋ เพิ่มสินค้ารายการแรก</button></td></tr>}
                    </Fragment>
                  })}
                  {!mainCollapsed && mainGroup.subcategories.length === 0 && <tr className="empty-group-row"><td colSpan={8}><span>ยังไม่มีหมวดหมู่รอง</span><button onClick={() => openSubcategoryModal(mainGroup.name)}>＋ เพิ่มหมวดหมู่รอง</button></td></tr>}
                  </Fragment>
                })}
                {!loading && flatStatusView && flatStatusProducts.length === 0 && <tr><td colSpan={7}><div className="empty-state"><div>✓</div><strong>ไม่พบสินค้าที่ตรงกับตัวกรอง</strong><span>{status === 'expired' ? 'รายการสินค้าหมดอายุแล้ว' : 'รายการสินค้าใกล้หมดอายุ'}</span></div></td></tr>}
                {!loading && !flatStatusView && groupedProducts.length === 0 && <tr><td colSpan={8}><div className="empty-state"><div>▤</div><strong>ยังไม่มีหมวดหมู่หลัก</strong><span>เริ่มต้นโดยสร้างหมวดหมู่หลักก่อน</span><button className="button primary" onClick={openCategoryModal}>＋ เพิ่มหมวดหมู่หลัก</button></div></td></tr>}
                {loading && <tr><td colSpan={flatStatusView ? 7 : 8}><div className="empty-state"><div className="spinner" /><span>กำลังโหลดข้อมูล…</span></div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {productModalOpen && <ProductModal product={editingProduct} initialCategory={createProductCategory} initialSubcategory={createProductSubcategory} categories={categories} categoryOptions={categoryOptions} onClose={() => setProductModalOpen(false)} onSaved={async () => { setProductModalOpen(false); showToast('บันทึกสินค้าแล้ว'); await refresh() }} onError={(message) => showToast(cleanError(message), 'error')} />}
      {subcategoryEditor && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSubcategoryEditor(null)}>
        <div className="modal category-editor" role="dialog" aria-modal="true">
          <div className="modal-header"><div><span className="eyebrow">SUBCATEGORY</span><h2>เพิ่มหมวดหมู่รอง</h2><p className="modal-subtitle">ภายใต้หมวดหมู่หลัก “{subcategoryEditor.mainName}”</p></div><button className="icon-button" onClick={() => setSubcategoryEditor(null)}>×</button></div>
          <form onSubmit={createSubcategory}>
            <label className="field"><span>ชื่อหมวดหมู่รอง *</span><input autoFocus required maxLength={100} value={newSubcategoryName} onChange={(event) => setNewSubcategoryName(event.target.value)} placeholder="เช่น เมล็ดแห้ง หรือ โกโก้ผง" /></label>
            <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setSubcategoryEditor(null)}>ยกเลิก</button><button className="button primary" disabled={subcategorySaving} type="submit">{subcategorySaving ? 'กำลังบันทึก…' : 'สร้างหมวดหมู่รอง'}</button></div>
          </form>
        </div>
      </div>}
      {categoryModalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCategoryModalOpen(false)}>
        <div className="modal category-editor" role="dialog" aria-modal="true">
          <div className="modal-header"><div><span className="eyebrow">MAIN CATEGORY</span><h2>เพิ่มหมวดหมู่หลัก</h2></div><button className="icon-button" onClick={() => setCategoryModalOpen(false)}>×</button></div>
          <form onSubmit={createMainCategory}>
            <div className="product-image-field category-image-field">
              <button className={`image-preview ${newCategoryImage ? 'has-image' : ''}`} type="button" onClick={pickNewCategoryImage}>{newCategoryImage ? <img src={newCategoryImage} alt="ตัวอย่างรูปหมวดหมู่" /> : <><span>＋</span><small>เพิ่มรูป</small></>}</button>
              <div className="image-field-copy"><strong>รูปหมวดหมู่</strong><span>ไม่ใส่ก็ได้ ระบบจะแสดงอักษรตัวแรกแทน</span><div><button className="button secondary" type="button" onClick={pickNewCategoryImage}>{newCategoryImage ? 'เปลี่ยนรูป' : 'เลือกรูป'}</button>{newCategoryImage && <button className="button ghost danger-text" type="button" onClick={() => setNewCategoryImage(null)}>เอารูปออก</button>}</div></div>
            </div>
            <label className="field"><span>ชื่อหมวดหมู่หลัก *</span><input autoFocus required maxLength={100} value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="เช่น โกโก้" /></label>
            <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setCategoryModalOpen(false)}>ยกเลิก</button><button className="button primary" disabled={categorySaving} type="submit">{categorySaving ? 'กำลังบันทึก…' : 'สร้างหมวดหมู่'}</button></div>
          </form>
        </div>
      </div>}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={refresh} onMessage={showToast} />}
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === 'success' ? '✓' : '!'}</span>{toast.message}</div>}
    </div>
  )
}
