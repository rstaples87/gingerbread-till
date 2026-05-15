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
import { supabase, isSupabaseConfigured } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
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
  normaliseTabRowLive,
  normaliseTransactionRowLive,
} from './supabaseRealtimeMerge'

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
      const staffRes = await supabase.from('staff').insert(
        INITIAL_STAFF.map(s => ({
          name: s.name,
          pin: s.pin ?? '0000',
          role: s.role ?? 'staff',
        })),
      )
      logSupabaseWrite('staff', 'insert', staffRes.error)
    }
    const { data: stockSample } = await supabase.from('stock_items').select('stock_key').limit(1)
    if (!stockSample?.length) {
      const seedRows = INITIAL_STOCK_ITEMS.map(s => ({ stock_key: s.id, qty: s.stock ?? 0 }))
      const stockSeedRes = await supabase.from('stock_items').insert(seedRows)
      logSupabaseWrite('stock_items', 'insert', stockSeedRes.error)
    }
  } catch (err) {
    console.warn('Supabase seed failed:', err?.message || err)
  }
}

/** Single warehouse stock_items row (Stock take tab). */
function upsertStockItemRowToSupabase(stockKey, qty) {
  if (!supabase) return
  const row = { stock_key: stockKey, qty: Number(qty) }
  supabase
    .from('stock_items')
    .upsert(row, { onConflict: 'stock_key' })
    .then(({ error }) => {
      logSupabaseWrite('stock_items', 'upsert', error)
      if (error) maybeQueueSyncFailure('stock', row, error)
    })
    .catch(err => {
      logSupabaseWrite('stock_items', 'upsert', err)
      maybeQueueSyncFailure('stock', row, err)
    })
}

/** Upsert warehouse stock map — fire-and-forget */
function syncStockToSupabase(map) {
  if (!supabase || !map) return
  for (const [stock_key, qty] of Object.entries(map)) {
    upsertStockItemRowToSupabase(stock_key, qty)
  }
}

async function loadStockItemsFromSupabase(setStockItemsRaw, options = {}) {
  if (!supabase) return 0
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase.from('stock_items').select('stock_key, qty')
      if (error) throw error
      lastData = data
      if (data?.length) break
    }
    const rows = lastData ?? []
    if (!rows.length) return 0
    setStockItemsRaw(prev => {
      const next = { ...prev }
      for (const row of rows) {
        next[row.stock_key] = Number(row.qty)
      }
      return next
    })
    return rows.length
  } catch (err) {
    console.warn('loadStockItemsFromSupabase failed:', err?.message || err)
    return 0
  }
}

/** Optional metadata columns — skipped silently if schema only has stock_key/qty. */
async function tryLoadStockDefinitionsFromSupabase(setStockDefinitions) {
  if (!supabase) return
  const { data, error } = await supabase
    .from('stock_items')
    .select('stock_key, name, category, unit, bottle_yield, display_unit')
  if (error || !data?.length) return
  const hasDefinitions = data.some(row => row.name || row.category || row.unit || row.bottle_yield != null)
  if (!hasDefinitions) return
  setStockDefinitions(prev => {
    const fallbackById = Object.fromEntries(prev.map(item => [item.id, item]))
    return data.map(row => normaliseStockDefinitionRow(row, fallbackById[row.stock_key]))
  })
}

/** Bootstrap: stock take qty from Supabase; definitions merged only when optional columns exist. */
async function loadStockFromSupabase(setStockItemsRaw, setStockDefinitions) {
  const count = await loadStockItemsFromSupabase(setStockItemsRaw)
  if (setStockDefinitions) await tryLoadStockDefinitionsFromSupabase(setStockDefinitions)
  return count
}

/** Single till menu product row — used on every stock change and sale deduction. */
function upsertTillStockRowToSupabase(productId, qty) {
  if (!supabase) return
  const row = { product_id: Number(productId), qty: Number(qty) }
  supabase
    .from('till_stock')
    .upsert(row, { onConflict: 'product_id' })
    .then(({ error }) => {
      logSupabaseWrite('till_stock', 'upsert', error)
      if (error) maybeQueueSyncFailure('till_stock', row, error)
    })
    .catch(err => {
      logSupabaseWrite('till_stock', 'upsert', err)
      maybeQueueSyncFailure('till_stock', row, err)
    })
}

/** Bulk till_stock sync (e.g. offline queue flush). */
function syncTillStockToSupabase(map) {
  if (!supabase || !map) return
  for (const [product_id, qty] of Object.entries(map)) {
    upsertTillStockRowToSupabase(product_id, qty)
  }
}

async function loadTillStockFromSupabase(setStockRaw, options = {}) {
  if (!supabase) return 0
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase.from('till_stock').select('product_id, qty')
      if (error) throw error
      lastData = data
      if (data?.length) break
    }
    const rows = lastData ?? []
    const next = {}
    for (const row of rows) {
      next[row.product_id] = Number(row.qty)
    }
    setStockRaw(next)
    return rows.length
  } catch (err) {
    console.warn('loadTillStockFromSupabase failed:', err?.message || err)
    return 0
  }
}

async function upsertStockDefinitionToSupabase(item, qty) {
  if (!supabase) return
  const qtyVal = Number(qty ?? item.stock ?? 0)
  const fullRow = {
    stock_key: item.id,
    qty: qtyVal,
    name: item.name,
    category: item.category,
    unit: item.unit,
    bottle_yield: item.bottleYield == null ? null : Number(item.bottleYield),
    display_unit: item.displayUnit || null,
  }
  let { error } = await supabase.from('stock_items').upsert(fullRow, { onConflict: 'stock_key' })
  if (error) {
    const minimal = await supabase.from('stock_items').upsert(
      { stock_key: item.id, qty: qtyVal },
      { onConflict: 'stock_key' },
    )
    error = minimal.error
  }
  logSupabaseWrite('stock_items', 'upsert', error)
  if (error) throw error
}

async function deleteStockDefinitionFromSupabase(stockKey) {
  if (!supabase) return
  const { error } = await supabase.from('stock_items').delete().eq('stock_key', stockKey)
  logSupabaseWrite('stock_items', 'delete', error)
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
      logSupabaseWrite('transactions', 'upsert', error)
      if (error) maybeQueueSyncFailure('transaction', row, error)
    })
    .catch(err => {
      logSupabaseWrite('transactions', 'upsert', err)
      maybeQueueSyncFailure('transaction', row, err)
    })
}

/** Columns on public.tabs we may write: id, name, items, opened_at, tab_limit (settled tabs are deleted, not stored). */
function tabRowForSupabase(tab) {
  const openedAt =
    tab.openedAt instanceof Date ? tab.openedAt.toISOString()
      : tab.openedAt ?? new Date().toISOString()
  const row = {
    id: tab.id,
    name: tab.name ?? '',
    items: tab.items ?? [],
    opened_at: openedAt,
  }
  if (tab.limit != null && tab.limit !== '') {
    row.tab_limit = Number(tab.limit)
  }
  return row
}

/** New tab — upsert so create is idempotent if the row already exists. */
function insertTabToSupabase(tab) {
  syncTabToSupabase(tab)
}

function syncTabToSupabase(tab) {
  if (!supabase || !tab?.id) return
  const row = tabRowForSupabase(tab)
  supabase
    .from('tabs')
    .upsert(row, { onConflict: 'id' })
    .then(({ error }) => {
      logSupabaseWrite('tabs', 'upsert', error)
      if (error) maybeQueueSyncFailure('tabs', row, error)
    })
    .catch(err => {
      logSupabaseWrite('tabs', 'upsert', err)
      maybeQueueSyncFailure('tabs', row, err)
    })
}

function deleteTabFromSupabase(tabId) {
  if (!supabase || !tabId) return
  supabase
    .from('tabs')
    .delete()
    .eq('id', tabId)
    .then(({ error }) => {
      logSupabaseWrite('tabs', 'delete', error)
      if (error) maybeQueueSyncFailure('tabs_delete', { id: tabId }, error)
    })
    .catch(err => {
      logSupabaseWrite('tabs', 'delete', err)
      maybeQueueSyncFailure('tabs_delete', { id: tabId }, err)
    })
}

async function loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter, options = {}) {
  if (!supabase) return []
  // No session_date or other filters — full table. Retries help read-after-write when Realtime fires before SELECT sees the row.
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase
        .from('tabs')
        .select('*')
        .order('opened_at', { ascending: true })
      lastData = data
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

async function loadTransactionsFromSupabase(setTransactions, options = {}) {
  if (!supabase) return 0
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase.from('transactions').select('*').order('time', { ascending: false })
      if (error) throw error
      lastData = data
      if (data?.length) break
    }
    const rows = lastData ?? []
    const txs = rows.length
      ? rows.map(row => normaliseTransactionRowLive(row)).filter(Boolean)
      : []
    setTransactions(txs)
    return txs.length
  } catch (err) {
    console.warn('loadTransactionsFromSupabase failed:', err?.message || err)
    return 0
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
  const setStock = useCallback((update) => {
    setStockRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      if (supabase) {
        const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
        for (const id of keys) {
          if (Number(prev?.[id] ?? 0) !== Number(next?.[id] ?? 0)) {
            upsertTillStockRowToSupabase(id, next[id] ?? 0)
          }
        }
      }
      return next
    })
  }, [])

  const setStockItems = useCallback((update) => {
    setStockItemsRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update
      if (supabase) {
        const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
        for (const id of keys) {
          if (Number(prev?.[id] ?? 0) !== Number(next?.[id] ?? 0)) {
            upsertStockItemRowToSupabase(id, next[id] ?? 0)
          }
        }
      }
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
  const tabsLoadSettersRef = useRef({ setOpenTabs, setOrders, setTabIdCounter })
  tabsLoadSettersRef.current = { setOpenTabs, setOrders, setTabIdCounter }
  const tabsRealtimeChannelNameRef = useRef(null)
  if (!tabsRealtimeChannelNameRef.current) {
    const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`
    tabsRealtimeChannelNameRef.current = `till_realtime_tabs_${suffix}`
  }
  const transactionsSetterRef = useRef(setTransactions)
  transactionsSetterRef.current = setTransactions
  const tillStockSetterRef = useRef(setStockRaw)
  tillStockSetterRef.current = setStockRaw
  const stockItemsSetterRef = useRef(setStockItemsRaw)
  stockItemsSetterRef.current = setStockItemsRaw
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
    if (!isSupabaseConfigured) {
      console.warn('[Supabase write] disabled — VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing at build time')
    }
    let cancelled = false
    ;(async () => {
      await seedSupabase()
      if (cancelled) return
      await loadStockFromSupabase(setStockItemsRaw, setStockDefinitions)
      if (cancelled) return
      await loadTillStockFromSupabase(setStockRaw)
      if (cancelled) return
      await loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter)
      if (cancelled) return
      await loadTransactionsFromSupabase(setTransactions)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return undefined
    }

    const channels = []

    const onTabsChange = async () => {
      const { setOpenTabs: setTabs, setOrders: setOrds, setTabIdCounter: setCounter } = tabsLoadSettersRef.current
      await loadTabsFromSupabase(setTabs, setOrds, setCounter, { retryOnEmpty: true })
    }

    const onTransactionsChange = async () => {
      await loadTransactionsFromSupabase(transactionsSetterRef.current, { retryOnEmpty: true })
    }

    const onTillStockChange = async () => {
      await loadTillStockFromSupabase(tillStockSetterRef.current, { retryOnEmpty: true })
    }

    const onStockItemsChange = async () => {
      await loadStockItemsFromSupabase(stockItemsSetterRef.current, { retryOnEmpty: true })
    }

    const subscribeTable = (channelName, table, handler) => {
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, handler)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, handler)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, handler)
      channel.subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(
            `[Realtime] ${table} channel error — ensure public.${table} is in supabase_realtime publication`,
            err,
          )
        }
      })
      channels.push(channel)
      return channel
    }

    const tabsChannelName = tabsRealtimeChannelNameRef.current
    const txChannelName = 'till_realtime_transactions'
    const tillStockChannelName = 'till_realtime_stock'
    const stockItemsChannelName = 'till_realtime_stock_items'

    subscribeTable(tabsChannelName, 'tabs', onTabsChange)
    subscribeTable(txChannelName, 'transactions', onTransactionsChange)
    subscribeTable(tillStockChannelName, 'till_stock', onTillStockChange)
    subscribeTable(stockItemsChannelName, 'stock_items', onStockItemsChange)

    return () => {
      for (const channel of channels) {
        supabase.removeChannel(channel)
      }
    }
  }, [])

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
    setStockRaw(Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
    setProductVariants(INITIAL_PRODUCT_VARIANTS)
    setStockDefinitions(INITIAL_STOCK_ITEMS)
    setStockItemsRaw(Object.fromEntries(INITIAL_STOCK_ITEMS.map(s => [s.id, s.stock])))
  }, [products, setProducts, setProductVariants, setStockRaw, setStockDefinitions, setStockItemsRaw])

  useEffect(() => {
    setStockItemsRaw(prev => {
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
  }, [stockDefinitions, setStockItemsRaw])

  useEffect(() => {
    setStockRaw(prev => {
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
  }, [products, setStockRaw])

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

  /** Stock view “Till products” ± — writes till_stock only (product_id, qty). */
  const adjustTillStock = useCallback((productId, delta) => {
    setStockRaw(prev => {
      const newQty = Math.max(0, (prev[productId] ?? 0) + delta)
      if (supabase) {
        upsertTillStockRowToSupabase(productId, newQty)
      }
      return { ...prev, [productId]: newQty }
    })
  }, [])

  const setStockValue = useCallback((productId, val) => {
    const newQty = Math.max(0, val)
    if (supabase) {
      upsertTillStockRowToSupabase(productId, newQty)
    }
    setStockRaw(prev => ({ ...prev, [productId]: newQty }))
  }, [])

  /** Stock view “Stock take” ± — writes stock_items only (stock_key, qty). */
  const adjustStockItem = useCallback((stockKey, delta) => {
    setStockItemsRaw(prev => {
      const newQty = Math.max(0, (prev[stockKey] ?? 0) + delta)
      if (supabase) {
        upsertStockItemRowToSupabase(stockKey, newQty)
      }
      return { ...prev, [stockKey]: newQty }
    })
  }, [])

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
      if (updatedTab) syncTabToSupabase(updatedTab)
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
      if (voided) syncTransactionToSupabase(voided)
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
      if (row) syncTabToSupabase(row)
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
    console.warn('[Supabase] products table does not exist — product saved locally only')
    showToast('Product saved (local only)')
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
    console.warn('[Supabase] products table does not exist — product deleted locally only')
    showToast('Product deleted (local only)')
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
    if (changedVariants.length) {
      console.warn('[Supabase] product_variants table does not exist — variant links updated locally only')
    }
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
    console.warn('[Supabase] categories table does not exist — category saved locally only')
    showToast('Category added (local only)')
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
    stock, adjustTillStock, setStockValue, adjustStockItem,
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
