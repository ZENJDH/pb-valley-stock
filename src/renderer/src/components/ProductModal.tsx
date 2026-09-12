import { useEffect, useState, type FormEvent } from 'react'
import type { CategoryOption, InventoryMode, Product, ProductInput } from '../../../shared/types'

interface Props {
  product: Product | null
  initialCategory?: string
  initialSubcategory?: string
  itemLabel?: string
  inventoryMode?: InventoryMode
  categories: string[]
  categoryOptions: CategoryOption[]
  onClose(): void
  onSaved(): void
  onError(message: string): void
}

const emptyForm: ProductInput = {
  name: '',
  category: '',
  subcategory: '',
  totalQuantity: 0,
  quantity: 0,
  manufactureDate: null,
  expirationDate: '',
  barcode: null,
  notes: null,
  imageData: null
}

function localTodayIso(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export function ProductModal({ product, initialCategory = '', initialSubcategory = '', itemLabel = 'สินค้า', inventoryMode = 'products', categories, categoryOptions, onClose, onSaved, onError }: Props) {
  const [form, setForm] = useState<ProductInput>(emptyForm)
  const [saving, setSaving] = useState(false)
  const isAgrochemical = inventoryMode === 'agrochemicals'

  useEffect(() => {
    setForm(product
      ? {
          name: product.name,
          category: product.category,
          subcategory: product.subcategory,
          totalQuantity: product.totalQuantity,
          quantity: product.quantity,
          manufactureDate: product.manufactureDate,
          expirationDate: product.expirationDate,
          barcode: product.barcode,
          notes: product.notes,
          imageData: product.imageData
        }
      : {
          ...emptyForm,
          category: initialCategory,
          subcategory: initialSubcategory,
          expirationDate: inventoryMode === 'agrochemicals' ? localTodayIso() : ''
        })
  }, [product, initialCategory, initialSubcategory, inventoryMode])

  function set<K extends keyof ProductInput>(key: K, value: ProductInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setTotalQuantity(value: number) {
    setForm((current) => ({
      ...current,
      totalQuantity: value,
      quantity: product ? Math.min(current.quantity, value) : value
    }))
  }

  const selectableCategories = [...new Set([...categories, form.category].filter(Boolean))]

  const suggestedSubcategories = [...new Set([...categoryOptions
    .filter((option) => !form.category || option.mainCategory === form.category)
    .map((option) => option.subcategory)
    .filter(Boolean), form.subcategory].filter(Boolean))]

  async function pickProductImage() {
    try {
      const result = await window.stockApi.files.pickImage()
      if (result.dataUrl) set('imageData', result.dataUrl)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      if (product) await window.stockApi.products.update(product.id, form, product)
      else await window.stockApi.products.create(form)
      onSaved()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal product-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <span className="eyebrow">INVENTORY ITEM</span>
            <h2>{product ? `แก้ไข${itemLabel}` : `เพิ่ม${itemLabel}ใหม่`}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="ปิด">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="product-image-field span-2">
              <button className={`image-preview ${form.imageData ? 'has-image' : ''}`} type="button" onClick={pickProductImage} title={`เลือกรูป${itemLabel}`}>
                {form.imageData ? <img src={form.imageData} alt={`ตัวอย่างรูป${itemLabel}`} /> : <><span>＋</span><small>เพิ่มรูป</small></>}
              </button>
              <div className="image-field-copy"><strong>รูป{itemLabel}</strong><span>รองรับ JPG, PNG และ WebP โปรแกรมจะย่อรูปให้อัตโนมัติ</span><div><button className="button secondary" type="button" onClick={pickProductImage}>{form.imageData ? 'เปลี่ยนรูป' : 'เลือกรูป'}</button>{form.imageData && <button className="button ghost danger-text" type="button" onClick={() => set('imageData', null)}>เอารูปออก</button>}</div></div>
            </div>
            <label className="field span-2">
              <span>ชื่อ{itemLabel} *</span>
              <input autoFocus required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={itemLabel === 'สินค้า' ? 'เช่น น้ำองุ่น 100%' : 'เช่น ปุ๋ยสูตร 15-15-15'} />
            </label>
            <label className="field">
              <span>{isAgrochemical ? 'ฝ่าย *' : 'หมวดหมู่หลัก *'}</span>
              <select
                required
                value={form.category}
                onChange={(e) => {
                  const nextCategory = e.target.value
                  setForm((current) => ({
                    ...current,
                    category: nextCategory,
                    subcategory: current.category === nextCategory ? current.subcategory : ''
                  }))
                }}
              >
                <option value="" disabled>{isAgrochemical ? 'เลือกฝ่าย' : 'เลือกหมวดหมู่หลัก'}</option>
                {selectableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{isAgrochemical ? 'ประเภทวัสดุ *' : 'หมวดหมู่รอง *'}</span>
              <select
                required
                value={form.subcategory}
                disabled={!form.category || suggestedSubcategories.length === 0}
                onChange={(e) => set('subcategory', e.target.value)}
              >
                <option value="" disabled>
                  {!form.category
                    ? (isAgrochemical ? 'เลือกฝ่ายก่อน' : 'เลือกหมวดหมู่หลักก่อน')
                    : suggestedSubcategories.length === 0
                      ? (isAgrochemical ? 'ยังไม่มีประเภทวัสดุ' : 'ยังไม่มีหมวดหมู่รอง')
                      : (isAgrochemical ? 'เลือกประเภทวัสดุ' : 'เลือกหมวดหมู่รอง')}
                </option>
                {suggestedSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
              </select>
            </label>
            <label className="field">
              <span>จำนวนทั้งหมด *</span>
              <input required type="number" min="0" step="1" value={form.totalQuantity} onChange={(e) => setTotalQuantity(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>จำนวนคงเหลือ *</span>
              <input required type="number" min="0" step="1" value={form.quantity} onChange={(e) => set('quantity', Number(e.target.value))} />
            </label>
            {isAgrochemical ? (
              <label className="field span-2">
                <span>วันที่สั่งเข้ามา * <small className="field-note">ใช้เป็นวันที่อ้างอิงของรายการรับเข้า</small></span>
                <input required type="date" value={form.expirationDate} onChange={(e) => set('expirationDate', e.target.value)} />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>วันที่ผลิต</span>
                  <input type="date" value={form.manufactureDate ?? ''} onChange={(e) => set('manufactureDate', e.target.value || null)} />
                </label>
                <label className="field">
                  <span>วันหมดอายุ * <small className="field-note">เลือกวันที่ย้อนหลังได้</small></span>
                  <input required type="date" value={form.expirationDate} onChange={(e) => set('expirationDate', e.target.value)} />
                  {form.expirationDate && form.expirationDate < localTodayIso() && <small className="expired-date-confirm">{itemLabel}นี้หมดอายุแล้ว — สามารถบันทึกเข้าระบบได้</small>}
                </label>
              </>
            )}
            <label className="field span-2">
              <span>{isAgrochemical ? 'รหัสรายการ / เลขที่สั่งซื้อ' : `รหัส${itemLabel} / บาร์โค้ด`}</span>
              <input value={form.barcode ?? ''} onChange={(e) => set('barcode', e.target.value || null)} placeholder={isAgrochemical ? 'เช่น PO-2569-001 หรือ AG-001' : 'เช่น SKU-001 หรือ 8850000000000'} />
            </label>
            <label className="field span-2">
              <span>หมายเหตุ</span>
              <textarea rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} placeholder={isAgrochemical ? 'ผู้จำหน่าย / ตำแหน่งจัดเก็บ / ผู้รับผิดชอบ' : 'ล็อตผลิต / ตำแหน่งจัดเก็บ'} />
            </label>
          </div>
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onClose}>ยกเลิก</button>
            <button className="button primary" disabled={saving} type="submit">{saving ? 'กำลังบันทึก…' : `บันทึก${itemLabel}`}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
