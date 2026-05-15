import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage'
import {
  INITIAL_PRODUCTS,
  INITIAL_STAFF,
  STOCK_ITEMS as INITIAL_STOCK_ITEMS,
  PRODUCT_VARIANTS as INITIAL_PRODUCT_VARIANTS,
  DEFAULT_TAB_LIMIT,
  CATEGORIES as DEFAULT_TILL_CATEGORIES,
  STOCK_CATEGORIES as DEFAULT_STOCK_CATEGORIES,
} from './data'
import { supabase } from './supabase'
import { fmt, getOrderTotal, orderToItems, tabTotal, mixerBottleDeductionForLine } from './utils'
import Header from './components/Header'
import Nav from './components/Nav'
import Till from './components/Till'
import TabsView from './components/TabsView'
import Stock from './components/Stock'
import StaffLog from './components/StaffLog'
import Sales from './components/Sales'
import Settings from './components/Settings'
import BarView from './components/BarView'
import StaffOverlay from './components/StaffOverlay'
import Toast from './components/Toast'
import { readSyncQueue, maybeQueueSyncFailure, flushSyncQueue } from './syncQueue'
import {
  mergeProductsRealtime,
  normaliseTabRowLive,
  normaliseTransactionRowLive,
} from './supabaseRealtimeMerge'

function normaliseProductRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    price: Number(row.price),
    category: row.category,
    stock: 0,
  }
}

function serialiseVariantStockIds(variant) {
  if (variant?.needsMixer) {
    return {
      main: variant.stockIds || [],
      mixers: variant.mixerStockIds || [],
    }
  }
  return variant?.stockIds || []
}

function normaliseVariantRow(row) {
  const rawStockIds = row.stock_ids
  const stockIds = Array.isArray(rawStockIds)
    ? rawStockIds
    : Array.isArray(rawStockIds?.main)
      ? rawStockIds.main
      : []
  const mixerStockIds = Array.isArray(rawStockIds?.mixers) ? rawStockIds.mixers : []
  return {
    label: row.label || '',
    stockIds,
    deduct: Number(row.deduct ?? 1),
    needsMixer: Boolean(row.needs_mixer),
    ...(mixerStockIds.length ? { mixerStockIds } : {}),
  }
}

function normaliseStockDefinitionRow(row, fallback) {
  return {
    ...(fallback || {}),
    id: row.stock_key,
    name: row.name || fallback?.name || row.stock_key,
    category: row.category || fallback?.category || 'Other Spirits',
    unit: row.unit || fallback?.unit || 'bottle',
    displayUnit: row.display_unit || fallback?.displayUnit,
    bottleYield: row.bottle_yield != null ? Number(row.bottle_yield) : fallback?.bottleYield,
    stock: Number(row.qty ?? fallback?.stock ?? 0),
  }
}

function uniqueNonEmpty(items) {
  return Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
}

async function seedSupabase() {
  if (!supabase) return
  try {
    const { data: staffSample } = await supabase.from('staff').select('id').limit(1)
    if (!staffSample?.length && INITIAL_STAFF.length > 0) {
      await supabase.from('staff').insert(
        INITIAL_STAFF.map(s => ({
          name: s.name,
          pin: s.pin ?? '0000',
          role: s.role ?? 'staff',
        })),
      )
    }
    const { data: stockSample } = await supabase.from('stock_items').select('stock_key').limit(1)
    if (!stockSample?.length) {
      const seedRows = INITIAL_STOCK_ITEMS.map(s => ({
        stock_key: s.id,
        qty: s.stock ?? 0,
        name: s.name,
        category: s.category,
        unit: s.unit,
        bottle_yield: s.bottleYield ?? null,
        display_unit: s.displayUnit ?? null,
      }))
      const { error: stockSeedError } = await supabase.from('stock_items').insert(seedRows)
      if (stockSeedError) {
        await supabase.from('stock_items').insert(
          INITIAL_STOCK_ITEMS.map(s => ({ stock_key: s.id, qty: s.stock ?? 0 })),
        )
      }
    }
  } catch (err) {
    console.warn('Supabase seed failed:', err?.message || err)
  }
}

async function loadProductsFromSupabase(setProducts, setProductVariants) {
  if (!supabase) return
  try {
    const { data, error } = await supabase.from('products').select('id, name, price, category').order('id')
    if (error) throw error
    if (!data?.length) return
    setProducts(data.map(normaliseProductRow))

    const { data: variantRows, error: variantError } = await supabase
      .from('product_variants')
      .select('product_id, label, stock_ids, deduct, needs_mixer')
    if (variantError) throw variantError
    const variants = {}
    for (const row of variantRows || []) {
      variants[Number(row.product_id)] = normaliseVariantRow(row)
    }
    setProductVariants(variants)
  } catch (err) {
    console.warn('loadProductsFromSupabase failed:', err?.message || err)
  }
}

async function loadCategoriesFromSupabase(setCategoryState) {
  if (!supabase) return
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('name, type')
      .order('created_at')
    if (error) throw error
    if (!data?.length) return
    setCategoryState(prev => ({
      till: uniqueNonEmpty([
        ...(prev?.till || []),
        ...data.filter(row => row.type === 'till').map(row => row.name),
      ]),
      stock: uniqueNonEmpty([
        ...(prev?.stock || []),
        ...data.filter(row => row.type === 'stock').map(row => row.name),
      ]),
    }))
  } catch (err) {
    console.warn('loadCategoriesFromSupabase failed:', err?.message || err)
  }
}

async function saveCategoryToSupabase(type, name) {
  if (!supabase) return
  const { error } = await supabase.from('categories').insert({
    name,
    type,
  })
  if (error) throw error
}

/** Upsert warehouse stock map — fire-and-forget */
function syncStockToSupabase(map) {
  if (!supabase || !map) return
  const rows = Object.entries(map).map(([stock_key, qty]) => ({
    stock_key,
    qty: Number(qty),
  }))
  supabase
    .from('stock_items')
    .upsert(rows, { onConflict: 'stock_key' })
    .then(({ error }) => {
      if (error) maybeQueueSyncFailure('stock', rows, error)
    })
    .catch(err => maybeQueueSyncFailure('stock', rows, err))
}

async function loadStockFromSupabase(setStockItemsRaw, setStockDefinitions) {
  if (!supabase) return
  try {
    let { data, error } = await supabase
      .from('stock_items')
      .select('stock_key, qty, name, category, unit, bottle_yield, display_unit')
    if (error) {
      const fallback = await supabase.from('stock_items').select('stock_key, qty')
      data = fallback.data
      error = fallback.error
    }
    if (error) throw error
    if (!data?.length) return
    setStockItemsRaw(prev => {
      const next = { ...prev }
      for (const row of data) {
        next[row.stock_key] = Number(row.qty)
      }
      return next
    })
    const hasDefinitions = data.some(row => row.name || row.category || row.unit || row.bottle_yield != null)
    if (hasDefinitions) {
      setStockDefinitions(prev => {
        const fallbackById = Object.fromEntries(prev.map(item => [item.id, item]))
        return data.map(row => normaliseStockDefinitionRow(row, fallbackById[row.stock_key]))
      })
    }
  } catch (err) {
    console.warn('loadStockFromSupabase failed:', err?.message || err)
  }
}

/** Till menu product stock — fire-and-forget */
function syncTillStockToSupabase(map) {
  if (!supabase || !map) return
  const rows = Object.entries(map).map(([product_id, qty]) => ({
    product_id: Number(product_id),
    qty: Number(qty),
  }))
  supabase
    .from('till_stock')
    .upsert(rows, { onConflict: 'product_id' })
    .then(({ error }) => {
      if (error) maybeQueueSyncFailure('till_stock', rows, error)
    })
    .catch(err => maybeQueueSyncFailure('till_stock', rows, err))
}

async function loadTillStockFromSupabase(setStockRaw) {
  console.log('[Realtime] loadTillStockFromSupabase: start')
  if (!supabase) return
  try {
    const { data, error } = await supabase.from('till_stock').select('product_id, qty')
    console.log('[Realtime] loadTillStockFromSupabase: response', { data, error })
    if (error) throw error
    if (!data?.length) return
    setStockRaw(prev => {
      const next = { ...prev }
      for (const row of data) {
        next[row.product_id] = Number(row.qty)
      }
      return next
    })
  } catch (err) {
    console.warn('loadTillStockFromSupabase failed:', err?.message || err)
  }
}

async function upsertProductToSupabase(product) {
  if (!supabase) return
  const { error } = await supabase.from('products').upsert({
    id: Number(product.id),
    name: product.name,
    price: Number(product.price),
    category: product.category,
  }, { onConflict: 'id' })
  if (error) throw error
}

async function upsertProductVariantToSupabase(productId, variant) {
  if (!supabase) return
  if (!variant) {
    const { error } = await supabase.from('product_variants').delete().eq('product_id', Number(productId))
    if (error) throw error
    return
  }
  const { error } = await supabase.from('product_variants').upsert({
    product_id: Number(productId),
    label: variant.label || null,
    stock_ids: serialiseVariantStockIds(variant),
    deduct: Number(variant.deduct ?? 1),
    needs_mixer: Boolean(variant.needsMixer),
  }, { onConflict: 'product_id' })
  if (error) throw error
}

async function deleteProductFromSupabase(productId) {
  if (!supabase) return
  const variantDelete = await supabase.from('product_variants').delete().eq('product_id', Number(productId))
  if (variantDelete.error) throw variantDelete.error
  const productDelete = await supabase.from('products').delete().eq('id', Number(productId))
  if (productDelete.error) throw productDelete.error
}

async function upsertStockDefinitionToSupabase(item, qty) {
  if (!supabase) return
  const { error } = await supabase.from('stock_items').upsert({
    stock_key: item.id,
    qty: Number(qty ?? item.stock ?? 0),
    name: item.name,
    category: item.category,
    unit: item.unit,
    bottle_yield: item.bottleYield == null ? null : Number(item.bottleYield),
    display_unit: item.displayUnit || null,
  }, { onConflict: 'stock_key' })
  if (error) throw error
}

async function deleteStockDefinitionFromSupabase(stockKey) {
  if (!supabase) return
  const { error } = await supabase.from('stock_items').delete().eq('stock_key', stockKey)
  if (error) throw error
}

function syncTransactionToSupabase(tx) {
  if (!supabase) return

  const time =
    tx.time instanceof Date ? tx.time.toISOString()
      : tx.time ?? null

  const voided_at = tx.voidedAt
    ? (tx.voidedAt instanceof Date ? tx.voidedAt.toISOString() : tx.voidedAt)
    : null

  /** Keys match Supabase `transactions` columns exactly */
  const row = {
    id: tx.id,
    time,
    total: tx.total,
    items: tx.items ?? [],
    payment: tx.payment ?? null,
    staff_name: tx.staff ?? null,
    type: tx.type ?? null,
    tab_name: tx.tabName ?? null,
    voided: Boolean(tx.voided),
    voided_at,
    tendered_amount: tx.tenderedAmount ?? null,
    change_given: tx.changeGiven ?? null,
  }

  supabase
    .from('transactions')
    .upsert(row, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) maybeQueueSyncFailure('transaction', row, error)
    })
    .catch(err => maybeQueueSyncFailure('transaction', row, err))
}

/** Columns on public.tabs we may write: id, name, items, opened_at, tab_limit, settled (not staff until schema cache includes it). */
function tabRowForSupabase(tab) {
  const openedAt =
    tab.openedAt instanceof Date ? tab.openedAt.toISOString()
      : tab.openedAt ?? new Date().toISOString()
  const row = {
    id: tab.id,
    name: tab.name ?? '',
    items: tab.items ?? [],
    opened_at: openedAt,
    settled: false,
  }
  if (tab.limit != null && tab.limit !== '') {
    row.tab_limit = Number(tab.limit)
  }
  return row
}

/** New tab row — explicit insert so creation always hits PostgREST INSERT. */
function insertTabToSupabase(tab) {
  console.log('[tabs] insertTabToSupabase called, supabase:', supabase ? 'defined' : 'NULL')
  if (!supabase || !tab?.id) return
  const row = tabRowForSupabase(tab)
  supabase
    .from('tabs')
    .insert(row)
    .then(({ data, error }) => {
      console.log('[tabs] insert response', { row, data, error })
      if (error) maybeQueueSyncFailure('tabs', row, error)
    })
    .catch(err => {
      console.log('[tabs] insert catch', { row, err })
      maybeQueueSyncFailure('tabs', row, err)
    })
}

function syncTabToSupabase(tab) {
  if (!supabase || !tab?.id) return
  const row = tabRowForSupabase(tab)
  supabase
    .from('tabs')
    .upsert(row, { onConflict: 'id' })
    .then(({ data, error }) => {
      console.log('[tabs] upsert response', { row, data, error })
      if (error) maybeQueueSyncFailure('tabs', row, error)
    })
    .catch(err => {
      console.log('[tabs] upsert catch', { row, err })
      maybeQueueSyncFailure('tabs', row, err)
    })
}

function deleteTabFromSupabase(tabId) {
  if (!supabase || !tabId) return
  supabase
    .from('tabs')
    .delete()
    .eq('id', tabId)
    .then(({ data, error }) => {
      console.log('[tabs] delete response', { tabId, data, error })
      if (error) maybeQueueSyncFailure('tabs_delete', { id: tabId }, error)
    })
    .catch(err => {
      console.log('[tabs] delete catch', { tabId, err })
      maybeQueueSyncFailure('tabs_delete', { id: tabId }, err)
    })
}

async function loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter, options = {}) {
  console.log('[Realtime] loadTabsFromSupabase: start')
  if (!supabase) return []
  // No session_date or other filters — full table. Retries help read-after-write when Realtime fires before SELECT sees the row.
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  let lastError = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase.from('tabs').select('*').order('opened_at', { ascending: true })
      console.log('[Realtime] loadTabsFromSupabase: response', { attempt: i + 1, data, error })
      lastData = data
      lastError = error
      if (error) throw error
      if (data?.length) break
    }
    const rows = lastData ?? []
    const tabs = rows.length
      ? rows.map(row => normaliseTabRowLive(row)).filter(Boolean)
      : []
    setOpenTabs(tabs)
    setOrders(prev => {
      const next = { ...prev }
      for (const t of tabs) {
        if (next[t.id] === undefined) next[t.id] = {}
      }
      for (const k of Object.keys(next)) {
        if (k === 'quick') continue
        if (!tabs.some(t => t.id === k)) delete next[k]
      }
      return next
    })
    let maxSuffix = 0
    for (const t of tabs) {
      const m = /^tab_(\d+)$/.exec(String(t.id))
      if (m) maxSuffix = Math.max(maxSuffix, Number(m[1]))
    }
    if (maxSuffix > 0) {
      setTabIdCounter(c => Math.max(Number(c) || 0, maxSuffix + 1))
    }
    return tabs
  } catch (err) {
    console.warn('loadTabsFromSupabase failed:', err?.message || err)
    return []
  }
}

async function loadTransactionsFromSupabase(setTransactions) {
  console.log('[Realtime] loadTransactionsFromSupabase: start')
  if (!supabase) return
  try {
    const { data, error } = await supabase.from('transactions').select('*').order('time', { ascending: false })
    console.log('[Realtime] loadTransactionsFromSupabase: response', { data, error })
    if (error) throw error
    if (!data?.length) return
    setTransactions(data.map(row => normaliseTransactionRowLive(row)).filter(Boolean))
  } catch (err) {
    console.warn('loadTransactionsFromSupabase failed:', err?.message || err)
  }
}

export default function App() {
  const [view, setView] = useState('till')
  const [products, setProducts] = useLocalStorage('bt_products', INITIAL_PRODUCTS)
  const [productVariants, setProductVariants] = useLocalStorage('bt_product_variants', INITIAL_PRODUCT_VARIANTS)
  const [stockDefinitions, setStockDefinitions] = useLocalStorage('bt_stock_definitions', INITIAL_STOCK_ITEMS)
  const [categoryState, setCategoryState] = useLocalStorage('bt_categories', { till: [], stock: [] })
  const [stock, setStockRaw] = useLocalStorage('bt_stock', Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
  const [stockItems, setStockItemsRaw] = useLocalStorage('bt_stock_items', Object.fromEntries(INITIAL_STOCK_ITEMS.map(s => [s.id, s.stock])))
  const stockSyncReadyRef = useRef(false)

  const setStock = useCallback((update) => {
    setStockRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      if (stockSyncReadyRef.current) syncTillStockToSupabase(next)
      return next
    })
  }, [])

  const setStockItems = useCallback((update) => {
    setStockItemsRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      if (stockSyncReadyRef.current) syncStockToSupabase(next)
      return next
    })
  }, [])
  const [staff, setStaff] = useLocalStorage('bt_staff', INITIAL_STAFF)
  const [currentStaff, setCurrentStaff] = useLocalStorage('bt_current_staff', null)
  const [transactions, setTransactions] = useLocalStorage('bt_transactions', [])
  const [openTabs, setOpenTabs] = useLocalStorage('bt_open_tabs', [])
  const [orders, setOrders] = useLocalStorage('bt_orders', { quick: {} })
  const [activeOrderKey, setActiveOrderKey] = useLocalStorage('bt_active_order', 'quick')
  const [attendanceLog, setAttendanceLog] = useLocalStorage('bt_attendance_log', [])
  const [currentlyIn, setCurrentlyIn] = useLocalStorage('bt_currently_in', [])
  const [staffOverlayOpen, setStaffOverlayOpen] = useState(false)
  const [toast, setToast] = useState({ msg: '', visible: false })
  const [tabIdCounter, setTabIdCounter] = useLocalStorage('bt_tab_counter', 1)
  const mixerStockIds = stockDefinitions.filter(item => item.category === 'Mixers').map(item => item.id)
  const tillCategories = uniqueNonEmpty([
    ...DEFAULT_TILL_CATEGORIES,
    ...(categoryState?.till || []),
    ...products.map(product => product.category),
  ])
  const stockCategories = uniqueNonEmpty([
    ...DEFAULT_STOCK_CATEGORIES,
    ...(categoryState?.stock || []),
    ...stockDefinitions.map(item => item.category),
  ])

  // Restore Date objects from localStorage (they're serialised as strings)
  const hydratedTabs = openTabs.map(t => ({ ...t, openedAt: new Date(t.openedAt) }))
  const hydratedTx = transactions.map(t => ({ ...t, time: new Date(t.time) }))
  const hydratedAttendanceLog = attendanceLog.map(e => ({ ...e, time: new Date(e.time) }))
  const hydratedCurrentlyIn = currentlyIn.map(e => ({ ...e, clockInTime: new Date(e.clockInTime) }))
  const activeSaleStaff = (currentStaff && hydratedCurrentlyIn.some(row => row.staffName === currentStaff))
    ? currentStaff
    : 'Manager'

  useEffect(() => {
    setTimeout(() => setStaffOverlayOpen(true), 300)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await seedSupabase()
      if (cancelled) return
      await loadCategoriesFromSupabase(setCategoryState)
      if (cancelled) return
      await loadProductsFromSupabase(setProducts, setProductVariants)
      if (cancelled) return
      await loadStockFromSupabase(setStockItemsRaw, setStockDefinitions)
      if (cancelled) return
      await loadTillStockFromSupabase(setStockRaw)
      if (cancelled) return
      await loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter)
      if (cancelled) return
      await loadTransactionsFromSupabase(setTransactions)
      stockSyncReadyRef.current = true
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!supabase) return undefined

    // Realtime: refetch full rows on change (avoids payload column / normalise mismatches). BarView bar_orders unchanged.
    const onTabsChange = async () => {
      console.log('[Realtime] tabs event received')
      await loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter)
    }

    const onTransactionsChange = async () => {
      console.log('[Realtime] transactions event received')
      await loadTransactionsFromSupabase(setTransactions)
    }

    const onTillStockChange = async () => {
      console.log('[Realtime] till_stock event received')
      await loadTillStockFromSupabase(setStockRaw)
    }

    const onProductsChange = (payload) => {
      setProducts(prev => mergeProductsRealtime(prev, payload))
    }

    const channel = supabase
      .channel('table-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tabs' }, onTabsChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tabs' }, onTabsChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tabs' }, onTabsChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, onTransactionsChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, onTransactionsChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, onTransactionsChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'till_stock' }, onTillStockChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'till_stock' }, onTillStockChange)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'till_stock' }, onTillStockChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onProductsChange)

    channel.subscribe((status) => {
      console.log('[Realtime] channel status:', status)
    })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [setProducts, setStockRaw, setTransactions, setOpenTabs, setOrders, setTabIdCounter])

  // Migrate legacy staff storage: ["Alice", "Ben"] -> [{ name, pin, role }]
  useEffect(() => {
    if (!Array.isArray(staff) || staff.length === 0) return
    if (typeof staff[0] !== 'string') return
    setStaff(staff.map(s => ({ name: s, pin: '0000', role: 'staff' })))
  }, [staff, setStaff])

  // One-time reset for legacy product sets when menu has changed.
  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) return
    const hasNewMenuIds = products.some(p => p.id >= 22)
    if (hasNewMenuIds) return
    try {
      localStorage.removeItem('bt_products')
      localStorage.removeItem('bt_stock')
      localStorage.removeItem('bt_stock_items')
    } catch {}
    setProducts(INITIAL_PRODUCTS)
    setStock(Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
    setProductVariants(INITIAL_PRODUCT_VARIANTS)
    setStockDefinitions(INITIAL_STOCK_ITEMS)
    setStockItems(Object.fromEntries(INITIAL_STOCK_ITEMS.map(s => [s.id, s.stock])))
  }, [products, setProducts, setProductVariants, setStock, setStockDefinitions, setStockItems])

  useEffect(() => {
    setStockItems(prev => {
      let changed = false
      const next = { ...prev }
      for (const item of stockDefinitions) {
        if (next[item.id] == null) {
          next[item.id] = item.stock ?? 0
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [stockDefinitions, setStockItems])

  useEffect(() => {
    setStock(prev => {
      let changed = false
      const next = { ...prev }
      for (const product of products) {
        if (next[product.id] == null) {
          next[product.id] = product.stock ?? 0
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [products, setStock])

  useEffect(() => {
    if (currentStaff === 'Manager' || !currentStaff) return
    if (hydratedCurrentlyIn.some(row => row.staffName === currentStaff)) return
    setCurrentStaff('Manager')
  }, [currentStaff, hydratedCurrentlyIn, setCurrentStaff])

  const showToast = useCallback((msg) => {
    setToast({ msg, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2400)
  }, [])

  useEffect(() => {
    const onOffline = () => showToast('Offline — sales saving locally')
    window.addEventListener('offline', onOffline)
    return () => window.removeEventListener('offline', onOffline)
  }, [showToast])

  useEffect(() => {
    const onOnline = async () => {
      const pending = readSyncQueue().length
      await flushSyncQueue()
      const after = readSyncQueue().length
      if (pending > 0 && after === 0) {
        showToast('Back online — syncing saved data')
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [showToast])

  const updateStock = useCallback((id, delta) => {
    setStock(s => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + delta) }))
  }, [setStock])

  const setStockValue = useCallback((id, val) => {
    setStock(s => ({ ...s, [id]: Math.max(0, val) }))
  }, [setStock])

  const addTransaction = useCallback((tx) => {
    setTransactions(prev => [tx, ...prev])
    syncTransactionToSupabase(tx)
  }, [setTransactions])

  const updateOrder = useCallback((key, updater) => {
    setOrders(prev => ({ ...prev, [key]: updater(prev[key] || {}) }))
  }, [setOrders])

  const clearOrder = useCallback((key) => {
    setOrders(prev => ({ ...prev, [key]: {} }))
  }, [setOrders])

  const switchOrder = useCallback((key) => {
    setActiveOrderKey(key)
  }, [setActiveOrderKey])

  const openNewTabEntry = useCallback((name) => {
    const id = 'tab_' + tabIdCounter
    setTabIdCounter(c => c + 1)
    const newTab = { id, name, items: [], openedAt: new Date(), staff: activeSaleStaff }
    setOpenTabs(prev => [...prev, newTab])
    setOrders(prev => ({ ...prev, [id]: {} }))
    console.log('[tabs] openNewTabEntry calling insertTabToSupabase for', newTab.id)
    insertTabToSupabase(newTab)
    switchOrder(id)
    showToast('Tab opened: ' + name)
    return id
  }, [tabIdCounter, activeSaleStaff, setTabIdCounter, setOpenTabs, setOrders, switchOrder, showToast])

  const commitItemsToTab = useCallback((tabId) => {
    const order = orders[tabId] || {}
    if (Object.keys(order).length === 0) return false
    const tabRow = openTabs.find(t => t.id === tabId)
    if (!tabRow) return false
    const limit = tabRow.limit ?? DEFAULT_TAB_LIMIT
    const orderTotal = getOrderTotal(order, products)
    const currentTabTotal = tabTotal(tabRow)
    const projectedTotal = currentTabTotal + orderTotal
    if (projectedTotal > limit) {
      showToast(
        `Cannot add items to ${tabRow.name}: current tab ${fmt(currentTabTotal)} plus ${fmt(orderTotal)} (${fmt(projectedTotal)} total) exceeds limit ${fmt(limit)}.`,
      )
      return false
    }
    setOpenTabs(prev => {
      let updatedTab = null
      const next = prev.map(tab => {
        if (tab.id !== tabId) return tab
        const newItems = [...tab.items]
        Object.entries(order).forEach(([id, line]) => {
          const qty = typeof line === 'number' ? line : (line?.qty || 0)
          const selectedStockId = typeof line === 'object' ? line?.selectedStockId : null
          const selectedMixerId = typeof line === 'object' ? line?.selectedMixerId : null
          const p = products.find(x => x.id === Number(id))
          if (!p) return
          if (selectedStockId && productVariants[p.id]) {
            const deduct = productVariants[p.id].deduct || 1
            const amount = deduct * qty
            setStockItems(prev => ({ ...prev, [selectedStockId]: Math.max(0, (prev[selectedStockId] ?? 0) - amount) }))
          } else {
            const unitsToDeduct = p.bottleYield ? (qty / p.bottleYield) : qty
            setStock(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - unitsToDeduct) }))
          }
          if (selectedMixerId) {
            const mixerDef = stockDefinitions.find(s => s.id === selectedMixerId)
            const mixDed = mixerBottleDeductionForLine(p.id, qty, mixerDef?.bottleYield)
            setStockItems(prev => ({
              ...prev,
              [selectedMixerId]: Math.max(0, (prev[selectedMixerId] ?? 0) - mixDed),
            }))
          }
          const ex = newItems.find(i => {
            const sameProduct = i.productId === p.id || (!i.productId && i.name === p.name)
            return (
              sameProduct &&
              (i.selectedStockId ?? null) === (selectedStockId ?? null) &&
              (i.selectedMixerId ?? null) === (selectedMixerId ?? null)
            )
          })
          if (ex) ex.qty += qty
          else newItems.push({ name: p.name, qty, price: p.price, productId: p.id, selectedStockId, selectedMixerId })
        })
        updatedTab = { ...tab, items: newItems }
        return updatedTab
      })
      if (updatedTab) queueMicrotask(() => syncTabToSupabase(updatedTab))
      return next
    })
    clearOrder(tabId)
    showToast('Items added to ' + (tabRow.name || 'tab'))
    return true
  }, [orders, products, productVariants, stockDefinitions, openTabs, setOpenTabs, setStock, setStockItems, clearOrder, showToast])

  const settleTab = useCallback((tabId, payment, extras = {}) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (!tab) return
    const total = tabTotal(tab)
    addTransaction({
      id: Date.now(),
      time: new Date(),
      total,
      items: tab.items,
      payment,
      staff: activeSaleStaff,
      type: 'tab',
      tabName: tab.name,
      voided: false,
      ...(payment === 'cash' ? {
        tenderedAmount: extras.tenderedAmount ?? null,
        changeGiven: extras.changeGiven ?? null,
      } : {}),
    })
    deleteTabFromSupabase(tabId)
    setOpenTabs(prev => prev.filter(t => t.id !== tabId))
    setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
    if (activeOrderKey === tabId) switchOrder('quick')
    showToast('Tab settled — ' + fmt(total))
  }, [openTabs, addTransaction, activeSaleStaff, setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  const cancelTab = useCallback((tabId) => {
    deleteTabFromSupabase(tabId)
    setOpenTabs(prev => prev.filter(t => t.id !== tabId))
    setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
    if (activeOrderKey === tabId) switchOrder('quick')
    showToast('Tab cancelled')
  }, [setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  const processCharge = useCallback((payment, extras = {}) => {
    const order = orders['quick'] || {}
    const items = orderToItems(order, products)
    const total = getOrderTotal(order, products)
    items.forEach(i => {
      const p = products.find(x => x.id === i.productId || x.name === i.name)
      if (p) {
        if (i.selectedStockId && productVariants[p.id]) {
          const deduct = productVariants[p.id].deduct || 1
          const amount = deduct * i.qty
          setStockItems(prev => ({ ...prev, [i.selectedStockId]: Math.max(0, (prev[i.selectedStockId] ?? 0) - amount) }))
        } else {
          const unitsToDeduct = p.bottleYield ? (i.qty / p.bottleYield) : i.qty
          setStock(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - unitsToDeduct) }))
        }
        if (i.selectedMixerId) {
          const mixerDef = stockDefinitions.find(s => s.id === i.selectedMixerId)
          const mixDed = mixerBottleDeductionForLine(p.id, i.qty, mixerDef?.bottleYield)
          setStockItems(prev => ({
            ...prev,
            [i.selectedMixerId]: Math.max(0, (prev[i.selectedMixerId] ?? 0) - mixDed),
          }))
        }
      }
    })
    const tx = {
      id: Date.now(),
      time: new Date(),
      total,
      items,
      payment,
      staff: activeSaleStaff,
      type: 'sale',
      voided: false,
      ...(payment === 'cash' ? {
        tenderedAmount: extras.tenderedAmount ?? null,
        changeGiven: extras.changeGiven ?? null,
      } : {}),
    }
    addTransaction(tx)
    clearOrder('quick')
    showToast('Sale recorded — ' + fmt(total))
  }, [orders, products, productVariants, stockDefinitions, addTransaction, activeSaleStaff, setStock, setStockItems, clearOrder, showToast])

  const voidTransaction = useCallback((txId) => {
    setTransactions(prev => {
      let voided = null
      const next = prev.map(tx => {
        if (tx.id !== txId || tx.voided) return tx
        tx.items.forEach(i => {
          const p = products.find(x => x.id === i.productId || x.name === i.name)
          if (p) {
            if (i.selectedStockId && productVariants[p.id]) {
              const deduct = productVariants[p.id].deduct || 1
              const amount = deduct * i.qty
              setStockItems(prev => ({ ...prev, [i.selectedStockId]: (prev[i.selectedStockId] ?? 0) + amount }))
            } else {
              const unitsToRestore = p.bottleYield ? (i.qty / p.bottleYield) : i.qty
              setStock(s => ({ ...s, [p.id]: (s[p.id] ?? 0) + unitsToRestore }))
            }
            if (i.selectedMixerId) {
              const mixerDef = stockDefinitions.find(s => s.id === i.selectedMixerId)
              const mixDed = mixerBottleDeductionForLine(p.id, i.qty, mixerDef?.bottleYield)
              setStockItems(prev => ({
                ...prev,
                [i.selectedMixerId]: (prev[i.selectedMixerId] ?? 0) + mixDed,
              }))
            }
          }
        })
        voided = { ...tx, voided: true, voidedAt: new Date() }
        return voided
      })
      if (voided) queueMicrotask(() => syncTransactionToSupabase(voided))
      return next
    })
    showToast('Transaction voided — stock restored')
  }, [products, productVariants, stockDefinitions, setTransactions, setStock, setStockItems, showToast])

  const mergePreviewIntoTabOrder = useCallback((tabOrder, quickOrder) => {
    return Object.entries(quickOrder).reduce((acc, [id, line]) => {
      const qty = typeof line === 'number' ? line : (line?.qty || 0)
      const selectedStockId = typeof line === 'object' ? line?.selectedStockId : null
      const selectedMixerId = typeof line === 'object' ? line?.selectedMixerId : null
      const existing = acc[id]
      const existingQty = typeof existing === 'number' ? existing : (existing?.qty || 0)
      return {
        ...acc,
        [id]: {
          qty: existingQty + qty,
          selectedStockId: selectedStockId || (typeof existing === 'object' ? existing?.selectedStockId : null) || null,
          selectedMixerId: selectedMixerId || (typeof existing === 'object' ? existing?.selectedMixerId : null) || null,
        },
      }
    }, { ...tabOrder })
  }, [])

  const mergeOrderToTab = useCallback((tabId) => {
    const tabRow = openTabs.find(t => t.id === tabId)
    if (!tabRow) return
    const src = orders['quick'] || {}
    const tabOrder = orders[tabId] || {}
    const merged = mergePreviewIntoTabOrder(tabOrder, src)
    const limit = tabRow.limit ?? DEFAULT_TAB_LIMIT
    const projectedPending = getOrderTotal(merged, products)
    const mergeCommitted = tabTotal(tabRow)
    const mergeProjectedTotal = mergeCommitted + projectedPending
    if (mergeProjectedTotal > limit) {
      showToast(
        `Cannot add items to ${tabRow.name}: current tab ${fmt(mergeCommitted)} plus pending order ${fmt(projectedPending)} (${fmt(mergeProjectedTotal)} total) exceeds limit ${fmt(limit)}.`,
      )
      return
    }
    setOrders(prev => ({
      ...prev,
      [tabId]: mergePreviewIntoTabOrder(prev[tabId] || {}, src),
      quick: {},
    }))
    switchOrder(tabId)
    showToast('Items added to ' + (tabRow.name || 'tab'))
  }, [orders, openTabs, products, setOrders, switchOrder, showToast, mergePreviewIntoTabOrder])

  const updateTabLimit = useCallback((tabId, newLimit) => {
    const n = Number(newLimit)
    if (Number.isNaN(n)) return
    setOpenTabs(prev => {
      const next = prev.map(t => (t.id === tabId ? { ...t, limit: n } : t))
      const row = next.find(t => t.id === tabId)
      if (row) queueMicrotask(() => syncTabToSupabase(row))
      return next
    })
    showToast(`Tab limit updated to ${fmt(n)}`)
  }, [setOpenTabs, showToast])

  const saveProduct = useCallback((product, variant) => {
    const cleanProduct = {
      ...product,
      id: Number(product.id),
      name: String(product.name || '').trim(),
      price: Number(product.price || 0),
      category: product.category,
      stock: product.stock ?? 0,
    }
    setProducts(prev => {
      const exists = prev.some(p => p.id === cleanProduct.id)
      return exists
        ? prev.map(p => (p.id === cleanProduct.id ? { ...p, ...cleanProduct } : p))
        : [...prev, cleanProduct]
    })
    setProductVariants(prev => {
      const next = { ...prev }
      if (variant) next[cleanProduct.id] = variant
      else delete next[cleanProduct.id]
      return next
    })
    setStock(prev => ({ ...prev, [cleanProduct.id]: prev[cleanProduct.id] ?? cleanProduct.stock ?? 0 }))
    upsertProductToSupabase(cleanProduct)
      .then(() => upsertProductVariantToSupabase(cleanProduct.id, variant))
      .catch(err => console.warn('saveProduct failed:', err?.message || err))
    showToast('Product saved')
  }, [setProducts, setProductVariants, setStock, showToast])

  const deleteProduct = useCallback((productId) => {
    const id = Number(productId)
    setProducts(prev => prev.filter(p => p.id !== id))
    setProductVariants(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setStock(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    deleteProductFromSupabase(id)
      .catch(err => console.warn('deleteProduct failed:', err?.message || err))
    showToast('Product deleted')
  }, [setProducts, setProductVariants, setStock, showToast])

  const saveStockDefinition = useCallback((item) => {
    const cleanItem = {
      ...item,
      name: String(item.name || '').trim(),
      category: item.category,
      unit: item.unit,
      ...(item.bottleYield === '' || item.bottleYield == null ? {} : { bottleYield: Number(item.bottleYield) }),
      ...(item.displayUnit ? { displayUnit: item.displayUnit } : {}),
    }
    setStockDefinitions(prev => {
      const exists = prev.some(row => row.id === cleanItem.id)
      return exists
        ? prev.map(row => (row.id === cleanItem.id ? { ...row, ...cleanItem } : row))
        : [...prev, cleanItem]
    })
    const qty = stockItems?.[cleanItem.id] ?? cleanItem.stock ?? 0
    setStockItems(prev => ({ ...prev, [cleanItem.id]: prev[cleanItem.id] ?? qty }))
    upsertStockDefinitionToSupabase(cleanItem, qty)
      .catch(err => console.warn('saveStockDefinition failed:', err?.message || err))
    showToast('Stock item saved')
  }, [setStockDefinitions, setStockItems, stockItems, showToast])

  const deleteStockDefinition = useCallback((stockKey) => {
    setStockDefinitions(prev => prev.filter(item => item.id !== stockKey))
    setStockItems(prev => {
      const next = { ...prev }
      delete next[stockKey]
      return next
    })
    const nextVariants = {}
    const changedVariants = []
    for (const [productId, variant] of Object.entries(productVariants)) {
      const nextVariant = {
        ...variant,
        stockIds: (variant.stockIds || []).filter(id => id !== stockKey),
        mixerStockIds: (variant.mixerStockIds || []).filter(id => id !== stockKey),
        ...(variant.fixedSpiritStockId === stockKey ? { fixedSpiritStockId: null } : {}),
      }
      nextVariants[productId] = nextVariant
      if (
        (variant.stockIds || []).length !== nextVariant.stockIds.length ||
        (variant.mixerStockIds || []).length !== nextVariant.mixerStockIds.length ||
        variant.fixedSpiritStockId === stockKey
      ) {
        changedVariants.push([productId, nextVariant])
      }
    }
    setProductVariants(nextVariants)
    deleteStockDefinitionFromSupabase(stockKey)
      .catch(err => console.warn('deleteStockDefinition failed:', err?.message || err))
    changedVariants.forEach(([productId, variant]) => {
      upsertProductVariantToSupabase(productId, variant)
        .catch(err => console.warn('update variant after stock delete failed:', err?.message || err))
    })
    showToast('Stock item deleted')
  }, [productVariants, setStockDefinitions, setStockItems, setProductVariants, showToast])

  const saveCategory = useCallback((type, rawName) => {
    const name = String(rawName || '').trim()
    if (!name || !['till', 'stock'].includes(type)) return ''
    const currentCategories = type === 'till' ? tillCategories : stockCategories
    if (currentCategories.some(category => category.toLowerCase() === name.toLowerCase())) {
      return currentCategories.find(category => category.toLowerCase() === name.toLowerCase()) || name
    }
    setCategoryState(prev => ({
      till: type === 'till' ? uniqueNonEmpty([...(prev?.till || []), name]) : (prev?.till || []),
      stock: type === 'stock' ? uniqueNonEmpty([...(prev?.stock || []), name]) : (prev?.stock || []),
    }))
    saveCategoryToSupabase(type, name)
      .catch(err => console.warn('saveCategory failed:', err?.message || err))
    showToast('Category added')
    return name
  }, [setCategoryState, showToast, stockCategories, tillCategories])

  const clockInStaff = useCallback((staffName) => {
    if (!staffName) return
    setCurrentlyIn(prev => {
      if (prev.some(row => row.staffName === staffName)) return prev
      return [...prev, { staffName, clockInTime: new Date() }]
    })
    setAttendanceLog(prev => [...prev, { id: Date.now() + Math.random(), staffName, action: 'in', time: new Date() }])
    showToast(`${staffName} clocked in`)
  }, [setCurrentlyIn, setAttendanceLog, showToast])

  const clockOutStaff = useCallback((staffName) => {
    if (!staffName) return
    setCurrentlyIn(prev => prev.filter(row => row.staffName !== staffName))
    setAttendanceLog(prev => [...prev, { id: Date.now() + Math.random(), staffName, action: 'out', time: new Date() }])
    showToast(`${staffName} clocked out`)
  }, [setCurrentlyIn, setAttendanceLog, showToast])

  const sharedProps = {
    products, setProducts,
    productVariants, setProductVariants,
    stock, updateStock, setStockValue,
    stockItems, setStockItems,
    stockDefinitions, setStockDefinitions,
    tillCategories,
    stockCategories,
    mixerStockIds,
    staff, setStaff,
    currentStaff, setCurrentStaff,
    attendanceLog: hydratedAttendanceLog, setAttendanceLog,
    currentlyIn: hydratedCurrentlyIn, setCurrentlyIn,
    clockInStaff, clockOutStaff,
    transactions: hydratedTx, setTransactions,
    openTabs: hydratedTabs, setOpenTabs,
    orders, updateOrder, clearOrder,
    activeOrderKey, switchOrder,
    openNewTabEntry, commitItemsToTab,
    settleTab, cancelTab, updateTabLimit,
    processCharge, voidTransaction, mergeOrderToTab,
    saveProduct, deleteProduct,
    saveStockDefinition, deleteStockDefinition,
    saveCategory,
    showToast,
  }

  return (
    <>
      <Header
        currentStaff={currentStaff}
        onStaffClick={() => setStaffOverlayOpen(true)}
      />
      <Nav
        view={view}
        setView={setView}
        openTabsCount={hydratedTabs.length}
      />
      {view === 'till'  && <Till  {...sharedProps} />}
      {view === 'bar'  && <BarView showToast={showToast} />}
      {view === 'tabs'  && <TabsView {...sharedProps} />}
      {view === 'stock' && <Stock  {...sharedProps} />}
      {view === 'staff' && <StaffLog {...sharedProps} />}
      {view === 'sales' && <Sales  {...sharedProps} />}
      {view === 'settings' && <Settings {...sharedProps} />}

      {staffOverlayOpen && (
        <StaffOverlay
          onSelect={(name) => {
            setCurrentStaff(name)
            setStaffOverlayOpen(false)
            showToast('Serving as ' + name)
          }}
          onClose={() => setStaffOverlayOpen(false)}
        />
      )}
      <Toast msg={toast.msg} visible={toast.visible} />
    </>
  )
}
