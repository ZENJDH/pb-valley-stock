import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CategorySummary, SubcategorySummary } from '../../../shared/types'

type EditorState =
  | { mode: 'create-main'; title: string; value: string }
  | { mode: 'rename-main'; title: string; id: number; value: string }
  | { mode: 'create-sub'; title: string; categoryId: number; value: string }
  | { mode: 'rename-sub'; title: string; id: number; value: string }

interface Props {
  categories: CategorySummary[]
  loading: boolean
  onRefresh(): Promise<void>
  onViewProducts(category: string, subcategory?: string): void
  onMessage(message: string, kind?: 'success' | 'error'): void
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function CategoryManager({ categories, loading, onRefresh, onViewProducts, onMessage }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (selectedId === null && categories[0]) setSelectedId(categories[0].id)
    if (selectedId !== null && !categories.some((category) => category.id === selectedId)) {
      setSelectedId(categories[0]?.id ?? null)
    }
  }, [categories, selectedId])

  const selected = useMemo(() => categories.find((category) => category.id === selectedId) ?? null, [categories, selectedId])

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
      onMessage('บันทึกหมวดหมู่แล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    } finally {
      setSaving(false)
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

  async function removeSubcategory(subcategory: SubcategorySummary) {
    if (!window.confirm(`ลบหมวดหมู่รอง “${subcategory.name}” หรือไม่?`)) return
    try {
      await window.stockApi.categoryManager.removeSubcategory(subcategory.id)
      await onRefresh()
      onMessage('ลบหมวดหมู่รองแล้ว')
    } catch (error) {
      onMessage(errorMessage(error), 'error')
    }
  }

  return (
    <section className="category-manager">
      <div className="category-section-heading">
        <div><span className="eyebrow">MAIN CATEGORIES</span><h2>หมวดหมู่หลัก</h2><p>เลือกหมวดหมู่เพื่อดูรายการย่อยด้านล่าง</p></div>
        <button className="button primary" onClick={() => setEditor({ mode: 'create-main', title: 'เพิ่มหมวดหมู่หลัก', value: '' })}>＋ เพิ่มหมวดหมู่หลัก</button>
      </div>

      {loading ? <div className="category-loading"><div className="spinner" />กำลังโหลดหมวดหมู่…</div> : categories.length === 0 ? (
        <div className="category-empty"><strong>ยังไม่มีหมวดหมู่</strong><span>เริ่มต้นโดยเพิ่มหมวดหมู่หลัก เช่น โกโก้</span></div>
      ) : (
        <div className="main-category-grid">
          {categories.map((category, index) => (
            <article key={category.id} className={`main-category-card tone-${index % 4} ${selectedId === category.id ? 'selected' : ''}`} onClick={() => setSelectedId(category.id)}>
              <div className="category-card-actions">
                <button title="แก้ไข" onClick={(event) => { event.stopPropagation(); setEditor({ mode: 'rename-main', title: 'แก้ไขหมวดหมู่หลัก', id: category.id, value: category.name }) }}>✎</button>
                <button title="ลบ" onClick={(event) => { event.stopPropagation(); void removeMain(category) }}>×</button>
              </div>
              <div className="category-letter">{category.name.charAt(0).toUpperCase()}</div>
              <h3>{category.name}</h3>
              <p>{category.subcategories.length} หมวดหมู่รอง</p>
              <div className="category-card-metrics"><span><b>{category.productCount}</b> รายการ</span><span><b>{category.remainingUnits}</b> คงเหลือ</span></div>
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="subcategory-panel">
          <div className="subcategory-heading">
            <div><span className="eyebrow">SUBCATEGORIES</span><h2>หมวดหมู่รองของ “{selected.name}”</h2></div>
            <div className="subcategory-heading-actions"><button className="button secondary" onClick={() => onViewProducts(selected.name)}>ดูสินค้าทั้งหมด</button><button className="button primary" onClick={() => setEditor({ mode: 'create-sub', title: `เพิ่มหมวดหมู่รองใน ${selected.name}`, categoryId: selected.id, value: '' })}>＋ เพิ่มหมวดหมู่รอง</button></div>
          </div>
          <div className="subcategory-list">
            {selected.subcategories.length === 0 && <div className="subcategory-empty">ยังไม่มีหมวดหมู่รอง กด “เพิ่มหมวดหมู่รอง” เพื่อเริ่มต้น</div>}
            {selected.subcategories.map((subcategory, index) => (
              <article className="subcategory-row" key={subcategory.id}>
                <div className={`subcategory-index tone-${index % 4}`}>{String(index + 1).padStart(2, '0')}</div>
                <div className="subcategory-name"><strong>{subcategory.name}</strong><span>อยู่ภายใต้ {selected.name}</span></div>
                <div className="subcategory-stat"><strong>{subcategory.productCount}</strong><span>รายการสินค้า</span></div>
                <div className="subcategory-stat"><strong>{subcategory.remainingUnits}</strong><span>หน่วยคงเหลือ</span></div>
                <div className="subcategory-actions">
                  <button className="button secondary" onClick={() => onViewProducts(selected.name, subcategory.name)}>ดูสินค้า</button>
                  <button className="small-icon-button" title="แก้ไข" onClick={() => setEditor({ mode: 'rename-sub', title: 'แก้ไขหมวดหมู่รอง', id: subcategory.id, value: subcategory.name })}>✎</button>
                  <button className="small-icon-button danger" title="ลบ" onClick={() => void removeSubcategory(subcategory)}>×</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {editor && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}>
          <div className="modal category-editor" role="dialog" aria-modal="true">
            <div className="modal-header"><div><span className="eyebrow">CATEGORY</span><h2>{editor.title}</h2></div><button className="icon-button" onClick={() => setEditor(null)}>×</button></div>
            <form onSubmit={submit}>
              <label className="field"><span>ชื่อหมวดหมู่ *</span><input autoFocus required maxLength={100} value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} placeholder={editor.mode.includes('sub') ? 'เช่น เมล็ดแห้ง หรือ โกโก้ผง' : 'เช่น โกโก้'} /></label>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setEditor(null)}>ยกเลิก</button><button className="button primary" disabled={saving} type="submit">{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button></div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
