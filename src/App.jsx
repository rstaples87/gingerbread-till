import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { INITIAL_PRODUCTS, INITIAL_STAFF, STOCK_ITEMS, PRODUCT_VARIANTS, DEFAULT_TAB_LIMIT } from './data'
import { supabase } from './supabase'
import { fmt, getOrderTotal, orderToItems, tabTotal, mixerBottleDeductionForLine } from './utils'
import Header from './components/Header'
import Nav from './components/Nav'
import Till from './components/Till'
import TabsView from './components/TabsView'
import Stock from './components/Stock'
import StaffLog from './components/StaffLog'
import Sales from './components/Sales'
import StaffOverlay from './components/StaffOverlay'
import Toast from './components/Toast'

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
      await supabase.from('stock_items').insert(
        STOCK_ITEMS.map(s => ({ stock_key: s.id, qty: s.stock ?? 0 })),
      )
    }
  } catch (err) {
    console.warn('Supabase seed failed:', err?.message || err)
  }
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
      if (error) console.warn('Stock sync failed:', error.message)
    })
}

async function loadStockFromSupabase(setStockItemsRaw) {
  if (!supabase) return
  try {
    const { data, error } = await supabase.from('stock_items').select('stock_key, qty')
    if (error) throw error
    if (!data?.length) return
    setStockItemsRaw(prev => {
      const next = { ...prev }
      for (const row of data) {
        next[row.stock_key] = Number(row.qty)
      }
      return next
    })
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
      if (error) console.warn('Till stock sync failed:', error.message)
    })
}

async function loadTillStockFromSupabase(setStockRaw) {
  if (!supabase) return
  try {
    const { data, error } = await supabase.from('till_stock').select('product_id, qty')
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
      if (error) console.warn('TX sync failed:', error.message)
    })
}

export default function App() {
  const [view, setView] = useState('till')
  const [products, setProducts] = useLocalStorage('bt_products', INITIAL_PRODUCTS)
  const [stock, setStockRaw] = useLocalStorage('bt_stock', Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
  const [stockItems, setStockItemsRaw] = useLocalStorage('bt_stock_items', Object.fromEntries(STOCK_ITEMS.map(s => [s.id, s.stock])))
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
      await loadStockFromSupabase(setStockItemsRaw)
      if (cancelled) return
      await loadTillStockFromSupabase(setStockRaw)
      stockSyncReadyRef.current = true
    })()
    return () => { cancelled = true }
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
    setStock(Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
    setStockItems(Object.fromEntries(STOCK_ITEMS.map(s => [s.id, s.stock])))
  }, [products, setProducts, setStock, setStockItems])

  useEffect(() => {
    if (currentStaff === 'Manager' || !currentStaff) return
    if (hydratedCurrentlyIn.some(row => row.staffName === currentStaff)) return
    setCurrentStaff('Manager')
  }, [currentStaff, hydratedCurrentlyIn, setCurrentStaff])

  const showToast = useCallback((msg) => {
    setToast({ msg, visible: true })
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2400)
  }, [])

  const updateStock = useCallback((id, delta) => {
    setStock(s => ({ ...s, [id]: Math.max(0, (s[id] ?? 0) + delta) }))
  }, [setStock])

  const setStockValue = useCallback((id, val) => {
    setStock(s => ({ ...s, [id]: Math.max(0, val) }))
  }, [setStock])

  const addTransaction = useCallback((tx) => {
    setTransactions(prev => [tx, ...prev])
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
    switchOrder(id)
    showToast('Tab opened: ' + name)
    return id
  }, [tabIdCounter, activeSaleStaff, setTabIdCounter, setOpenTabs, setOrders, switchOrder, showToast])

  const commitItemsToTab = useCallback((tabId) => {
    const order = orders[tabId] || {}
    const tabRow = openTabs.find(t => t.id === tabId)
    if (!tabRow) return
    const limit = tabRow.limit ?? DEFAULT_TAB_LIMIT
    const orderTotal = getOrderTotal(order, products)
    const currentTabTotal = tabTotal(tabRow)
    const projectedTotal = currentTabTotal + orderTotal
    if (projectedTotal > limit) {
      showToast(
        `Cannot add items to ${tabRow.name}: current tab ${fmt(currentTabTotal)} plus ${fmt(orderTotal)} (${fmt(projectedTotal)} total) exceeds limit ${fmt(limit)}.`,
      )
      return
    }
    setOpenTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab
      const newItems = [...tab.items]
      Object.entries(order).forEach(([id, line]) => {
        const qty = typeof line === 'number' ? line : (line?.qty || 0)
        const selectedStockId = typeof line === 'object' ? line?.selectedStockId : null
        const selectedMixerId = typeof line === 'object' ? line?.selectedMixerId : null
        const p = products.find(x => x.id === Number(id))
        if (!p) return
        if (selectedStockId && PRODUCT_VARIANTS[p.id]) {
          const deduct = PRODUCT_VARIANTS[p.id].deduct || 1
          const amount = deduct * qty
          setStockItems(prev => ({ ...prev, [selectedStockId]: Math.max(0, (prev[selectedStockId] ?? 0) - amount) }))
        } else {
          const unitsToDeduct = p.bottleYield ? (qty / p.bottleYield) : qty
          setStock(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - unitsToDeduct) }))
        }
        if (selectedMixerId) {
          const mixerDef = STOCK_ITEMS.find(s => s.id === selectedMixerId)
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
      return { ...tab, items: newItems }
    }))
    clearOrder(tabId)
    showToast('Items added to ' + (tabRow.name || 'tab'))
  }, [orders, products, openTabs, setOpenTabs, setStock, setStockItems, clearOrder, showToast])

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
    setOpenTabs(prev => prev.filter(t => t.id !== tabId))
    setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
    if (activeOrderKey === tabId) switchOrder('quick')
    showToast('Tab settled — ' + fmt(total))
  }, [openTabs, addTransaction, activeSaleStaff, setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  const cancelTab = useCallback((tabId) => {
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
        if (i.selectedStockId && PRODUCT_VARIANTS[p.id]) {
          const deduct = PRODUCT_VARIANTS[p.id].deduct || 1
          const amount = deduct * i.qty
          setStockItems(prev => ({ ...prev, [i.selectedStockId]: Math.max(0, (prev[i.selectedStockId] ?? 0) - amount) }))
        } else {
          const unitsToDeduct = p.bottleYield ? (i.qty / p.bottleYield) : i.qty
          setStock(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - unitsToDeduct) }))
        }
        if (i.selectedMixerId) {
          const mixerDef = STOCK_ITEMS.find(s => s.id === i.selectedMixerId)
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
    syncTransactionToSupabase(tx)
    clearOrder('quick')
    showToast('Sale recorded — ' + fmt(total))
  }, [orders, products, addTransaction, activeSaleStaff, setStock, setStockItems, clearOrder, showToast])

  const voidTransaction = useCallback((txId) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id !== txId || tx.voided) return tx
      tx.items.forEach(i => {
        const p = products.find(x => x.id === i.productId || x.name === i.name)
        if (p) {
          if (i.selectedStockId && PRODUCT_VARIANTS[p.id]) {
            const deduct = PRODUCT_VARIANTS[p.id].deduct || 1
            const amount = deduct * i.qty
            setStockItems(prev => ({ ...prev, [i.selectedStockId]: (prev[i.selectedStockId] ?? 0) + amount }))
          } else {
            const unitsToRestore = p.bottleYield ? (i.qty / p.bottleYield) : i.qty
            setStock(s => ({ ...s, [p.id]: (s[p.id] ?? 0) + unitsToRestore }))
          }
          if (i.selectedMixerId) {
            const mixerDef = STOCK_ITEMS.find(s => s.id === i.selectedMixerId)
            const mixDed = mixerBottleDeductionForLine(p.id, i.qty, mixerDef?.bottleYield)
            setStockItems(prev => ({
              ...prev,
              [i.selectedMixerId]: (prev[i.selectedMixerId] ?? 0) + mixDed,
            }))
          }
        }
      })
      return { ...tx, voided: true, voidedAt: new Date() }
    }))
    showToast('Transaction voided — stock restored')
  }, [products, setTransactions, setStock, setStockItems, showToast])

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
    setOpenTabs(prev => prev.map(t => (t.id === tabId ? { ...t, limit: n } : t)))
    showToast(`Tab limit updated to ${fmt(n)}`)
  }, [setOpenTabs, showToast])

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
    stock, updateStock, setStockValue,
    stockItems, setStockItems,
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
      {view === 'tabs'  && <TabsView {...sharedProps} />}
      {view === 'stock' && <Stock  {...sharedProps} />}
      {view === 'staff' && <StaffLog {...sharedProps} />}
      {view === 'sales' && <Sales  {...sharedProps} />}

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
