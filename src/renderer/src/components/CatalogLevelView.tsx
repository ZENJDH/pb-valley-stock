import { useMemo, useState, type FormEvent } from 'react'
import type { CategorySummary, InventoryMode, SubcategorySummary } from '../../../shared/types'

type CatalogLevel = 'main' | 'sub'

type EditorState =
  | { mode: 'create-main'; value: string; imageData: string | null }
  | { mode: 'rename-main'; id: number; value: string }
  | { mode: 'create-sub'; parentId: number | ''; value: string; imageData: string | null }
  | { mode: 'rename-sub'; id: number; value: string }

interface Props {
  level: CatalogLevel
  inventoryMode?: InventoryMode
  categories: CategorySummary[]
  loading: boolean
  onRefresh(): Promise<void>
  onMessage(message: string, kind?: 'success' | 'error'): void
}

interface FlatSubcategory extends SubcategorySummary {
  parentId: number
  parentName: string
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  )
}

const LevelIcons = {
  Folder: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  ),
  Layers: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Photo: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
    </svg>
  ),
  Edit: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </svg>
  )
}

export function CatalogLevelView({ level, inventoryMode = 'products', categories, loading, onRefresh, onMessage }: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const isAgrochemical = inventoryMode === 'agrochemicals'

  const subcategories = useMemo<FlatSubcategory[]>(
    () => categories.flatMap((category) => category.subcategories.map((subcategory) => ({
      ...subcategory,
      parentId: category.id,
      parentName: category.name
    }))),
    [categories]
  )

  const items = level === 'main' ? categories : subcategories

  function openCreate() {
    if (level === 'main') {
      if (isAgrochemical) return
      setEditor({ mode: 'create-main', value: '', imageData: null })
      return
    }
    if (!categories[0]) {
      onMessage('กรุณาสร้างหมวดหมู่หลักก่อนเพิ่มหมวดหมู่รอง', 'error')
      return
    }
    setEditor({ mode: 'create-sub', parentId: categories[0].id, value: '', imageData: null })
  }

  async function pickEditorImage() {
    if (!editor || !('imageData' in editor)) return
    try {
      const picked = await window.stockApi.files.pickImage()
      if (picked.canceled || !picked.dataUrl) return
      setEditor({ ...editor, imageData: picked.dataUrl })
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!editor || !editor.value.trim()) return
    setSaving(true)
    try {
      if (editor.mode === 'create-main') {
        await window.stockApi.categoryManager.createMain(editor.value.trim(), editor.imageData)
      } else if (editor.mode === 'rename-main') {
        await window.stockApi.categoryManager.renameMain(editor.id, editor.value.trim())
      } else if (editor.mode === 'create-sub') {
        if (editor.parentId === '') throw new Error('กรุณาเลือกหมวดหมู่หลัก')
        await window.stockApi.categoryManager.createSubcategory(editor.parentId, editor.value.trim(), editor.imageData)
      } else {
        await window.stockApi.categoryManager.renameSubcategory(editor.id, editor.value.trim())
      }
      setEditor(null)
      await onRefresh()
      onMessage('บันทึกหมวดหมู่เรียบร้อยแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function changeImage(id: number, name: string, targetLevel: CatalogLevel) {
    try {
      const picked = await window.stockApi.files.pickImage()
      if (picked.canceled || !picked.dataUrl) return
      if (targetLevel === 'main') await window.stockApi.categoryManager.setMainImage(id, picked.dataUrl)
      else await window.stockApi.categoryManager.setSubcategoryImage(id, picked.dataUrl)
      await onRefresh()
      onMessage(`อัปเดตรูป “${name}” แล้ว`)
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  async function removeMain(category: CategorySummary) {
    if (!window.confirm(`ลบหมวดหมู่หลัก “${category.name}” และหมวดหมู่รองทั้งหมดหรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeMain(category.id)
      await onRefresh()
      onMessage('ลบหมวดหมู่หลักแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  async function removeSubcategory(subcategory: FlatSubcategory) {
    if (!window.confirm(`ลบหมวดหมู่รอง “${subcategory.name}” หรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeSubcategory(subcategory.id)
      await onRefresh()
      onMessage('ลบหมวดหมู่รองแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  const heading = level === 'main'
    ? (isAgrochemical ? 'ฝ่ายหลัก' : 'หมวดหมู่หลัก')
    : (isAgrochemical ? 'ประเภทวัสดุ' : 'หมวดหมู่รอง')
  const description = level === 'main'
    ? (isAgrochemical ? 'ฝ่ายประจำคลังปุ๋ยและสารเคมี: OP, โกโก้ และส่งเสริม' : 'แสดงเฉพาะหมวดหมู่หลักในระบบ โดยไม่แสดงหมวดหมู่รองหรือสินค้า')
    : (isAgrochemical ? 'จัดกลุ่มวัสดุภายใต้ฝ่ายที่รับผิดชอบ' : 'แสดงเฉพาะหมวดหมู่รอง พร้อมชื่อหมวดหมู่หลักที่สังกัด')

  return (
    <section className="catalog-studio catalog-level-view">
      <div className="studio-hero-bar catalog-level-hero">
        <div className="studio-hero-copy">
          <div className="studio-badge">
            {level === 'main' ? <LevelIcons.Folder /> : <LevelIcons.Layers />}
            <span>{level === 'main' ? 'MAIN CATEGORIES' : 'SUBCATEGORIES'}</span>
          </div>
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
        <div className="studio-stats-summary">
          <div className="stat-pill catalog-level-stat">
            <span>{heading}ทั้งหมด</span>
            <strong>{items.length.toLocaleString('th-TH')}</strong>
          </div>
          {(level !== 'main' || !isAgrochemical) && <button type="button" className="action-pill-btn primary" onClick={openCreate}>
            <LevelIcons.Plus />
            <span>เพิ่ม{heading}</span>
          </button>}
        </div>
      </div>

      <div className="studio-section-title">
        <div className="title-text">
          <h3>รายการ{heading}</h3>
          <small>{level === 'main' ? 'ชื่อ รูปภาพ และเครื่องมือจัดการหมวดหมู่หลัก' : 'ชื่อ รูปภาพ และหมวดหมู่หลักที่สังกัด'}</small>
        </div>
      </div>

      {loading ? (
        <div className="studio-loading-state">
          <div className="spinner" />
          <span>กำลังโหลดข้อมูล…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="studio-empty-hero">
          <div className="empty-icon">{level === 'main' ? <LevelIcons.Folder /> : <LevelIcons.Layers />}</div>
          <h3>ยังไม่มี{heading}</h3>
          <p>{level === 'main' ? 'สร้างหมวดหมู่หลักแรกเพื่อเริ่มจัดระเบียบคลังสินค้า' : 'เพิ่มหมวดหมู่รองภายใต้หมวดหมู่หลักที่มีอยู่'}</p>
          <button type="button" className="button primary" onClick={openCreate}>
            <LevelIcons.Plus />
            <span>เพิ่ม{heading}</span>
          </button>
        </div>
      ) : (
        <div className="catalog-level-grid">
          {level === 'main'
            ? categories.map((category) => (
                <article key={category.id} className="catalog-level-card">
                  <div className="catalog-level-thumb">
                    {category.imageData
                      ? <img src={category.imageData} alt={category.name} />
                      : <span>{category.name.charAt(0).toUpperCase()}</span>}
                  </div>
                  <div className="catalog-level-copy">
                    <small>{isAgrochemical ? 'ฝ่ายหลัก' : 'หมวดหมู่หลัก'}</small>
                    <h3>{category.name}</h3>
                  </div>
                  <div className="catalog-level-actions">
                    <button type="button" title="เปลี่ยนรูป" onClick={() => void changeImage(category.id, category.name, 'main')}><LevelIcons.Photo /></button>
                    {!isAgrochemical && <button type="button" title="แก้ไขชื่อ" onClick={() => setEditor({ mode: 'rename-main', id: category.id, value: category.name })}><LevelIcons.Edit /></button>}
                    {!isAgrochemical && <button type="button" className="danger" title="ลบหมวดหมู่หลัก" onClick={() => void removeMain(category)}><LevelIcons.Trash /></button>}
                  </div>
                </article>
              ))
            : subcategories.map((subcategory) => (
                <article key={subcategory.id} className="catalog-level-card">
                  <div className="catalog-level-thumb sub">
                    {subcategory.imageData
                      ? <img src={subcategory.imageData} alt={subcategory.name} />
                      : <span>{subcategory.name.charAt(0).toUpperCase()}</span>}
                  </div>
                  <div className="catalog-level-copy">
                    <small>{isAgrochemical ? 'ฝ่าย' : 'ภายใต้หมวดหมู่หลัก'}: {subcategory.parentName}</small>
                    <h3>{subcategory.name}</h3>
                  </div>
                  <div className="catalog-level-actions">
                    <button type="button" title="เปลี่ยนรูป" onClick={() => void changeImage(subcategory.id, subcategory.name, 'sub')}><LevelIcons.Photo /></button>
                    <button type="button" title="แก้ไขชื่อ" onClick={() => setEditor({ mode: 'rename-sub', id: subcategory.id, value: subcategory.name })}><LevelIcons.Edit /></button>
                    <button type="button" className="danger" title="ลบหมวดหมู่รอง" onClick={() => void removeSubcategory(subcategory)}><LevelIcons.Trash /></button>
                  </div>
                </article>
              ))}
        </div>
      )}

      {editor && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}>
          <div className="modal category-editor-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-editor-title">
            <div className="modal-header">
              <div>
                <span className="eyebrow">CATEGORY</span>
                <h2 id="catalog-editor-title">
                  {editor.mode === 'create-main' ? 'เพิ่มหมวดหมู่หลัก' : editor.mode === 'rename-main' ? 'แก้ไขหมวดหมู่หลัก' : editor.mode === 'create-sub' ? 'เพิ่มหมวดหมู่รอง' : 'แก้ไขหมวดหมู่รอง'}
                </h2>
              </div>
              <button type="button" className="icon-button" aria-label="ปิด" onClick={() => setEditor(null)}>×</button>
            </div>
            <form onSubmit={submit}>
              {editor.mode === 'create-sub' && (
                <label className="field">
                  <span>อยู่ภายใต้หมวดหมู่หลัก *</span>
                  <select value={editor.parentId} required onChange={(event) => setEditor({ ...editor, parentId: Number(event.target.value) })}>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
              )}

              {'imageData' in editor && (
                <div className="catalog-editor-image-row">
                  <button type="button" className="catalog-editor-preview" onClick={() => void pickEditorImage()}>
                    {editor.imageData ? <img src={editor.imageData} alt="รูปตัวอย่าง" /> : <><LevelIcons.Photo /><span>เลือกรูป</span></>}
                  </button>
                  <div>
                    <strong>รูปภาพหมวดหมู่</strong>
                    <small>ไม่ใส่ก็ได้ ระบบจะแสดงตัวอักษรแทน</small>
                  </div>
                </div>
              )}

              <label className="field">
                <span>ชื่อ{editor.mode.includes('sub') ? 'หมวดหมู่รอง' : 'หมวดหมู่หลัก'} *</span>
                <input autoFocus required maxLength={100} value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} placeholder={editor.mode.includes('sub') ? 'เช่น เมล็ดแห้ง' : 'เช่น กาแฟ'} />
              </label>
              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={() => setEditor(null)}>ยกเลิก</button>
                <button type="submit" className="button primary" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
