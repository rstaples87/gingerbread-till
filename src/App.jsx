import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage'
import {
  INITIAL_PRODUCTS as BAR_PRODUCTS,
  INITIAL_STAFF,
  STOCK_ITEMS as BAR_STOCK_ITEMS,
  PRODUCT_VARIANTS as BAR_PRODUCT_VARIANTS,
  DEFAULT_TAB_LIMIT,
  ADMIN_PIN,
  CATEGORIES as BAR_TILL_CATEGORIES,
  POS_TILL_CATEGORIES,
  STOCK_CATEGORIES as DEFAULT_STOCK_CATEGORIES,
} from './data'
import { supabase, isSupabaseConfigured } from './supabase'
import { useVenueAuth, signOutVenue } from './auth'
import VenueSignIn from './components/VenueSignIn'
import ManagerGate from './components/ManagerGate'
import Reports from './components/Reports'
import Tables from './components/Tables'
import SplitBill from './components/SplitBill'
import DiscountSheet from './components/DiscountSheet'
import { sendStationNotice, stationsFor } from './displayNotices'
import { features, isPosMode } from './features'

// The events Till starts from the built-in bar menu. The Haywain POS starts empty (its menu is entered in Settings),
// so a fresh POS device never loads the bar menu into the POS database.
const INITIAL_PRODUCTS = isPosMode ? [] : BAR_PRODUCTS
const INITIAL_STOCK_ITEMS = isPosMode ? [] : BAR_STOCK_ITEMS
const INITIAL_PRODUCT_VARIANTS = isPosMode ? {} : BAR_PRODUCT_VARIANTS
const DEFAULT_TILL_CATEGORIES = isPosMode ? POS_TILL_CATEGORIES : BAR_TILL_CATEGORIES
import { logSupabaseWrite } from './supabaseWriteLog'
import { fmt, getOrderTotal, orderToItems, orderLineLabel, tabTotal, mixerBottleDeductionForLine, localSessionDateString, lineTaxFields, lineProductId, lineSignature, tabLabel, tableLabel, mergeTabData, unmergeTabData, takeItemsPart, takeEvenShare, allocateDiscount, clearDiscount, lineAmount } from './utils'
import Header from './components/Header'
import Nav from './components/Nav'
import Till from './components/Till'
import TabsView from './components/TabsView'
import Stock from './components/Stock'
import StaffLog from './components/StaffLog'
import UpdateBanner from './components/UpdateBanner'
import Sales from './components/Sales'
import Settings from './components/Settings'
import BarView from './components/BarView'
import StaffOverlay from './components/StaffOverlay'
import Toast from './components/Toast'
import { readSyncQueue, readPendingEodReportRows, readPendingAttendanceRows, readPendingAttendanceSaveRanges, maybeQueueSyncFailure, flushSyncQueue, enqueueSyncQueueItem, isLikelyNetworkFailure } from './syncQueue'
import {
  syncTransactionToSupabaseFireAndForget,
  fetchTodayTransactionsFromSupabase,
  dedupeTransactionsById,
  mergeTransactionsDeduped,
} from './transactionSync'
import { loadEodReportsWithFallback } from './eodReportsSupabase'
import {
  applyMenuOp,
  fetchMenuFromSupabase,
  seedMenuToSupabase,
  productToRow,
  stockDefinitionToRow,
} from './menuSupabase'
import { normaliseTabRowLive } from './supabaseRealtimeMerge'
import { applyStaffOp, withPendingStaffOps } from './staffSupabase'
import {
  loadTillStockFromSupabase,
  upsertTillStockRowToSupabase,
  applyTillStockDelta,
  applyStockItemDelta,
  withPendingDeltas,
} from './tillStockSupabase'

function uniqueNonEmpty(items) {
  return Array.from(new Set(items.map(item => String(item || '').trim()).filter(Boolean)))
}

function logStaffWrite(operation, error) {
  if (error) {
    logSupabaseWrite('staff', operation, error)
    return
  }
  console.log(`[Supabase write] staff ${operation} ok`)
}

/** Write a staff change; queue it if the network is down. */
function sendStaffOp(type, payload) {
  if (!supabase) return
  applyStaffOp(type, payload).then(({ error }) => {
    logStaffWrite(type, error)
    if (error) maybeQueueSyncFailure(type, payload, error)
  })
}

function newStaffUuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `staff_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function normaliseStaffRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    pin: String(row.pin ?? '0000'),
    role: row.role ?? 'staff',
    active: row.active !== false,
  }
}

async function loadStaffFromSupabase(setStaff, fallback) {
  if (!supabase) {
    if (fallback != null) setStaff(fallback)
    return false
  }
  try {
    let { data, error } = await supabase
      .from('staff')
      .select('id, name, pin, role, active')
      .order('name', { ascending: true })
    if (error) {
      const fb = await supabase
        .from('staff')
        .select('id, name, pin, role')
        .order('name', { ascending: true })
      data = fb.data
      error = fb.error
    }
    if (error) throw error
    const rows = withPendingStaffOps(
      (data || [])
        .filter(r => r.active !== false)
        .map(normaliseStaffRow)
        .filter(Boolean),
    )
    if (!rows.length) {
      if (fallback != null) setStaff(fallback)
      return false
    }
    setStaff(rows)
    return true
  } catch (err) {
    console.warn('loadStaffFromSupabase failed:', err?.message || err)
    if (fallback != null) setStaff(fallback)
    return false
  }
}

function localDayBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return { start, end }
}

function isSameLocalCalendarDay(a, b) {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  )
}

function normaliseAttendanceRow(row) {
  if (!row) return null
  let action = row.action
  if (action === 'in') action = 'clock_in'
  if (action === 'out') action = 'clock_out'
  return {
    id: row.id,
    staffName: row.staff_name ?? row.staffName,
    action,
    time: new Date(row.time),
    saved: Boolean(row.saved),
  }
}

function recomputeCurrentlyInFromTodaysLog(todayEntries) {
  const sorted = [...todayEntries].sort((a, b) => new Date(a.time) - new Date(b.time))
  const open = new Map()
  for (const e of sorted) {
    const name = e.staffName
    if (e.action === 'clock_in') {
      open.set(name, new Date(e.time))
    }
    if (e.action === 'clock_out') {
      open.delete(name)
    }
  }
  return Array.from(open.entries()).map(([staffName, clockInTime]) => ({ staffName, clockInTime }))
}

function insertAttendanceLogToSupabase({ id, staff_name, action, time }) {
  if (!supabase) return
  const row = { id, staff_name, action, time }
  // Upsert by client-generated id so a queued replay can't duplicate the entry.
  supabase
    .from('attendance_log')
    .upsert(row, { onConflict: 'id' })
    .then(({ error }) => {
      logSupabaseWrite('attendance_log', 'upsert', error)
      if (error) maybeQueueSyncFailure('attendance', row, error)
    })
    .catch((err) => {
      logSupabaseWrite('attendance_log', 'upsert', err)
      maybeQueueSyncFailure('attendance', row, err)
    })
}

async function loadAttendanceFromSupabase(setAttendanceLog, setCurrentlyIn) {
  if (!supabase) return
  try {
    const { data, error } = await supabase
      .from('attendance_log')
      .select('*')
      .order('time', { ascending: true })
      .limit(800)
    if (error) throw error
    const rows = (data || []).map(normaliseAttendanceRow).filter(Boolean)
    // Keep clock-ins/outs still waiting in the offline queue so a refetch doesn't wipe them.
    const serverIds = new Set(rows.map(r => r.id))
    for (const p of readPendingAttendanceRows()) {
      if (!serverIds.has(p.id)) rows.push(normaliseAttendanceRow(p))
    }
    // Re-apply "Save shift log" days still waiting to sync.
    for (const range of readPendingAttendanceSaveRanges()) {
      const start = new Date(range.start).getTime()
      const end = new Date(range.end).getTime()
      for (const r of rows) {
        const t = new Date(r.time).getTime()
        if (t >= start && t < end) r.saved = true
      }
    }
    rows.sort((x, y) => new Date(x.time) - new Date(y.time))
    setAttendanceLog(rows)
    const now = new Date()
    const todayRows = rows.filter(e => isSameLocalCalendarDay(new Date(e.time), now))
    setCurrentlyIn(recomputeCurrentlyInFromTodaysLog(todayRows))
  } catch (err) {
    console.warn('loadAttendanceFromSupabase failed:', err?.message || err)
  }
}

async function seedSupabase() {
  if (!supabase) return
  try {
    const { data: staffSample } = await supabase.from('staff').select('id').limit(1)
    if (!staffSample?.length && INITIAL_STAFF.length > 0) {
      let staffRes = await supabase.from('staff').insert(
        INITIAL_STAFF.map(s => ({
          name: s.name,
          pin: s.pin ?? '0000',
          role: s.role ?? 'staff',
          active: true,
        })),
      )
      if (staffRes.error) {
        staffRes = await supabase.from('staff').insert(
          INITIAL_STAFF.map(s => ({
            name: s.name,
            pin: s.pin ?? '0000',
            role: s.role ?? 'staff',
          })),
        )
      }
      logStaffWrite('insert', staffRes.error)
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

/** Send a till stock change as a delta (atomic on the server); queue it if the network is down. */
function sendTillStockDelta(productId, delta) {
  const payload = { product_id: Number(productId), delta, op_id: crypto.randomUUID() }
  applyTillStockDelta(payload).then(({ error }) => {
    logSupabaseWrite('till_stock', 'adjust', error)
    if (error) maybeQueueSyncFailure('till_stock_delta', payload, error)
  })
}

/** Same for warehouse (stock take) items. */
function sendStockItemDelta(stockKey, delta) {
  const payload = { stock_key: String(stockKey), delta, op_id: crypto.randomUUID() }
  applyStockItemDelta(payload).then(({ error }) => {
    logSupabaseWrite('stock_items', 'adjust', error)
    if (error) maybeQueueSyncFailure('stock_delta', payload, error)
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
  const { fallback, retryOnEmpty } = options
  if (!supabase) {
    if (fallback != null) setStockItemsRaw(fallback)
    return 0
  }
  const retryDelaysMs = retryOnEmpty ? [0, 120, 300] : [0]
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
    if (!rows.length) {
      if (fallback != null) setStockItemsRaw(fallback)
      return 0
    }
    const next = {}
    for (const row of rows) {
      next[row.stock_key] = Number(row.qty)
    }
    setStockItemsRaw(withPendingDeltas(next, 'stock_delta', 'stock_key'))
    return rows.length
  } catch (err) {
    console.warn('loadStockItemsFromSupabase failed:', err?.message || err)
    if (fallback != null) setStockItemsRaw(fallback)
    return 0
  }
}

/** Bootstrap: stock take qty from Supabase (definitions come from the shared menu, see loadMenuFromSupabase). */
async function loadStockFromSupabase(setStockItemsRaw) {
  return loadStockItemsFromSupabase(setStockItemsRaw)
}

const onTillStockUpsertQueueable = (row, err) =>
  maybeQueueSyncFailure('till_stock', row, err)

/** Write a shared-menu change (product, variant, stock definition, category); queue it if the network is down. */
function sendMenuOp(type, payload) {
  if (!supabase) return
  applyMenuOp(type, payload).then(({ error }) => {
    logSupabaseWrite(type, 'write', error)
    if (error) maybeQueueSyncFailure(type, payload, error)
  })
}

/**
 * Load the shared menu from Supabase into local state (local copy is the offline fallback).
 * With `seed`, an empty shared menu is filled once from this device's local menu.
 */
async function loadMenuFromSupabase(setters, getLocal, { seed = false } = {}) {
  const menu = await fetchMenuFromSupabase()
  if (!menu) return false
  const local = getLocal()
  if (menu.optionGroups) setters.setOptionGroups(menu.optionGroups)
  if (menu.floorAreas) setters.setFloorAreas(menu.floorAreas)
  if (menu.floorTables) setters.setFloorTables(menu.floorTables)
  if (menu.floorShapes) setters.setFloorShapes(menu.floorShapes)
  if (seed) {
    const seedProducts = menu.products.length === 0 && local.products.length > 0
    const seedStock = menu.stockDefinitions.length === 0 && local.stockDefinitions.length > 0
    if (seedProducts || seedStock) {
      await seedMenuToSupabase(
        {
          products: local.products,
          variants: local.productVariants,
          stockDefinitions: local.stockDefinitions,
          categories: local.categoryState,
        },
        { seedProducts, seedStock },
      )
    }
    // Keep this device's menu for whichever parts it just uploaded; adopt the server's for the rest.
    if (!seedProducts) {
      setters.setProducts(menu.products)
      setters.setProductVariants(menu.variants)
      setters.setCategoryState(menu.categories)
    }
    if (!seedStock) setters.setStockDefinitions(menu.stockDefinitions)
    return true
  }
  if (menu.products.length) {
    setters.setProducts(menu.products)
    setters.setProductVariants(menu.variants)
    setters.setCategoryState(menu.categories)
  }
  if (menu.stockDefinitions.length) setters.setStockDefinitions(menu.stockDefinitions)
  return true
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
  // Table, covers and customer exist only in the POS database (sent explicitly so clearing a value works).
  if (features.tables) {
    row.table_id = tab.tableId ?? null
    row.covers = tab.covers != null ? Number(tab.covers) : null
    row.customer = tab.customer || null
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

function applyTabsFallback(setOpenTabs, setOrders, setTabIdCounter, fallback) {
  if (!fallback) return
  setOpenTabs(fallback.openTabs ?? [])
  setOrders(fallback.orders ?? { quick: {} })
  if (fallback.tabIdCounter != null) {
    setTabIdCounter(fallback.tabIdCounter)
  }
}

async function loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter, options = {}) {
  const { fallback, retryOnEmpty } = options
  if (!supabase) {
    applyTabsFallback(setOpenTabs, setOrders, setTabIdCounter, fallback)
    return []
  }
  const retryDelaysMs = retryOnEmpty ? [0, 120, 300] : [0]
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
    if (!rows.length) {
      applyTabsFallback(setOpenTabs, setOrders, setTabIdCounter, fallback)
      return []
    }
    const tabs = rows.map(row => normaliseTabRowLive(row)).filter(Boolean)
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
    applyTabsFallback(setOpenTabs, setOrders, setTabIdCounter, fallback)
    return []
  }
}

/** Supabase-first bootstrap; localStorage snapshots used only on fail/empty. */
async function bootstrapSharedDataFromSupabase({
  staffFallback,
  stockItemsFallback,
  stockFallback,
  tabsFallback,
  setStaff,
  setStockItemsRaw,
  setStockRaw,
  setOpenTabs,
  setOrders,
  setTabIdCounter,
}) {
  await Promise.all([
    loadStaffFromSupabase(setStaff, staffFallback),
    loadStockItemsFromSupabase(setStockItemsRaw, { fallback: stockItemsFallback }),
    loadTillStockFromSupabase(setStockRaw, { fallback: stockFallback }),
    loadTabsFromSupabase(setOpenTabs, setOrders, setTabIdCounter, { fallback: tabsFallback }),
  ])
}

/** Load today's session transactions from Supabase and merge with local state (deduped by id). */
async function loadTodaySessionTransactionsFromSupabase(setTransactions, fallback = []) {
  if (!supabase) {
    if (fallback.length) {
      setTransactions(prev => mergeTransactionsDeduped(prev, fallback))
    }
    return 0
  }
  try {
    const fetched = await fetchTodayTransactionsFromSupabase()
    let count = 0
    setTransactions(prev => {
      const merged = mergeTransactionsDeduped(prev, fetched)
      if (merged.length === 0 && fallback.length) {
        return mergeTransactionsDeduped(fallback)
      }
      count = merged.length
      return merged
    })
    return count
  } catch (err) {
    console.warn('loadTodaySessionTransactionsFromSupabase failed:', err?.message || err)
    if (fallback.length) {
      setTransactions(prev => mergeTransactionsDeduped(prev, fallback))
    }
    return 0
  }
}

export default function App() {
  const [view, setView] = useState('till')
  const [products, setProducts] = useLocalStorage('bt_products', INITIAL_PRODUCTS)
  const [productVariants, setProductVariants] = useLocalStorage('bt_product_variants', INITIAL_PRODUCT_VARIANTS)
  const [stockDefinitions, setStockDefinitions] = useLocalStorage('bt_stock_definitions', INITIAL_STOCK_ITEMS)
  const [optionGroups, setOptionGroups] = useLocalStorage('bt_option_groups', [])
  const [floorAreas, setFloorAreas] = useLocalStorage('bt_floor_areas', [])
  const [floorTables, setFloorTables] = useLocalStorage('bt_floor_tables', [])
  const [floorShapes, setFloorShapes] = useLocalStorage('bt_floor_shapes', [])
  // What each merged table absorbed, so a merge can be undone: { [mergedTabId]: [{ src, prevCustomer, prevOpenedAt }] }
  const [mergeHistory, setMergeHistory] = useLocalStorage('bt_merge_history', {})
  const [categoryState, setCategoryState] = useLocalStorage('bt_categories', { till: [], stock: [] })
  const [stock, setStockRaw] = useLocalStorage('bt_stock', Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
  const [stockItems, setStockItemsRaw] = useLocalStorage('bt_stock_items', Object.fromEntries(INITIAL_STOCK_ITEMS.map(s => [s.id, s.stock])))
  // Latest stock maps, so changes can be computed and sent as deltas outside React updaters
  // (updaters must be pure — StrictMode runs them twice, which would double-send deltas).
  const stockRef = useRef(stock)
  stockRef.current = stock
  const stockItemsRef = useRef(stockItems)
  stockItemsRef.current = stockItems

  // Sales, voids and product edits change stock through these: send only the change (delta),
  // never the absolute count, so two tills selling at once can't overwrite each other.
  const setStock = useCallback((update) => {
    const prev = stockRef.current
    const next = typeof update === 'function' ? update(prev) : update
    stockRef.current = next
    setStockRaw(next)
    if (!supabase) return
    const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
    for (const id of keys) {
      const delta = Number(next?.[id] ?? 0) - Number(prev?.[id] ?? 0)
      if (delta !== 0) sendTillStockDelta(id, delta)
    }
  }, [])

  const setStockItems = useCallback((update) => {
    const prev = stockItemsRef.current
    const next = typeof update === 'function' ? update(prev) : update
    stockItemsRef.current = next
    setStockItemsRaw(next)
    if (!supabase) return
    const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
    for (const id of keys) {
      const delta = Number(next?.[id] ?? 0) - Number(prev?.[id] ?? 0)
      if (delta !== 0) sendStockItemDelta(id, delta)
    }
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
  const [eodReports, setEodReports] = useState([])
  const menuSettersRef = useRef({})
  menuSettersRef.current = { setProducts, setProductVariants, setStockDefinitions, setCategoryState, setOptionGroups, setFloorAreas, setFloorTables, setFloorShapes }
  const menuLocalRef = useRef({})
  menuLocalRef.current = { products, productVariants, stockDefinitions, categoryState }
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
  /** After close till, skip focus refresh until a new sale starts */
  const sessionClearedRef = useRef(false)
  const tillStockSetterRef = useRef(setStockRaw)
  tillStockSetterRef.current = setStockRaw
  const stockItemsSetterRef = useRef(setStockItemsRaw)
  stockItemsSetterRef.current = setStockItemsRaw
  const staffRef = useRef(staff)
  staffRef.current = staff

  // Manager PIN unlock: opens Settings, Sales/close till and staff admin for 10 minutes.
  const [splitTabId, setSplitTabId] = useState(null)
  const [discountTabId, setDiscountTabId] = useState(null)
  const [managerUnlockAt, setManagerUnlockAt] = useState(null)
  const managerUnlocked = managerUnlockAt != null
  const unlockManager = useCallback(() => setManagerUnlockAt(Date.now()), [])
  useEffect(() => {
    if (managerUnlockAt == null) return undefined
    const t = setTimeout(() => setManagerUnlockAt(null), 10 * 60 * 1000)
    return () => clearTimeout(t)
  }, [managerUnlockAt])
  /** Manager PINs are staff rows with role 'manager'. Until one exists, the built-in PIN still works. */
  const verifyManagerPin = useCallback((pin) => {
    const list = Array.isArray(staffRef.current) ? staffRef.current : []
    const managers = list.filter(s => s?.role === 'manager')
    return managers.length ? managers.some(s => String(s.pin) === String(pin)) : pin === ADMIN_PIN
  }, [])

  // Venue login (soft for now: "Skip" is allowed until database rules require sign-in).
  const venue = useVenueAuth()
  const [venueSkipped, setVenueSkipped] = useState(false)
  const [venueOpen, setVenueOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const showVenueSignIn = isSupabaseConfigured && (venueOpen || (venue.ready && !venue.signedIn && !venueSkipped && isOnline))
  const staffSetterRef = useRef(setStaff)
  staffSetterRef.current = setStaff
  const attendanceLoadersRef = useRef({ setAttendanceLog, setCurrentlyIn })
  attendanceLoadersRef.current = { setAttendanceLog, setCurrentlyIn }
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
  const hydratedAttendanceLog = attendanceLog.map(e => {
    let action = e.action
    if (action === 'in') action = 'clock_in'
    if (action === 'out') action = 'clock_out'
    return {
      ...e,
      action,
      time: new Date(e.time),
      saved: Boolean(e.saved),
    }
  })
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
    const staffFallback = structuredClone(staff)
    const stockItemsFallback = structuredClone(stockItems)
    const stockFallback = structuredClone(stock)
    const tabsFallback = {
      openTabs: structuredClone(openTabs),
      orders: structuredClone(orders),
      tabIdCounter,
    }
    let cancelled = false
    ;(async () => {
      await seedSupabase()
      if (cancelled) return
      await loadMenuFromSupabase(menuSettersRef.current, () => menuLocalRef.current, { seed: true })
      if (cancelled) return
      await bootstrapSharedDataFromSupabase({
        staffFallback,
        stockItemsFallback,
        stockFallback,
        tabsFallback,
        setStaff,
        setStockItemsRaw,
        setStockRaw,
        setOpenTabs,
        setOrders,
        setTabIdCounter,
      })
      if (cancelled) return
      const transactionsFallback = structuredClone(transactions)
      await loadTodaySessionTransactionsFromSupabase(setTransactions, transactionsFallback)
      if (cancelled) return
      const reports = await loadEodReportsWithFallback()
      if (!cancelled) setEodReports(reports)
      if (cancelled) return
      await loadAttendanceFromSupabase(setAttendanceLog, setCurrentlyIn)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap; fallbacks are initial localStorage snapshot
  }, [])

  useEffect(() => {
    const refreshFromSupabaseOnFocus = () => {
      if (!supabase) return
      loadMenuFromSupabase(menuSettersRef.current, () => menuLocalRef.current)
      loadTillStockFromSupabase(tillStockSetterRef.current, { retryOnEmpty: true })
      loadStockItemsFromSupabase(stockItemsSetterRef.current, { retryOnEmpty: true })
      if (!sessionClearedRef.current) {
        loadTodaySessionTransactionsFromSupabase(transactionsSetterRef.current, [])
      }
      // Tabs, staff and attendance normally arrive by realtime; refetch them too so a missed live update
      // can't leave a device stale. Skipped while local changes are still queued, so it can't overwrite them.
      if (readSyncQueue().length === 0) {
        const { setOpenTabs: setTabs, setOrders: setOrds, setTabIdCounter: setCounter } = tabsLoadSettersRef.current
        loadTabsFromSupabase(setTabs, setOrds, setCounter, { retryOnEmpty: true })
        loadStaffFromSupabase(staffSetterRef.current, null)
        const { setAttendanceLog: setLog, setCurrentlyIn: setIn } = attendanceLoadersRef.current
        loadAttendanceFromSupabase(setLog, setIn)
      }
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) refreshFromSupabaseOnFocus()
    }
    window.addEventListener('focus', refreshFromSupabaseOnFocus)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const timer = setInterval(refreshIfVisible, 60_000)
    return () => {
      window.removeEventListener('focus', refreshFromSupabaseOnFocus)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      clearInterval(timer)
    }
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

    const onTillStockChange = async () => {
      await loadTillStockFromSupabase(tillStockSetterRef.current, { retryOnEmpty: true })
    }

    const onStockItemsChange = async () => {
      await loadStockItemsFromSupabase(stockItemsSetterRef.current, { retryOnEmpty: true })
    }

    const onStaffChange = async () => {
      await loadStaffFromSupabase(staffSetterRef.current, null)
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
    const tillStockChannelName = 'till_realtime_stock'
    const stockItemsChannelName = 'till_realtime_stock_items'
    const staffChannelName = 'till_realtime_staff'

    subscribeTable(tabsChannelName, 'tabs', onTabsChange)
    subscribeTable(tillStockChannelName, 'till_stock', onTillStockChange)
    subscribeTable(stockItemsChannelName, 'stock_items', onStockItemsChange)

    // Shared menu: any change refetches the whole menu (never merged from the payload).
    const onMenuChange = () => {
      loadMenuFromSupabase(menuSettersRef.current, () => menuLocalRef.current)
    }
    subscribeTable('till_realtime_menu_products', 'menu_products', onMenuChange)
    subscribeTable('till_realtime_menu_categories', 'menu_categories', onMenuChange)
    if (features.foodOptions) subscribeTable('till_realtime_menu_option_groups', 'menu_option_groups', onMenuChange)
    if (features.tables) {
      subscribeTable('till_realtime_floor_areas', 'floor_areas', onMenuChange)
      subscribeTable('till_realtime_floor_tables', 'floor_tables', onMenuChange)
      subscribeTable('till_realtime_floor_shapes', 'floor_shapes', onMenuChange)
    }
    // stock_items also changes on every sale (qty), so only refetch the menu when a definition changed.
    const definitionChanged = (payload) => {
      if (payload.eventType !== 'UPDATE') return true
      const a = payload.old ?? {}
      const b = payload.new ?? {}
      return ['name', 'category', 'unit', 'display_unit', 'data'].some(
        k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null),
      )
    }
    const menuStockChannel = supabase.channel('till_realtime_stock_definitions')
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      menuStockChannel.on('postgres_changes', { event, schema: 'public', table: 'stock_items' }, (payload) => {
        if (definitionChanged(payload)) onMenuChange()
      })
    }
    menuStockChannel.subscribe()
    channels.push(menuStockChannel)
    subscribeTable(staffChannelName, 'staff', onStaffChange)

    const onAttendanceChange = async () => {
      const { setAttendanceLog: setLog, setCurrentlyIn: setIn } = attendanceLoadersRef.current
      await loadAttendanceFromSupabase(setLog, setIn)
    }
    const attendanceChannel = supabase
      .channel('till_realtime_attendance')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_log' },
        onAttendanceChange,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'attendance_log' },
        onAttendanceChange,
      )
    attendanceChannel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn(
          '[Realtime] attendance_log channel error — ensure public.attendance_log is in supabase_realtime publication',
          err,
        )
      }
    })
    channels.push(attendanceChannel)

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
    setStaff(staff.map(s => ({
      id: newStaffUuid(),
      name: s,
      pin: '0000',
      role: 'staff',
      active: true,
    })))
  }, [staff, setStaff])

  // One-time reset for legacy product sets when menu has changed.
  useEffect(() => {
    if (isPosMode) return // POS menus are entered by hand; never reset them to the bar menu
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

  // Replay queued offline writes on startup, when the connection returns, on focus, and every minute.
  // The 'online' event alone isn't enough: it never fires if the app starts already online.
  useEffect(() => {
    const tryFlush = async () => {
      if (!readSyncQueue().length) return
      const hadEodReport = readPendingEodReportRows().length > 0
      const pendingAttendance = () =>
        readPendingAttendanceRows().length + readPendingAttendanceSaveRanges().length
      const hadAttendance = pendingAttendance() > 0
      await flushSyncQueue()
      if (hadAttendance && pendingAttendance() === 0) {
        const { setAttendanceLog: setLog, setCurrentlyIn: setIn } = attendanceLoadersRef.current
        await loadAttendanceFromSupabase(setLog, setIn)
      }
      if (hadEodReport && readPendingEodReportRows().length === 0) {
        setEodReports(await loadEodReportsWithFallback())
      }
      if (readSyncQueue().length === 0) showToast('Back online — saved data synced')
    }
    void tryFlush()
    const timer = setInterval(tryFlush, 60_000)
    window.addEventListener('online', tryFlush)
    window.addEventListener('focus', tryFlush)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', tryFlush)
      window.removeEventListener('focus', tryFlush)
    }
  }, [showToast])

  /** Stock view “Till products” ± — writes till_stock only (product_id, qty). */
  const adjustTillStock = useCallback((productId, delta) => {
    const prev = stockRef.current
    const newQty = Math.max(0, (prev[productId] ?? 0) + delta)
    const applied = newQty - (prev[productId] ?? 0)
    const next = { ...prev, [productId]: newQty }
    stockRef.current = next
    setStockRaw(next)
    if (supabase && applied !== 0) sendTillStockDelta(productId, applied)
  }, [])

  const setStockValue = useCallback((productId, val) => {
    const newQty = Math.max(0, val)
    if (supabase) {
      upsertTillStockRowToSupabase(productId, newQty, onTillStockUpsertQueueable)
    }
    setStockRaw(prev => ({ ...prev, [productId]: newQty }))
  }, [])

  /** Stock view “Stock take” ± — writes stock_items only (stock_key, qty). */
  const adjustStockItem = useCallback((stockKey, delta) => {
    const prev = stockItemsRef.current
    const newQty = Math.max(0, (prev[stockKey] ?? 0) + delta)
    const applied = newQty - (prev[stockKey] ?? 0)
    const next = { ...prev, [stockKey]: newQty }
    stockItemsRef.current = next
    setStockItemsRaw(next)
    if (supabase && applied !== 0) sendStockItemDelta(stockKey, applied)
  }, [])

  const addTransaction = useCallback((tx) => {
    sessionClearedRef.current = false
    const withSession = {
      ...tx,
      sessionDate: tx.sessionDate ?? localSessionDateString(),
    }
    setTransactions(prev => dedupeTransactionsById([withSession, ...prev]))
    syncTransactionToSupabaseFireAndForget(withSession)
  }, [setTransactions])

  const clearSessionTransactions = useCallback(async () => {
    console.log('[close till] clearSessionTransactions — start')
    setTransactions([])
    try {
      localStorage.removeItem('bt_transactions')
      // bt_sync_queue is kept: unsynced sales must survive close-out and replay later.
    } catch (err) {
      console.warn('clearSessionTransactions localStorage:', err)
    }
    sessionClearedRef.current = true
    console.log('[close till] clearSessionTransactions — done')
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

  const openNewTabEntry = useCallback((name, extra = {}) => {
    const id = 'tab_' + tabIdCounter
    setTabIdCounter(c => c + 1)
    const newTab = {
      id, name, items: [], openedAt: new Date(), staff: activeSaleStaff,
      ...(extra.tableId ? { tableId: extra.tableId } : {}),
      ...(extra.covers != null ? { covers: extra.covers } : {}),
      ...(extra.customer ? { customer: extra.customer } : {}),
    }
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
          const p = products.find(x => x.id === lineProductId(id))
          if (!p) return
          const itemName = orderLineLabel(line, p.name)
          const lineOptions = typeof line === 'object' ? (line?.options || []) : []
          const lineNote = typeof line === 'object' ? (line?.note || '') : ''
          if (p.group === 'food') {
            // Food is sold and reported by dish: no stock to deduct.
          } else if (selectedStockId && productVariants[p.id]) {
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
              (i.selectedMixerId ?? null) === (selectedMixerId ?? null) &&
              lineSignature(i.options, i.note) === lineSignature(lineOptions, lineNote)
            )
          })
          if (ex) ex.qty += qty
          else newItems.push({
            name: itemName, qty, price: p.price, productId: p.id, selectedStockId, selectedMixerId,
            ...(lineOptions.length ? { options: lineOptions } : {}),
            ...(lineNote ? { note: lineNote } : {}),
            ...lineTaxFields(p),
          })
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
      tabName: tabLabel(tab),
      ...(tab.covers != null ? { covers: tab.covers } : {}),
      ...(extras.tip > 0 ? { tip: Math.round(Number(extras.tip) * 100) / 100 } : {}),
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
    const listItems = orderToItems(order, products)
    // A discount or comp on the whole sale is shared across its lines, so VAT and food/drink figures stay right.
    const items = extras.discount ? allocateDiscount(listItems, { ...extras.discount, lines: extras.discount.lines || 'all' }) : listItems
    const total = extras.discount
      ? Math.round(items.reduce((s, i) => s + lineAmount(i), 0) * 100) / 100
      : getOrderTotal(order, products)
    items.forEach(i => {
      const p = products.find(x => x.id === i.productId || x.name === i.name)
      if (p && p.group !== 'food') {
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
      ...(extras.tip > 0 ? { tip: Math.round(Number(extras.tip) * 100) / 100 } : {}),
      voided: false,
      ...(payment === 'cash' ? {
        tenderedAmount: extras.tenderedAmount ?? null,
        changeGiven: extras.changeGiven ?? null,
      } : {}),
      ...(extras.notes ? { notes: extras.notes } : {}),
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
          if (p && p.group !== 'food') {
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
      if (voided) syncTransactionToSupabaseFireAndForget(voided)
      return next
    })
    showToast('Transaction voided — stock restored')
  }, [products, productVariants, stockDefinitions, setTransactions, setStock, setStockItems, showToast])

  const mergePreviewIntoTabOrder = useCallback((tabOrder, quickOrder) => {
    return Object.entries(quickOrder).reduce((acc, [id, line]) => {
      const qty = typeof line === 'number' ? line : (line?.qty || 0)
      const selectedStockId = typeof line === 'object' ? line?.selectedStockId : null
      const selectedMixerId = typeof line === 'object' ? line?.selectedMixerId : null
      const displayName = typeof line === 'object' ? line?.displayName : null
      const lineOptions = typeof line === 'object' ? line?.options : undefined
      const lineNote = typeof line === 'object' ? line?.note : undefined
      const existing = acc[id]
      const existingQty = typeof existing === 'number' ? existing : (existing?.qty || 0)
      const mergedStockId = selectedStockId || (typeof existing === 'object' ? existing?.selectedStockId : null) || null
      const mergedDisplayName =
        displayName
        || (typeof existing === 'object' ? existing?.displayName : null)
        || null
      return {
        ...acc,
        [id]: {
          qty: existingQty + qty,
          selectedStockId: mergedStockId,
          selectedMixerId: selectedMixerId || (typeof existing === 'object' ? existing?.selectedMixerId : null) || null,
          displayName: mergedDisplayName,
          ...(lineOptions?.length ? { options: lineOptions } : {}),
          ...(lineNote ? { note: lineNote } : {}),
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

  /** Change a tab's name, customer name or covers after it was opened (null clears covers / customer). */
  const updateTabDetails = useCallback((tabId, patch) => {
    setOpenTabs(prev => {
      let updated = null
      const next = prev.map(t => {
        if (t.id !== tabId) return t
        updated = { ...t }
        if (patch.name !== undefined && String(patch.name).trim()) updated.name = String(patch.name).trim()
        if (patch.customer !== undefined) {
          const c = String(patch.customer || '').trim()
          if (c) updated.customer = c
          else delete updated.customer
        }
        if (patch.covers !== undefined) {
          if (patch.covers == null) delete updated.covers
          else updated.covers = Number(patch.covers)
        }
        return updated
      })
      if (updated) syncTabToSupabase(updated)
      return next
    })
  }, [setOpenTabs])

  /** Tell the kitchen and/or bar screen about a change to a table that already has tickets (moved, merged). */
  const notifyStations = useCallback((tab, tabName, text) => {
    if (!features.stations || !tab?.items?.length) return
    stationsFor(tab.items).forEach(station => {
      void sendStationNotice({ station, tabName, text, staff: activeSaleStaff })
    })
  }, [activeSaleStaff])

  /** Move an open table's tab to a free table (guests changed table). */
  const moveTab = useCallback((tabId, table) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (!tab || !table) return false
    if (openTabs.some(t => t.tableId === table.id && t.id !== tabId)) {
      showToast('That table is already in use')
      return false
    }
    const label = tableLabel(table)
    const moved = { ...tab, name: label, tableId: table.id }
    setOpenTabs(prev => prev.map(t => (t.id === tabId ? moved : t)))
    syncTabToSupabase(moved)
    notifyStations(tab, tabLabel(moved), `⚠ MOVED from ${tabLabel(tab)}`)
    showToast(`Moved to ${label}`)
    return true
  }, [openTabs, setOpenTabs, showToast, notifyStations])

  /** Merge one open table into another (two parties joining): one bill, the first table closes. */
  const mergeTabs = useCallback((sourceId, targetId) => {
    const src = openTabs.find(t => t.id === sourceId)
    const dst = openTabs.find(t => t.id === targetId)
    if (!src || !dst || src.id === dst.id) return false
    const merged = mergeTabData(dst, src)
    setMergeHistory(prev => ({
      ...prev,
      [targetId]: [...(prev[targetId] || []), { src: JSON.parse(JSON.stringify(src)), prevCustomer: dst.customer || null, prevOpenedAt: dst.openedAt ?? null }],
    }))
    setOpenTabs(prev => prev.filter(t => t.id !== sourceId).map(t => (t.id === targetId ? merged : t)))
    // Anything still waiting in the source's unsent order moves across too.
    setOrders(prev => {
      const n = { ...prev }
      if (n[sourceId] && Object.keys(n[sourceId]).length) {
        n[targetId] = mergePreviewIntoTabOrder(n[targetId] || {}, n[sourceId])
      }
      delete n[sourceId]
      return n
    })
    syncTabToSupabase(merged)
    deleteTabFromSupabase(sourceId)
    if (activeOrderKey === sourceId) switchOrder(targetId)
    notifyStations(src, tabLabel(merged), `⚠ MERGED: ${tabLabel(src)} joined this table`)
    showToast(`Merged into ${tabLabel(merged)}`)
    return true
  }, [openTabs, setOpenTabs, setOrders, setMergeHistory, mergePreviewIntoTabOrder, activeOrderKey, switchOrder, showToast, notifyStations])

  /** Undo a merge: the absorbed table comes back on its own with what is still on the bill. */
  const unmergeTab = useCallback((targetId, srcId) => {
    const dst = openTabs.find(t => t.id === targetId)
    const entry = (mergeHistory[targetId] || []).find(e => e.src.id === srcId)
    if (!dst || !entry) return false
    const out = unmergeTabData(dst, entry)
    const occupied = entry.src.tableId != null && openTabs.some(t => t.id !== targetId && t.tableId === entry.src.tableId)
    const back = { ...out.src, ...(occupied ? { tableId: undefined } : {}) }
    setOpenTabs(prev => [...prev.map(t => (t.id === targetId ? out.dst : t)), back])
    setMergeHistory(prev => {
      const rest = (prev[targetId] || []).filter(e => e.src.id !== srcId)
      const next = { ...prev }
      if (rest.length) next[targetId] = rest
      else delete next[targetId]
      return next
    })
    syncTabToSupabase(out.dst)
    syncTabToSupabase(back)
    notifyStations(back, tabLabel(out.dst), `⚠ SPLIT BACK: ${tabLabel(back)} is its own table again`)
    showToast(`${tabLabel(back)} is its own table again${occupied ? ' (its table number is taken — set a new one)' : ''}`)
    return true
  }, [openTabs, mergeHistory, setOpenTabs, setMergeHistory, notifyStations, showToast])

  /**
   * Pay part of a table's bill (split bill). spec: { kind: 'items', picks } or { kind: 'even', people }.
   * Records a separate sale for that part and leaves the rest on the table; when nothing is left the table closes.
   */
  const payTabPart = useCallback((tabId, spec, payment, tip = 0, cash = null) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (!tab) return { ok: false }
    const part = spec.kind === 'even' ? takeEvenShare(tab.items, spec.people) : takeItemsPart(tab.items, spec.picks)
    if (!part.lines.length || part.amount <= 0) {
      showToast('Nothing to pay')
      return { ok: false }
    }
    const closing = part.remaining.length === 0
    addTransaction({
      id: Date.now(),
      time: new Date(),
      total: part.amount,
      items: part.lines,
      payment,
      staff: activeSaleStaff,
      type: 'tab',
      tabName: `${tabLabel(tab)} (split)`,
      // Covers are counted once, on the payment that closes the table.
      ...(closing && tab.covers != null ? { covers: tab.covers } : {}),
      ...(tip > 0 ? { tip: Math.round(Number(tip) * 100) / 100 } : {}),
      voided: false,
      ...(payment === 'cash' && cash ? { tenderedAmount: cash.tenderedAmount, changeGiven: cash.changeGiven } : {}),
    })
    if (closing) {
      deleteTabFromSupabase(tabId)
      setOpenTabs(prev => prev.filter(t => t.id !== tabId))
      setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
      if (activeOrderKey === tabId) switchOrder('quick')
      showToast(`Table settled — ${fmt(part.amount)}`)
    } else {
      const updated = { ...tab, items: part.remaining }
      setOpenTabs(prev => prev.map(t => (t.id === tabId ? updated : t)))
      syncTabToSupabase(updated)
      showToast(`Paid ${fmt(part.amount)} — ${fmt(tabTotal(updated))} left`)
    }
    return { ok: true, closed: closing, amount: part.amount }
  }, [openTabs, addTransaction, activeSaleStaff, setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  /** Apply / remove a discount or comp on a table's bill lines. */
  const applyTabDiscount = useCallback((tabId, spec) => {
    setOpenTabs(prev => {
      let updated = null
      const next = prev.map(t => {
        if (t.id !== tabId) return t
        updated = { ...t, items: allocateDiscount(t.items, spec) }
        return updated
      })
      if (updated) syncTabToSupabase(updated)
      return next
    })
    showToast(spec.kind === 'comp' ? 'Comp applied' : 'Discount applied')
  }, [setOpenTabs, showToast])

  const clearTabDiscount = useCallback((tabId, lines) => {
    setOpenTabs(prev => {
      let updated = null
      const next = prev.map(t => {
        if (t.id !== tabId) return t
        updated = { ...t, items: clearDiscount(t.items, lines) }
        return updated
      })
      if (updated) syncTabToSupabase(updated)
      return next
    })
    showToast('Discount removed')
  }, [setOpenTabs, showToast])

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
    sendMenuOp('menu_product', productToRow(cleanProduct, variant))
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
    sendMenuOp('menu_product_delete', { id })
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
    sendMenuOp('stock_definition', stockDefinitionToRow(cleanItem))
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
    sendMenuOp('stock_definition_delete', { stock_key: String(stockKey) })
    for (const [productId, variant] of changedVariants) {
      sendMenuOp('menu_variant', { id: Number(productId), variant })
    }
    showToast('Stock item deleted')
  }, [productVariants, setStockDefinitions, setStockItems, setProductVariants, showToast])

  const saveOptionGroup = useCallback((group) => {
    const clean = {
      id: group.id || 'og_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(group.name || '').trim(),
      required: group.required !== false,
      choices: (group.choices || []).map(c => String(c).trim()).filter(Boolean),
    }
    if (!clean.name || !clean.choices.length) return null
    setOptionGroups(prev => {
      const exists = prev.some(g => g.id === clean.id)
      const next = exists ? prev.map(g => (g.id === clean.id ? clean : g)) : [...prev, clean]
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    sendMenuOp('option_group', clean)
    showToast('Option group saved')
    return clean
  }, [setOptionGroups, showToast])

  const deleteOptionGroup = useCallback((id) => {
    setOptionGroups(prev => prev.filter(g => g.id !== id))
    sendMenuOp('option_group_delete', { id })
    showToast('Option group deleted')
  }, [setOptionGroups, showToast])

  const newFloorId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  const saveFloorArea = useCallback((area) => {
    const name = String(area.name || '').trim()
    if (!name) return null
    const existing = area.id ? floorAreas.find(a => a.id === area.id) : null
    const row = {
      id: existing?.id || newFloorId('area_'),
      name,
      sort: existing?.sort ?? (Math.max(0, ...floorAreas.map(a => a.sort ?? 0)) + 1),
    }
    setFloorAreas(prev => (existing ? prev.map(a => (a.id === row.id ? row : a)) : [...prev, row]))
    sendMenuOp('floor_area', { id: row.id, name: row.name, sort: row.sort })
    return row
  }, [floorAreas, setFloorAreas])

  const deleteFloorArea = useCallback((id) => {
    floorTables.filter(t => t.areaId === id).forEach(t => sendMenuOp('floor_table_delete', { id: t.id }))
    floorShapes.filter(s => s.areaId === id).forEach(s => sendMenuOp('floor_shape_delete', { id: s.id }))
    setFloorShapes(prev => prev.filter(s => s.areaId !== id))
    setFloorTables(prev => prev.filter(t => t.areaId !== id))
    setFloorAreas(prev => prev.filter(a => a.id !== id))
    sendMenuOp('floor_area_delete', { id })
    showToast('Area deleted')
  }, [floorTables, floorShapes, setFloorTables, setFloorShapes, setFloorAreas, showToast])

  const saveFloorTable = useCallback((table) => {
    const name = String(table.name || '').trim()
    if (!name || !table.areaId) return null
    const seatsNum = table.seats === '' || table.seats == null ? null : Number(table.seats)
    const clash = floorTables.some(t => t.areaId === table.areaId && t.id !== table.id && t.name.toLowerCase() === name.toLowerCase())
    if (clash) { showToast('That table already exists in this area'); return null }
    const existing = table.id ? floorTables.find(t => t.id === table.id) : null
    const sort = existing?.sort ?? (Math.max(0, ...floorTables.filter(t => t.areaId === table.areaId).map(t => t.sort ?? 0)) + 1)
    // Floor-plan position/shape: use what was passed, else keep what the table already has.
    const pick = (k) => (table[k] !== undefined ? table[k] : (existing?.[k] ?? null))
    const row = {
      id: existing?.id || newFloorId('t_'), areaId: table.areaId, name, seats: Number.isFinite(seatsNum) ? seatsNum : null, sort,
      x: pick('x'), y: pick('y'), w: pick('w'), h: pick('h'), shape: pick('shape'), rot: Number(pick('rot')) || 0,
    }
    setFloorTables(prev => (existing ? prev.map(t => (t.id === row.id ? row : t)) : [...prev, row]))
    sendMenuOp('floor_table', { id: row.id, area_id: row.areaId, name: row.name, seats: row.seats, sort: row.sort, x: row.x, y: row.y, w: row.w, h: row.h, shape: row.shape, rot: row.rot })
    return row
  }, [floorTables, setFloorTables, showToast])

  /** Walls, bar and other simple structures drawn on a floor plan (not tables). */
  const saveFloorShape = useCallback((shape) => {
    const existing = shape.id ? floorShapes.find(s => s.id === shape.id) : null
    const pick = (k, dflt) => (shape[k] !== undefined ? shape[k] : (existing?.[k] ?? dflt))
    const row = {
      id: existing?.id || newFloorId('shape_'),
      areaId: pick('areaId', null),
      x: Number(pick('x', 0)), y: Number(pick('y', 0)),
      w: Number(pick('w', 10)), h: Number(pick('h', 3)),
      label: String(pick('label', '') || ''),
      style: ['wall', 'bar', 'outline'].includes(pick('style', 'wall')) ? pick('style', 'wall') : 'wall',
      rot: Number(pick('rot', 0)) || 0,
    }
    if (!row.areaId) return null
    setFloorShapes(prev => (existing ? prev.map(s => (s.id === row.id ? row : s)) : [...prev, row]))
    sendMenuOp('floor_shape', { id: row.id, area_id: row.areaId, x: row.x, y: row.y, w: row.w, h: row.h, label: row.label, style: row.style, rot: row.rot })
    return row
  }, [floorShapes, setFloorShapes])

  const deleteFloorShape = useCallback((id) => {
    setFloorShapes(prev => prev.filter(s => s.id !== id))
    sendMenuOp('floor_shape_delete', { id })
  }, [setFloorShapes])

  const deleteFloorTable = useCallback((id) => {
    setFloorTables(prev => prev.filter(t => t.id !== id))
    sendMenuOp('floor_table_delete', { id })
  }, [setFloorTables])

  /** Add tables named from..to (numbers) to an area, skipping names that already exist. */
  const addFloorTableRange = useCallback((areaId, from, to, seats) => {
    const a = Math.floor(Number(from)); const b = Math.floor(Number(to))
    if (!areaId || !Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 200) return 0
    const have = new Set(floorTables.filter(t => t.areaId === areaId).map(t => t.name.toLowerCase()))
    let sort = Math.max(0, ...floorTables.filter(t => t.areaId === areaId).map(t => t.sort ?? 0))
    const seatsNum = seats === '' || seats == null ? null : Number(seats)
    const rows = []
    for (let n = a; n <= b; n++) {
      if (have.has(String(n))) continue
      sort += 1
      rows.push({ id: newFloorId('t_') + n, areaId, name: String(n), seats: Number.isFinite(seatsNum) ? seatsNum : null, sort })
    }
    if (!rows.length) return 0
    setFloorTables(prev => [...prev, ...rows])
    rows.forEach(r => sendMenuOp('floor_table', { id: r.id, area_id: r.areaId, name: r.name, seats: r.seats, sort: r.sort }))
    return rows.length
  }, [floorTables, setFloorTables])

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
    sendMenuOp('menu_category', { kind: type, name })
    showToast('Category added')
    return name
  }, [setCategoryState, showToast, stockCategories, tillCategories])

  const addStaffMember = useCallback((name, pin, roleArg = 'staff') => {
    const cleanName = String(name || '').trim()
    const cleanPin = String(pin || '').replace(/\D/g, '').slice(0, 4)
    if (!cleanName || cleanPin.length !== 4) return
    const id = newStaffUuid()
    const role = roleArg === 'manager' ? 'manager' : 'staff'
    const row = { id, name: cleanName, pin: cleanPin, role, active: true }
    setStaff(prev => [...(Array.isArray(prev) ? prev : []), row])
    sendStaffOp('staff_add', row)
  }, [setStaff])

  const updateStaffPin = useCallback((name, pin) => {
    const cleanPin = String(pin || '').replace(/\D/g, '').slice(0, 4)
    if (cleanPin.length !== 4) return
    const rowId = (Array.isArray(staffRef.current) ? staffRef.current : []).find(s => s?.name === name)?.id ?? null
    setStaff(prev =>
      (Array.isArray(prev) ? prev : []).map(s => (s?.name === name ? { ...s, pin: cleanPin } : s)),
    )
    sendStaffOp('staff_pin', { id: rowId, name, pin: cleanPin })
  }, [setStaff])

  const updateStaffRole = useCallback((name, role) => {
    const nextRole = role === 'manager' ? 'manager' : 'staff'
    const rowId = (Array.isArray(staffRef.current) ? staffRef.current : []).find(s => s?.name === name)?.id ?? null
    setStaff(prev =>
      (Array.isArray(prev) ? prev : []).map(s => (s?.name === name ? { ...s, role: nextRole } : s)),
    )
    sendStaffOp('staff_role', { id: rowId, name, role: nextRole })
  }, [setStaff])

  const removeStaffMember = useCallback((name) => {
    const victimId = (Array.isArray(staffRef.current) ? staffRef.current : []).find(s => s?.name === name)?.id ?? null
    setStaff(prev => (Array.isArray(prev) ? prev : []).filter(s => s?.name !== name))
    setCurrentlyIn(prev => (Array.isArray(prev) ? prev : []).filter(row => row.staffName !== name))
    sendStaffOp('staff_remove', { id: victimId, name })
  }, [setStaff, setCurrentlyIn])

  const clockInStaff = useCallback((staffName) => {
    if (!staffName) return
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `att_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeIso = new Date().toISOString()
    setCurrentlyIn(prev => {
      if (prev.some(row => row.staffName === staffName)) return prev
      return [...prev, { staffName, clockInTime: new Date() }]
    })
    setAttendanceLog(prev => [...prev, { id, staffName, action: 'clock_in', time: new Date(), saved: false }])
    insertAttendanceLogToSupabase({
      id,
      staff_name: staffName,
      action: 'clock_in',
      time: timeIso,
    })
    showToast(`${staffName} clocked in`)
  }, [setCurrentlyIn, setAttendanceLog, showToast])

  const clockOutStaff = useCallback((staffName) => {
    if (!staffName) return
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `att_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeIso = new Date().toISOString()
    setCurrentlyIn(prev => prev.filter(row => row.staffName !== staffName))
    setAttendanceLog(prev => [...prev, { id, staffName, action: 'clock_out', time: new Date(), saved: false }])
    insertAttendanceLogToSupabase({
      id,
      staff_name: staffName,
      action: 'clock_out',
      time: timeIso,
    })
    showToast(`${staffName} clocked out`)
  }, [setCurrentlyIn, setAttendanceLog, showToast])

  const saveShiftLogForToday = useCallback(async () => {
    if (!window.confirm('Save and close shift log for today?')) return
    const todayStarts = localDayBounds()
    const hasToday = attendanceLog.some(e =>
      isSameLocalCalendarDay(new Date(e.time), new Date()),
    )
    if (!hasToday) {
      showToast('No attendance entries today')
      return
    }
    if (supabase) {
      const range = { start: todayStarts.start.toISOString(), end: todayStarts.end.toISOString() }
      let error
      try {
        ;({ error } = await supabase
          .from('attendance_log')
          .update({ saved: true })
          .gte('time', range.start)
          .lt('time', range.end))
      } catch (err) {
        error = err
      }
      logSupabaseWrite('attendance_log', 'update', error)
      if (error) {
        if (!isLikelyNetworkFailure(error)) {
          showToast('Could not save shift log')
          return
        }
        // Offline: mark saved here now, and apply it on the server when the connection returns.
        enqueueSyncQueueItem('attendance_save', range)
        setAttendanceLog(prev =>
          prev.map(e =>
            isSameLocalCalendarDay(new Date(e.time), new Date()) ? { ...e, saved: true } : e,
          ),
        )
        showToast('Offline — shift log saved here, will sync when back online')
        return
      }
      await loadAttendanceFromSupabase(setAttendanceLog, setCurrentlyIn)
    } else {
      setAttendanceLog(prev =>
        prev.map(e =>
          isSameLocalCalendarDay(new Date(e.time), new Date()) ? { ...e, saved: true } : e,
        ),
      )
    }
    showToast('Shift log saved')
  }, [attendanceLog, setAttendanceLog, setCurrentlyIn, showToast])

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
    addStaffMember, updateStaffPin, updateStaffRole, removeStaffMember,
    managerUnlocked, verifyManagerPin, unlockManager,
    venueAuth: {
      signedIn: venue.signedIn,
      email: venue.email,
      signOut: signOutVenue,
      openSignIn: () => setVenueOpen(true),
    },
    currentStaff, setCurrentStaff,
    attendanceLog: hydratedAttendanceLog, setAttendanceLog,
    currentlyIn: hydratedCurrentlyIn, setCurrentlyIn,
    clockInStaff, clockOutStaff,
    saveShiftLogForToday,
    transactions: hydratedTx, setTransactions,
    clearSessionTransactions,
    eodReports,
    setEodReports,
    refreshEodReports: async () => {
      const reports = await loadEodReportsWithFallback()
      setEodReports(reports)
      return reports
    },
    openTabs: hydratedTabs, setOpenTabs,
    orders, updateOrder, clearOrder,
    activeOrderKey, switchOrder,
    openNewTabEntry, commitItemsToTab,
    settleTab, cancelTab, updateTabLimit,
    processCharge, voidTransaction, mergeOrderToTab,
    saveProduct, deleteProduct,
    saveStockDefinition, deleteStockDefinition,
    saveCategory,
    optionGroups, saveOptionGroup, deleteOptionGroup,
    updateTabDetails, moveTab, mergeTabs, unmergeTab, mergeHistory, openSplit: (id) => setSplitTabId(id), openDiscount: (id) => setDiscountTabId(id),
    floorAreas, floorTables, floorShapes, saveFloorTable, deleteFloorTable, addFloorTableRange,
    saveFloorShape, deleteFloorShape,
    saveFloorArea, deleteFloorArea,
    goToTill: () => setView('till'),
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
      {features.stations && view === 'kitchen' && <BarView showToast={showToast} station="kitchen" />}
      {view === 'bar'  && <BarView showToast={showToast} station={features.stations ? 'bar' : null} />}
      {view === 'tabs'  && <TabsView {...sharedProps} />}
      {view === 'stock' && <Stock  {...sharedProps} />}
      {view === 'staff' && <StaffLog {...sharedProps} />}
      {view === 'sales' && (
        <ManagerGate unlocked={managerUnlocked} verifyPin={verifyManagerPin} onUnlock={unlockManager} title="Manager PIN: Sales and close till">
          <Sales {...sharedProps} />
        </ManagerGate>
      )}
      {features.tables && view === 'tables' && <Tables {...sharedProps} />}
      {features.reports && view === 'reports' && (
        <ManagerGate unlocked={managerUnlocked} verifyPin={verifyManagerPin} onUnlock={unlockManager} title="Manager PIN: Reports">
          <Reports {...sharedProps} />
        </ManagerGate>
      )}
      {view === 'settings' && (
        <ManagerGate unlocked={managerUnlocked} verifyPin={verifyManagerPin} onUnlock={unlockManager} title="Manager PIN: Settings">
          <Settings {...sharedProps} />
        </ManagerGate>
      )}

      {staffOverlayOpen && (
        <StaffOverlay
          verifyManagerPin={verifyManagerPin}
          onSelect={(name) => {
            setCurrentStaff(name)
            unlockManager()
            setStaffOverlayOpen(false)
            showToast('Serving as ' + name)
          }}
          onClose={() => setStaffOverlayOpen(false)}
        />
      )}
      {features.discounts && discountTabId && hydratedTabs.some(t => t.id === discountTabId) && (() => {
        const dTab = hydratedTabs.find(t => t.id === discountTabId)
        return (
          <DiscountSheet
            title={`Discount / comp — ${tabLabel(dTab)}`}
            items={dTab.items}
            onApply={(spec) => { applyTabDiscount(discountTabId, spec); setDiscountTabId(null) }}
            onClear={(lines) => { clearTabDiscount(discountTabId, lines); setDiscountTabId(null) }}
            onClose={() => setDiscountTabId(null)}
            managerUnlocked={managerUnlocked}
            verifyManagerPin={verifyManagerPin}
            unlockManager={unlockManager}
          />
        )
      })()}
      {features.tables && splitTabId && hydratedTabs.some(t => t.id === splitTabId) && (
        <SplitBill
          tab={hydratedTabs.find(t => t.id === splitTabId)}
          hasPending={Object.keys(orders[splitTabId] || {}).length > 0}
          onPay={(spec, payment, tip, cash) => payTabPart(splitTabId, spec, payment, tip, cash)}
          onClose={() => setSplitTabId(null)}
        />
      )}
      {showVenueSignIn && (
        <VenueSignIn
          onDone={() => setVenueOpen(false)}
          onSkip={() => {
            setVenueSkipped(true)
            setVenueOpen(false)
          }}
        />
      )}
      <Toast msg={toast.msg} visible={toast.visible} />
      <UpdateBanner />
    </>
  )
}
