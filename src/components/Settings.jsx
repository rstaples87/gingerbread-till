import { useState } from 'react'
import { CATEGORIES, STOCK_CATEGORIES } from '../data'
import { fmt } from '../utils'
import { features } from '../features'
import FloorPlanEditor from './FloorPlanEditor'
import { POS_FOOD_CATEGORIES } from '../data'
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
  vatRate: 20,
  group: 'drink',
  optionGroupIds: [],
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
    vatRate: product.vatRate ?? 20,
    group: product.group === 'food' ? 'food' : 'drink',
    optionGroupIds: Array.isArray(product.optionGroupIds) ? product.optionGroupIds : [],
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
  venueAuth,
  optionGroups = [],
  saveOptionGroup,
  deleteOptionGroup,
  floorAreas = [],
  floorTables = [],
  saveFloorArea,
  deleteFloorArea,
  saveFloorTable,
  deleteFloorTable,
  addFloorTableRange,
  showToast,
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
      vatRate: Number(productForm.vatRate ?? 20),
      group: productForm.group === 'food' ? 'food' : 'drink',
      ...(features.foodOptions ? { optionGroupIds: productForm.optionGroupIds || [] } : {}),
    }
    if (!product.name || !product.category || Number.isNaN(product.price)) return
    if (Number.isNaN(product.vatRate) || product.vatRate < 0 || product.vatRate > 100) return
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

  const [planAreaId, setPlanAreaId] = useState(null)
  const [groupForm, setGroupForm] = useState(null) // { id?, name, required, choicesText }

  const EXAMPLE_GROUPS = [
    { name: 'Steak cooking', required: true, choicesText: 'Rare\nMedium rare\nMedium\nMedium well\nWell done' },
    { name: 'Chips or sauté', required: true, choicesText: 'Chips\nSauté' },
  ]

  const openNewGroup = () => setGroupForm({ id: null, name: '', required: true, choicesText: '' })
  const openEditGroup = (g) => setGroupForm({ id: g.id, name: g.name, required: g.required !== false, choicesText: (g.choices || []).join('\n') })
  const submitGroup = (event) => {
    event.preventDefault()
    const saved = saveOptionGroup({
      id: groupForm.id,
      name: groupForm.name,
      required: groupForm.required,
      choices: groupForm.choicesText.split('\n'),
    })
    if (saved) setGroupForm(null)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {venueAuth && (
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            Venue login: {venueAuth.signedIn ? 'signed in as ' + (venueAuth.email ?? 'venue') : 'not signed in'}{' '}
            {venueAuth.signedIn ? (
              <button type="button" onClick={venueAuth.signOut}>Sign out</button>
            ) : (
              <button type="button" onClick={venueAuth.openSignIn}>Sign in</button>
            )}
          </div>
        )}
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
          {features.foodOptions && (
            <button
              type="button"
              className={`${styles.topTab} ${tab === 'options' ? styles.topTabActive : ''}`}
              onClick={() => setTab('options')}
            >
              Dish Options
            </button>
          )}
          {features.tables && (
            <button
              type="button"
              className={`${styles.topTab} ${tab === 'tables' ? styles.topTabActive : ''}`}
              onClick={() => setTab('tables')}
            >
              Tables
            </button>
          )}
        </div>

        {features.tables && tab === 'tables' && (
          <>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                const n = (window.prompt('Name for the new area?') || '').trim()
                if (n) saveFloorArea({ name: n })
              }}
            >
              Add area
            </button>
            <div className={styles.meta} style={{ margin: '8px 0' }}>
              Areas and tables appear on the Tables screen. Use "Add several" to create numbered tables in one go.
            </div>
            {[...floorAreas].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(area => {
              const mine = floorTables
                .filter(t => t.areaId === area.id)
                .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
              const askSeats = (current) => {
                const v = window.prompt('Seats (optional, leave blank if not needed)', current ?? '')
                return v === null ? undefined : v.trim()
              }
              return (
                <section key={area.id}>
                  <div className={styles.groupTitle}>{area.name} ({mine.length} {mine.length === 1 ? 'table' : 'tables'})</div>
                  <div className={styles.rowActions} style={{ flexWrap: 'wrap', margin: '4px 0 8px' }}>
                    <button type="button" className={styles.secondaryBtn} onClick={() => {
                      const n = (window.prompt('New name for this area?', area.name) || '').trim()
                      if (n) saveFloorArea({ id: area.id, name: n })
                    }}>Rename</button>
                    <button type="button" className={styles.secondaryBtn} onClick={() => {
                      const name = (window.prompt('Table name or number?') || '').trim()
                      if (!name) return
                      const seats = askSeats('')
                      if (seats === undefined) return
                      saveFloorTable({ areaId: area.id, name, seats })
                    }}>Add table</button>
                    <button type="button" className={styles.secondaryBtn} onClick={() => {
                      const from = window.prompt('First table number?')
                      if (from === null) return
                      const to = window.prompt('Last table number?')
                      if (to === null) return
                      const seats = askSeats('')
                      if (seats === undefined) return
                      const n = addFloorTableRange(area.id, from, to, seats)
                      showToast(n ? `${n} tables added` : 'No new tables added')
                    }}>Add several</button>
                    <button type="button" className={styles.dangerBtn} onClick={() => {
                      if (window.confirm(`Delete ${area.name} and its ${mine.length} tables?`)) deleteFloorArea(area.id)
                    }}>Delete area</button>
                    <button type="button" className={styles.secondaryBtn} onClick={() => setPlanAreaId(planAreaId === area.id ? null : area.id)}>
                      {planAreaId === area.id ? 'Close floor plan' : 'Edit floor plan'}
                    </button>
                  </div>
                  {planAreaId === area.id && (
                    <FloorPlanEditor tables={mine} saveFloorTable={saveFloorTable} showToast={showToast} />
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {mine.map(t => (
                      <span key={t.id} style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--white)' }}>
                        <button type="button" style={{ border: 'none', background: 'none', padding: '6px 10px', fontSize: 13 }} onClick={() => {
                          const name = (window.prompt('Table name or number?', t.name) || '').trim()
                          if (!name) return
                          const seats = askSeats(t.seats ?? '')
                          if (seats === undefined) return
                          saveFloorTable({ id: t.id, areaId: area.id, name, seats })
                        }}>{t.name}{t.seats ? ` (${t.seats})` : ''}</button>
                        <button type="button" aria-label={`Delete ${t.name}`} style={{ border: 'none', background: 'none', padding: '6px 8px', color: 'var(--red)' }} onClick={() => {
                          if (window.confirm(`Delete ${t.name}?`)) deleteFloorTable(t.id)
                        }}>×</button>
                      </span>
                    ))}
                    {!mine.length && <span className={styles.meta}>No tables yet.</span>}
                  </div>
                </section>
              )
            })}
          </>
        )}

        {features.foodOptions && tab === 'options' && (
          <>
            <button type="button" className={styles.primaryBtn} onClick={openNewGroup}>Add option group</button>
            <div className={styles.meta} style={{ margin: '8px 0' }}>
              An option group is a set of choices a dish asks for, e.g. steak cooking. Create it once, then tick it on each dish that needs it (Till Products → Edit).
            </div>
            {optionGroups.map(g => (
              <div key={g.id} className={styles.row}>
                <div className={styles.rowInfo}>
                  <div className={styles.name}>{g.name} {g.required ? '(required)' : '(optional)'}</div>
                  <div className={styles.meta}>{(g.choices || []).join(', ')}</div>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => openEditGroup(g)}>Edit</button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() => { if (confirm(`Delete ${g.name}? Dishes using it will stop asking for it.`)) deleteOptionGroup(g.id) }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!optionGroups.length && <div className={styles.meta}>No option groups yet.</div>}
          </>
        )}

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

      {groupForm && (
        <div className={styles.overlay} onClick={() => setGroupForm(null)}>
          <form className={styles.sheet} onSubmit={submitGroup} onClick={event => event.stopPropagation()}>
            <h2>{groupForm.id ? 'Edit option group' : 'Add option group'}</h2>
            {!groupForm.id && (
              <div className={styles.meta} style={{ marginBottom: 8 }}>
                Examples:{' '}
                {EXAMPLE_GROUPS.map(ex => (
                  <button key={ex.name} type="button" className={styles.secondaryBtn} style={{ marginRight: 6 }} onClick={() => setGroupForm(f => ({ ...f, ...ex }))}>
                    {ex.name}
                  </button>
                ))}
              </div>
            )}
            <label className={styles.field}>
              <span>Name</span>
              <input value={groupForm.name} onChange={event => setGroupForm(f => ({ ...f, name: event.target.value }))} placeholder="e.g. Steak cooking" />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
              <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={groupForm.required} onChange={event => setGroupForm(f => ({ ...f, required: event.target.checked }))} />
              Must choose one (required)
            </label>
            <label className={styles.field}>
              <span>Choices (one per line)</span>
              <textarea rows={6} value={groupForm.choicesText} onChange={event => setGroupForm(f => ({ ...f, choicesText: event.target.value }))} />
            </label>
            <button type="submit" className={styles.primaryBtn}>Save</button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setGroupForm(null)}>Cancel</button>
          </form>
        </div>
      )}

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
              onChange={category => setProductForm(form => ({
                ...form,
                category,
                // In the POS build, picking a food category defaults the product to food.
                ...(features.taxFieldsInProductEditor && POS_FOOD_CATEGORIES.includes(category) ? { group: 'food' } : {}),
              }))}
              onCustomChange={categoryDraft => setProductForm(form => ({ ...form, categoryMode: 'custom', categoryDraft }))}
              onCancelCustom={() => setProductForm(form => ({
                ...form,
                categoryMode: 'select',
                categoryDraft: '',
                category: form.category || tillCategories[0] || CATEGORIES[0],
              }))}
            />
            {features.taxFieldsInProductEditor && (
              <>
                <label className={styles.field}>
                  <span>VAT rate (%)</span>
                  <input type="number" min="0" max="100" step="0.5" value={productForm.vatRate} onChange={event => setProductForm(form => ({ ...form, vatRate: event.target.value }))} />
                </label>
                <label className={styles.field}>
                  <span>Food or drink</span>
                  <select value={productForm.group} onChange={event => setProductForm(form => ({ ...form, group: event.target.value }))}>
                    <option value="drink">Drink</option>
                    <option value="food">Food</option>
                  </select>
                </label>
              </>
            )}
            {features.foodOptions && optionGroups.length > 0 && (
              <div className={styles.field}>
                <span>Dish options (asked when the dish is added)</span>
                {optionGroups.map(g => (
                  <label key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', margin: 0 }}
                      checked={(productForm.optionGroupIds || []).includes(g.id)}
                      onChange={event => setProductForm(form => ({
                        ...form,
                        optionGroupIds: event.target.checked
                          ? [...(form.optionGroupIds || []), g.id]
                          : (form.optionGroupIds || []).filter(x => x !== g.id),
                      }))}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
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
