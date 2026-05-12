import { useState } from 'react'
import { CATEGORIES, STOCK_CATEGORIES } from '../data'
import { fmt } from '../utils'
import styles from './Settings.module.css'

const STOCK_UNITS = ['bottle', 'can', 'carton']
const ADD_CATEGORY = '__add_category__'

const blankProductForm = {
  id: null,
  name: '',
  price: '',
  category: CATEGORIES[0],
  categoryMode: 'select',
  categoryDraft: '',
  variantType: 'none',
  label: '',
  stockIds: [],
  mixerStockIds: [],
  deduct: 1,
}

const blankStockForm = {
  id: null,
  name: '',
  category: STOCK_CATEGORIES[0],
  categoryMode: 'select',
  categoryDraft: '',
  unit: STOCK_UNITS[0],
  bottleYield: '',
  displayUnit: '',
}

function nextProductId(products) {
  return Math.max(0, ...products.map(product => Number(product.id) || 0)) + 1
}

function nextStockId(stockDefinitions) {
  const max = Math.max(99, ...stockDefinitions.map(item => {
    const match = String(item.id).match(/^s(\d+)$/)
    return match ? Number(match[1]) : 0
  }))
  return `s${max + 1}`
}

function getVariantType(variant) {
  if (!variant) return 'none'
  if (variant.needsMixer || variant.mixerOnly) return 'mixer'
  return 'single'
}

function productToForm(product, variant, defaultMixerIds) {
  const mainStockIds = variant?.stockIds?.length
    ? variant.stockIds
    : variant?.fixedSpiritStockId
      ? [variant.fixedSpiritStockId]
      : []
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    category: product.category,
    categoryMode: 'select',
    categoryDraft: '',
    variantType: getVariantType(variant),
    label: variant?.label || '',
    stockIds: mainStockIds,
    mixerStockIds: variant?.mixerStockIds?.length ? variant.mixerStockIds : defaultMixerIds,
    deduct: variant?.deduct ?? 1,
    originalProduct: product,
  }
}

function stockItemToForm(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    categoryMode: 'select',
    categoryDraft: '',
    unit: item.unit || STOCK_UNITS[0],
    bottleYield: item.bottleYield ?? '',
    displayUnit: item.displayUnit || '',
  }
}

function MultiSelect({ label, value, options, onChange }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        multiple
        className={styles.multiSelect}
        value={value}
        onChange={(event) => {
          const selected = Array.from(event.target.selectedOptions).map(option => option.value)
          onChange(selected)
        }}
      >
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.category})
          </option>
        ))}
      </select>
    </label>
  )
}

function CategoryField({ label, value, mode, draft, categories, onChange, onCustomChange, onCancelCustom }) {
  if (mode === 'custom') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <div className={styles.categoryInputRow}>
          <input
            value={draft}
            placeholder="New category name"
            onChange={event => onCustomChange(event.target.value)}
            autoFocus
          />
          <button type="button" className={styles.linkBtn} onClick={onCancelCustom}>Cancel</button>
        </div>
      </label>
    )
  }

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          if (event.target.value === ADD_CATEGORY) {
            onCustomChange('')
            return
          }
          onChange(event.target.value)
        }}
      >
        {categories.map(category => <option key={category} value={category}>{category}</option>)}
        <option value={ADD_CATEGORY}>Add new category...</option>
      </select>
    </label>
  )
}

export default function Settings({
  products,
  productVariants,
  stockDefinitions,
  tillCategories,
  stockCategories,
  mixerStockIds,
  saveProduct,
  deleteProduct,
  saveStockDefinition,
  deleteStockDefinition,
  saveCategory,
}) {
  const [tab, setTab] = useState('products')
  const [productForm, setProductForm] = useState(null)
  const [stockForm, setStockForm] = useState(null)

  const mixerOptions = stockDefinitions.filter(item => mixerStockIds.includes(item.id))
  const productGroups = tillCategories.map(category => ({
    category,
    items: products.filter(product => product.category === category),
  })).filter(group => group.items.length)

  const stockGroups = stockCategories.map(category => ({
    category,
    items: stockDefinitions.filter(item => item.category === category),
  })).filter(group => group.items.length)

  const openNewProduct = () => {
    setProductForm({
      ...blankProductForm,
      id: nextProductId(products),
      category: tillCategories[0] || CATEGORIES[0],
      mixerStockIds,
    })
  }

  const submitProduct = (event) => {
    event.preventDefault()
    const categoryInput = productForm.categoryMode === 'custom'
      ? productForm.categoryDraft.trim()
      : productForm.category
    const product = {
      ...(productForm.originalProduct || {}),
      id: productForm.id,
      name: productForm.name.trim(),
      price: Number(productForm.price),
      category: categoryInput,
      stock: productForm.originalProduct?.stock ?? 0,
    }
    if (!product.name || !product.category || Number.isNaN(product.price)) return
    if (productForm.categoryMode === 'custom') {
      product.category = saveCategory('till', product.category)
    }

    const variant = productForm.variantType === 'none'
      ? null
      : {
          label: productForm.label.trim(),
          stockIds: productForm.stockIds,
          deduct: Number(productForm.deduct || 1),
          ...(productForm.variantType === 'mixer' ? {
            needsMixer: true,
            mixerStockIds: productForm.mixerStockIds,
          } : {}),
        }

    saveProduct(product, variant)
    setProductForm(null)
  }

  const confirmDeleteProduct = (product) => {
    if (!confirm(`Delete ${product.name}? This will not affect transaction history.`)) return
    deleteProduct(product.id)
  }

  const openNewStockItem = () => {
    setStockForm({
      ...blankStockForm,
      id: nextStockId(stockDefinitions),
      category: stockCategories[0] || STOCK_CATEGORIES[0],
    })
  }

  const submitStockItem = (event) => {
    event.preventDefault()
    const categoryInput = stockForm.categoryMode === 'custom'
      ? stockForm.categoryDraft.trim()
      : stockForm.category
    const item = {
      id: stockForm.id,
      name: stockForm.name.trim(),
      category: categoryInput,
      unit: stockForm.unit,
      stock: 0,
      bottleYield: stockForm.bottleYield === '' ? undefined : Number(stockForm.bottleYield),
      displayUnit: stockForm.displayUnit.trim() || undefined,
    }
    if (!item.name || !item.category || Number.isNaN(item.bottleYield)) return
    if (stockForm.categoryMode === 'custom') {
      item.category = saveCategory('stock', item.category)
    }
    saveStockDefinition(item)
    setStockForm(null)
  }

  const linkedProductNames = (stockKey) => products
    .filter(product => {
      const variant = productVariants[product.id]
      if (!variant) return false
      return (
        variant.fixedSpiritStockId === stockKey ||
        (variant.stockIds || []).includes(stockKey) ||
        (variant.mixerStockIds || []).includes(stockKey)
      )
    })
    .map(product => product.name)

  const confirmDeleteStockItem = (item) => {
    const linked = linkedProductNames(item.id)
    const warning = linked.length
      ? `\n\nWarning: this stock item is linked to ${linked.join(', ')}.`
      : ''
    if (!confirm(`Delete ${item.name}?${warning}`)) return
    deleteStockDefinition(item.id)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.topTabs}>
          <button
            type="button"
            className={`${styles.topTab} ${tab === 'products' ? styles.topTabActive : ''}`}
            onClick={() => setTab('products')}
          >
            Till Products
          </button>
          <button
            type="button"
            className={`${styles.topTab} ${tab === 'stock' ? styles.topTabActive : ''}`}
            onClick={() => setTab('stock')}
          >
            Stock Items
          </button>
        </div>

        {tab === 'products' && (
          <>
            <button type="button" className={styles.primaryBtn} onClick={openNewProduct}>Add product</button>
            {productGroups.map(group => (
              <section key={group.category}>
                <div className={styles.groupTitle}>{group.category}</div>
                {group.items.map(product => (
                  <div key={product.id} className={styles.row}>
                    <div className={styles.rowInfo}>
                      <div className={styles.name}>{product.name}</div>
                      <div className={styles.meta}>{fmt(product.price)} - {product.category}</div>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => setProductForm(productToForm(product, productVariants[product.id], mixerStockIds))}
                      >
                        Edit
                      </button>
                      <button type="button" className={styles.dangerBtn} onClick={() => confirmDeleteProduct(product)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}

        {tab === 'stock' && (
          <>
            <button type="button" className={styles.primaryBtn} onClick={openNewStockItem}>Add stock item</button>
            {stockGroups.map(group => (
              <section key={group.category}>
                <div className={styles.groupTitle}>{group.category}</div>
                {group.items.map(item => (
                  <div key={item.id} className={styles.row}>
                    <div className={styles.rowInfo}>
                      <div className={styles.name}>{item.name}</div>
                      <div className={styles.meta}>
                        {item.category} - {item.unit}
                        {item.bottleYield ? ` - ${item.bottleYield} portions` : ''}
                        {item.displayUnit ? ` - ${item.displayUnit}` : ''}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => setStockForm(stockItemToForm(item))}>
                        Edit
                      </button>
                      <button type="button" className={styles.dangerBtn} onClick={() => confirmDeleteStockItem(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>

      {productForm && (
        <div className={styles.overlay} onClick={() => setProductForm(null)}>
          <form className={styles.sheet} onSubmit={submitProduct} onClick={event => event.stopPropagation()}>
            <h2>{productForm.originalProduct ? 'Edit product' : 'Add product'}</h2>
            <label className={styles.field}>
              <span>Product name</span>
              <input value={productForm.name} onChange={event => setProductForm(form => ({ ...form, name: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span>Price</span>
              <input type="number" min="0" step="0.01" value={productForm.price} onChange={event => setProductForm(form => ({ ...form, price: event.target.value }))} />
            </label>
            <CategoryField
              label="Category"
              value={productForm.category}
              mode={productForm.categoryMode}
              draft={productForm.categoryDraft}
              categories={tillCategories}
              onChange={category => setProductForm(form => ({ ...form, category }))}
              onCustomChange={categoryDraft => setProductForm(form => ({ ...form, categoryMode: 'custom', categoryDraft }))}
              onCancelCustom={() => setProductForm(form => ({
                ...form,
                categoryMode: 'select',
                categoryDraft: '',
                category: form.category || tillCategories[0] || CATEGORIES[0],
              }))}
            />
            <label className={styles.field}>
              <span>Variant type</span>
              <select value={productForm.variantType} onChange={event => setProductForm(form => ({ ...form, variantType: event.target.value }))}>
                <option value="none">None (no stock linking)</option>
                <option value="single">Single choice</option>
                <option value="mixer">Spirit &amp; mixer</option>
              </select>
            </label>

            {productForm.variantType !== 'none' && (
              <>
                <label className={styles.field}>
                  <span>Label</span>
                  <input value={productForm.label} placeholder="Which lager?" onChange={event => setProductForm(form => ({ ...form, label: event.target.value }))} />
                </label>
                <label className={styles.field}>
                  <span>Deduct amount per sale</span>
                  <input type="number" step="0.001" min="0" value={productForm.deduct} onChange={event => setProductForm(form => ({ ...form, deduct: event.target.value }))} />
                </label>
                <MultiSelect
                  label="Spirit/main choices"
                  value={productForm.stockIds}
                  options={stockDefinitions}
                  onChange={stockIds => setProductForm(form => ({ ...form, stockIds }))}
                />
              </>
            )}

            {productForm.variantType === 'mixer' && (
              <MultiSelect
                label="Mixer choices"
                value={productForm.mixerStockIds}
                options={mixerOptions}
                onChange={selectedMixerIds => setProductForm(form => ({ ...form, mixerStockIds: selectedMixerIds }))}
              />
            )}

            <div className={styles.sheetBtns}>
              <button type="button" className={styles.cancelBtn} onClick={() => setProductForm(null)}>Cancel</button>
              <button type="submit" className={styles.confirmBtn}>Save product</button>
            </div>
          </form>
        </div>
      )}

      {stockForm && (
        <div className={styles.overlay} onClick={() => setStockForm(null)}>
          <form className={styles.sheet} onSubmit={submitStockItem} onClick={event => event.stopPropagation()}>
            <h2>{stockDefinitions.some(item => item.id === stockForm.id) ? 'Edit stock item' : 'Add stock item'}</h2>
            <label className={styles.field}>
              <span>Name</span>
              <input value={stockForm.name} onChange={event => setStockForm(form => ({ ...form, name: event.target.value }))} />
            </label>
            <CategoryField
              label="Category"
              value={stockForm.category}
              mode={stockForm.categoryMode}
              draft={stockForm.categoryDraft}
              categories={stockCategories}
              onChange={category => setStockForm(form => ({ ...form, category }))}
              onCustomChange={categoryDraft => setStockForm(form => ({ ...form, categoryMode: 'custom', categoryDraft }))}
              onCancelCustom={() => setStockForm(form => ({
                ...form,
                categoryMode: 'select',
                categoryDraft: '',
                category: form.category || stockCategories[0] || STOCK_CATEGORIES[0],
              }))}
            />
            <label className={styles.field}>
              <span>Unit</span>
              <select value={stockForm.unit} onChange={event => setStockForm(form => ({ ...form, unit: event.target.value }))}>
                {STOCK_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Bottle yield</span>
              <input type="number" min="0" step="0.001" value={stockForm.bottleYield} onChange={event => setStockForm(form => ({ ...form, bottleYield: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span>Display unit</span>
              <input value={stockForm.displayUnit} placeholder="measures" onChange={event => setStockForm(form => ({ ...form, displayUnit: event.target.value }))} />
            </label>
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.cancelBtn} onClick={() => setStockForm(null)}>Cancel</button>
              <button type="submit" className={styles.confirmBtn}>Save stock item</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
