import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CategorySummary, Product, SubcategorySummary } from '../../../shared/types'

type EditorState =
  | { mode: 'create-main'; title: string; value: string }
  | { mode: 'rename-main'; title: string; id: number; value: string }
  | { mode: 'create-sub'; title: string; categoryId: number; value: string }
  | { mode: 'rename-sub'; title: string; id: number; value: string }

interface Props {
  categories: CategorySummary[]
  products?: Product[]
  loading: boolean
  onRefresh(): Promise<void>
  onViewProducts(category: string, subcategory?: string): void
  onAddProduct?(category: string, subcategory?: string): void
  onMessage(message: string, kind?: 'success' | 'error'): void
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  )
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

const CatIcons = {
  Plus: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Edit: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </svg>
  ),
  Photo: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  Folder: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  ),
  ArrowRight: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  Box: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  )
}

export function CategoryManager({
  categories,
  products = [],
  loading,
  onRefresh,
  onViewProducts,
  onAddProduct,
  onMessage
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [quickSubName, setQuickSubName] = useState('')

  useEffect(() => {
    if (selectedId === null && categories[0]) setSelectedId(categories[0].id)
    if (selectedId !== null && !categories.some((category) => category.id === selectedId)) {
      setSelectedId(categories[0]?.id ?? null)
    }
  }, [categories, selectedId])

  const selected = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? null,
    [categories, selectedId]
  )

  const totalSubcategories = useMemo(
    () => categories.reduce((sum, cat) => sum + cat.subcategories.length, 0),
    [categories]
  )

  const selectedProducts = useMemo(() => {
    if (!selected) return []
    return products.filter((p) => p.category.trim().toLowerCase() === selected.name.trim().toLowerCase())
  }, [selected, products])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!editor) return
    setSaving(true)
    try {
      if (editor.mode === 'create-main') await window.stockApi.categoryManager.createMain(editor.value)
      if (editor.mode === 'rename-main') await window.stockApi.categoryManager.renameMain(editor.id, editor.value)
      if (editor.mode === 'create-sub') await window.stockApi.categoryManager.createSubcategory(editor.categoryId, editor.value)
      if (editor.mode === 'rename-sub') await window.stockApi.categoryManager.renameSubcategory(editor.id, editor.value)
      setEditor(null)
      await onRefresh()
      onMessage('บันทึกหมวดหมู่เรียบร้อยแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickAddSub(e: FormEvent) {
    e.preventDefault()
    if (!selected || !quickSubName.trim()) return
    setSaving(true)
    try {
      await window.stockApi.categoryManager.createSubcategory(selected.id, quickSubName.trim())
      setQuickSubName('')
      await onRefresh()
      onMessage(`เพิ่มหมวดหมู่ย่อย “${quickSubName.trim()}” สำเร็จ`)
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function changeImage(category: CategorySummary) {
    try {
      const picked = await window.stockApi.files.pickImage()
      if (picked.canceled || !picked.dataUrl) return
      await window.stockApi.categoryManager.setMainImage(category.id, picked.dataUrl)
      await onRefresh()
      onMessage(`อัปเดตรูปภาพของหมวดหมู่ “${category.name}” แล้ว`)
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  async function removeMain(category: CategorySummary) {
    if (!window.confirm(`ลบหมวดหมู่หลัก “${category.name}” และหมวดหมู่ย่อยทั้งหมดหรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeMain(category.id)
      await onRefresh()
      onMessage('ลบหมวดหมู่หลักแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  async function removeSubcategory(subcategory: SubcategorySummary) {
    if (!window.confirm(`ลบหมวดหมู่ย่อย “${subcategory.name}” หรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeSubcategory(subcategory.id)
      await onRefresh()
      onMessage('ลบหมวดหมู่ย่อยแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  return (
    <section className="catalog-studio">
      {/* Studio Top Header */}
      <div className="studio-hero-bar">
        <div className="studio-hero-copy">
          <div className="studio-badge">
            <CatIcons.Folder />
            <span>CATEGORY &amp; CATALOG STUDIO</span>
          </div>
          <h2>ศูนย์จัดการหมวดหมู่สินค้า</h2>
          <p>จัดระเบียบหมวดหมู่หลักและหมวดหมู่ย่อยเพื่อการจัดเก็บและติดตาม FEFO อย่างมีประสิทธิภาพ</p>
        </div>

        <div className="studio-stats-summary">
          <div className="stat-pill">
            <span>หมวดหมู่หลัก</span>
            <strong>{categories.length}</strong>
          </div>
          <div className="stat-pill">
            <span>หมวดหมู่ย่อยรวม</span>
            <strong>{totalSubcategories}</strong>
          </div>
          <div className="stat-pill">
            <span>สินค้าทั้งหมด</span>
            <strong>{products.length} รายการ</strong>
          </div>
          <button
            className="action-pill-btn primary"
            onClick={() => setEditor({ mode: 'create-main', title: 'เพิ่มหมวดหมู่สินค้าใหม่', value: '' })}
          >
            <CatIcons.Plus />
            <span>เพิ่มหมวดหมู่สินค้า</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Categories Showcase */}
      <div className="studio-section-title">
        <div className="title-text">
          <h3>หมวดหมู่สินค้า</h3>
          <small>คลิกที่การ์ดเพื่อจัดการหมวดหมู่ย่อยและดูสินค้าภายใน</small>
        </div>
      </div>

      {loading ? (
        <div className="studio-loading-state">
          <div className="spinner" />
          <span>กำลังโหลดข้อมูลหมวดหมู่…</span>
        </div>
      ) : categories.length === 0 ? (
        <div className="studio-empty-hero">
          <div className="empty-icon"><CatIcons.Folder /></div>
          <h3>ยังไม่มีหมวดหมู่สินค้าในระบบ</h3>
          <p>เริ่มต้นสร้างหมวดหมู่สินค้าแรก เช่น กาแฟ, ชา, ไวน์ เพื่อจัดระเบียบคลังสินค้า</p>
          <button
            className="button primary"
            onClick={() => setEditor({ mode: 'create-main', title: 'เพิ่มหมวดหมู่สินค้าใหม่', value: '' })}
          >
            <CatIcons.Plus />
            <span>สร้างหมวดหมู่สินค้าตอนนี้</span>
          </button>
        </div>
      ) : (
        <div className="category-showcase-grid">
          {categories.map((cat, index) => {
            const isSelected = selectedId === cat.id
            return (
              <article
                key={cat.id}
                className={`category-showcase-card ${isSelected ? 'active-deck' : ''} tone-${index % 5}`}
                onClick={() => setSelectedId(cat.id)}
              >
                <div className="card-top-row">
                  <div className="cat-thumbnail-wrap">
                    {cat.imageData ? (
                      <img src={cat.imageData} alt={cat.name} className="cat-cover-img" />
                    ) : (
                      <div className="cat-letter-badge">
                        {cat.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <button
                      className="change-photo-mini-btn"
                      title="เปลี่ยนรูปภาพหมวดหมู่"
                      onClick={(e) => {
                        e.stopPropagation()
                        void changeImage(cat)
                      }}
                    >
                      <CatIcons.Photo />
                    </button>
                  </div>

                  <div className="card-quick-actions">
                    <button
                      className="cat-tool-btn"
                      title="แก้ไขชื่อหมวดหมู่"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditor({ mode: 'rename-main', title: 'แก้ไขหมวดหมู่หลัก', id: cat.id, value: cat.name })
                      }}
                    >
                      <CatIcons.Edit />
                    </button>
                    <button
                      className="cat-tool-btn danger"
                      title="ลบหมวดหมู่หลัก"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeMain(cat)
                      }}
                    >
                      <CatIcons.Trash />
                    </button>
                  </div>
                </div>

                <div className="card-main-meta">
                  <h4 className="cat-card-name">{cat.name}</h4>
                  <div className="cat-pill-tags">
                    <span className="sub-count-tag">{cat.subcategories.length} หมวดหมู่ย่อย</span>
                    <span className="product-count-tag">{cat.productCount} สินค้า</span>
                  </div>
                </div>

                <div className="card-footer-metrics">
                  <div className="units-info">
                    <small>หน่วยสต็อกคงเหลือ</small>
                    <strong>{cat.remainingUnits.toLocaleString('th-TH')} หน่วย</strong>
                  </div>
                  <div className={`select-indicator ${isSelected ? 'is-selected' : ''}`}>
                    {isSelected ? 'กำลังเลือกอยู่' : 'คลิกเพื่อดู'}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Selected Category Deep-Dive Canvas */}
      {selected && (
        <div className="selected-category-canvas">
          <div className="canvas-header">
            <div className="canvas-title-group">
              <div className="parent-tag">หมวดหมู่หลักที่กำลังเลือก</div>
              <h3>{selected.name}</h3>
              <p>มี {selected.subcategories.length} หมวดหมู่ย่อย · รวม {selectedProducts.length} รายการสินค้า</p>
            </div>

            <div className="canvas-actions">
              <button
                className="button secondary"
                onClick={() => onViewProducts(selected.name)}
                title="เปิดดูในหน้ารายการสินค้าทั้งหมด"
              >
                <span>เปิดดูในคลังสินค้า</span>
                <CatIcons.ArrowRight />
              </button>
              {onAddProduct && (
                <button
                  className="button primary"
                  onClick={() => onAddProduct(selected.name)}
                  title="เพิ่มสินค้าชิ้นใหม่เข้าหมวดหมู่นี้"
                >
                  <CatIcons.Plus />
                  <span>เพิ่มสินค้าใน {selected.name}</span>
                </button>
              )}
            </div>
          </div>

          {/* Subcategories Section */}
          <div className="subcategories-deck">
            <div className="sub-deck-header">
              <div className="sub-deck-title">
                <strong>หมวดหมู่ย่อยภายใต้ “{selected.name}”</strong>
                <span>(คลิกเพื่อดูเฉพาะหมวดหมู่ย่อย หรือกดแก้ไข/ลบ)</span>
              </div>

              {/* Inline Quick Add Input */}
              <form className="quick-add-sub-form" onSubmit={handleQuickAddSub}>
                <input
                  type="text"
                  placeholder={`พิมพ์ชื่อหมวดหมู่ย่อยใหม่ เช่น เมล็ดแห้ง, โกโก้ผง...`}
                  value={quickSubName}
                  onChange={(e) => setQuickSubName(e.target.value)}
                  maxLength={60}
                />
                <button type="submit" disabled={saving || !quickSubName.trim()}>
                  <CatIcons.Plus />
                  <span>เพิ่ม</span>
                </button>
              </form>
            </div>

            {/* Subcategories Pills Grid */}
            <div className="sub-chips-container">
              {selected.subcategories.length === 0 ? (
                <div className="sub-empty-hint">
                  <span>ยังไม่มีหมวดหมู่ย่อยในหมวดนี้</span>
                  <div className="sub-suggestion-pills">
                    <small>คำแนะนำ:</small>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickSubName('ทั่วไป')
                      }}
                    >
                      + ทั่วไป
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickSubName('แปรรูป')
                      }}
                    >
                      + แปรรูป
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickSubName('บรรจุภัณฑ์')
                      }}
                    >
                      + บรรจุภัณฑ์
                    </button>
                  </div>
                </div>
              ) : (
                selected.subcategories.map((sub, idx) => (
                  <div key={sub.id} className={`sub-pill-card tone-${idx % 4}`}>
                    <div
                      className="sub-pill-click-area"
                      onClick={() => onViewProducts(selected.name, sub.name)}
                      title={`ดูสินค้าในหมวด ${sub.name}`}
                    >
                      <span className="sub-pill-bullet">#</span>
                      <strong className="sub-pill-title">{sub.name}</strong>
                      <span className="sub-pill-stat">{sub.productCount} รายการ</span>
                    </div>

                    <div className="sub-pill-actions">
                      <button
                        title="แก้ไขชื่อ"
                        onClick={() =>
                          setEditor({ mode: 'rename-sub', title: 'แก้ไขหมวดหมู่ย่อย', id: sub.id, value: sub.name })
                        }
                      >
                        <CatIcons.Edit />
                      </button>
                      <button
                        title="ลบหมวดหมู่นี้"
                        className="danger"
                        onClick={() => void removeSubcategory(sub)}
                      >
                        <CatIcons.Trash />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live Products In This Category Preview */}
          <div className="category-live-products">
            <div className="live-products-bar">
              <div className="live-title">
                <CatIcons.Box />
                <strong>รายการสินค้าในหมวด “{selected.name}”</strong>
                <span className="count-pill">{selectedProducts.length} รายการ</span>
              </div>
              {selectedProducts.length > 0 && (
                <button
                  className="text-link-btn"
                  onClick={() => onViewProducts(selected.name)}
                >
                  ดูทั้งหมดในคลังสินค้า ({selectedProducts.length}) →
                </button>
              )}
            </div>

            {selectedProducts.length === 0 ? (
              <div className="products-empty-prompt">
                <div className="prompt-content">
                  <div className="prompt-icon"><CatIcons.Box /></div>
                  <h4>ยังไม่มีสินค้าในหมวดหมู่นี้</h4>
                  <p>กดปุ่มด้านล่างเพื่อเพิ่มสินค้าชิ้นแรกเข้าสู่หมวดหมู่ “{selected.name}” ได้ทันที</p>
                  {onAddProduct && (
                    <button
                      className="button primary"
                      onClick={() => onAddProduct(selected.name)}
                    >
                      <CatIcons.Plus />
                      <span>เพิ่มสินค้าใหม่เข้า {selected.name}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="live-products-mini-grid">
                {selectedProducts.map((product) => (
                  <article key={product.id} className={`mini-prod-card status-${product.status}`}>
                    <div className="mini-prod-img">
                      {product.imageData ? (
                        <img src={product.imageData} alt="" />
                      ) : (
                        <span>{product.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="mini-prod-info">
                      <strong className="mini-prod-name" title={product.name}>{product.name}</strong>
                      <div className="mini-prod-sub">
                        <span>{product.subcategory || 'ไม่มีหมวดหมู่ย่อย'}</span>
                        <em>คงเหลือ {product.quantity} หน่วย</em>
                      </div>
                      <div className="mini-prod-date">
                        <span>หมดอายุ: {displayDate(product.expirationDate)}</span>
                      </div>
                      {product.notes && (
                        <div className="mini-prod-notes" title={product.notes}>
                          <span>หมายเหตุ: {product.notes}</span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor Modal for Create / Rename */}
      {editor && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditor(null)}>
          <div className="modal category-editor-modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <span className="eyebrow">CATEGORY STUDIO</span>
                <h2>{editor.title}</h2>
              </div>
              <button className="icon-button" onClick={() => setEditor(null)}>×</button>
            </div>
            <form onSubmit={submit}>
              <label className="field">
                <span>ชื่อหมวดหมู่ *</span>
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={editor.value}
                  onChange={(e) => setEditor({ ...editor, value: e.target.value })}
                  placeholder={editor.mode.includes('sub') ? 'เช่น เมล็ดแห้ง หรือ โกโก้ผง' : 'เช่น โกโก้, ไวน์แดง'}
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setEditor(null)}>
                  ยกเลิก
                </button>
                <button className="button primary" disabled={saving} type="submit">
                  {saving ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
