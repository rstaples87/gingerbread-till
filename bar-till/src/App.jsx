import { useState, useEffect, useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'
import { INITIAL_PRODUCTS, INITIAL_STAFF, CATEGORIES } from './data'
import { fmt, getOrderTotal, orderToItems, tabTotal } from './utils'
import Header from './components/Header'
import Nav from './components/Nav'
import Till from './components/Till'
import TabsView from './components/TabsView'
import Stock from './components/Stock'
import Sales from './components/Sales'
import StaffOverlay from './components/StaffOverlay'
import Toast from './components/Toast'

export default function App() {
  const [view, setView] = useState('till')
  const [products, setProducts] = useLocalStorage('bt_products', INITIAL_PRODUCTS)
  const [stock, setStock] = useLocalStorage('bt_stock', Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, p.stock])))
  const [staff, setStaff] = useLocalStorage('bt_staff', INITIAL_STAFF)
  const [currentStaff, setCurrentStaff] = useLocalStorage('bt_current_staff', null)
  const [transactions, setTransactions] = useLocalStorage('bt_transactions', [])
  const [openTabs, setOpenTabs] = useLocalStorage('bt_open_tabs', [])
  const [orders, setOrders] = useLocalStorage('bt_orders', { quick: {} })
  const [activeOrderKey, setActiveOrderKey] = useLocalStorage('bt_active_order', 'quick')
  const [staffOverlayOpen, setStaffOverlayOpen] = useState(false)
  const [toast, setToast] = useState({ msg: '', visible: false })
  const [tabIdCounter, setTabIdCounter] = useLocalStorage('bt_tab_counter', 1)

  // Restore Date objects from localStorage (they're serialised as strings)
  const hydratedTabs = openTabs.map(t => ({ ...t, openedAt: new Date(t.openedAt) }))
  const hydratedTx = transactions.map(t => ({ ...t, time: new Date(t.time) }))

  useEffect(() => {
    setTimeout(() => setStaffOverlayOpen(true), 300)
  }, [])

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
    const newTab = { id, name, items: [], openedAt: new Date(), staff: currentStaff }
    setOpenTabs(prev => [...prev, newTab])
    setOrders(prev => ({ ...prev, [id]: {} }))
    switchOrder(id)
    showToast('Tab opened: ' + name)
    return id
  }, [tabIdCounter, currentStaff, setTabIdCounter, setOpenTabs, setOrders, switchOrder, showToast])

  const commitItemsToTab = useCallback((tabId) => {
    const order = orders[tabId] || {}
    setOpenTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab
      const newItems = [...tab.items]
      Object.entries(order).forEach(([id, qty]) => {
        const p = products.find(x => x.id === Number(id))
        if (!p) return
        setStock(s => ({ ...s, [p.id]: Math.max(0, s[p.id] - qty) }))
        const ex = newItems.find(i => i.name === p.name)
        if (ex) ex.qty += qty
        else newItems.push({ name: p.name, qty, price: p.price })
      })
      return { ...tab, items: newItems }
    }))
    clearOrder(tabId)
    const tab = openTabs.find(t => t.id === tabId)
    showToast('Items added to ' + (tab?.name || 'tab'))
  }, [orders, products, openTabs, setOpenTabs, setStock, clearOrder, showToast])

  const settleTab = useCallback((tabId, payment) => {
    const tab = openTabs.find(t => t.id === tabId)
    if (!tab) return
    const total = tabTotal(tab)
    addTransaction({ id: Date.now(), time: new Date(), total, items: tab.items, payment, staff: currentStaff, type: 'tab', tabName: tab.name, voided: false })
    setOpenTabs(prev => prev.filter(t => t.id !== tabId))
    setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
    if (activeOrderKey === tabId) switchOrder('quick')
    showToast('Tab settled — ' + fmt(total))
  }, [openTabs, addTransaction, currentStaff, setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  const cancelTab = useCallback((tabId) => {
    setOpenTabs(prev => prev.filter(t => t.id !== tabId))
    setOrders(prev => { const n = { ...prev }; delete n[tabId]; return n })
    if (activeOrderKey === tabId) switchOrder('quick')
    showToast('Tab cancelled')
  }, [setOpenTabs, setOrders, activeOrderKey, switchOrder, showToast])

  const processCharge = useCallback((payment) => {
    const order = orders['quick'] || {}
    const items = orderToItems(order, products)
    const total = getOrderTotal(order, products)
    items.forEach(i => {
      const p = products.find(x => x.name === i.name)
      if (p) setStock(s => ({ ...s, [p.id]: Math.max(0, s[p.id] - i.qty) }))
    })
    addTransaction({ id: Date.now(), time: new Date(), total, items, payment, staff: currentStaff, type: 'sale', voided: false })
    clearOrder('quick')
    showToast('Sale recorded — ' + fmt(total))
  }, [orders, products, addTransaction, currentStaff, setStock, clearOrder, showToast])

  const voidTransaction = useCallback((txId) => {
    setTransactions(prev => prev.map(tx => {
      if (tx.id !== txId || tx.voided) return tx
      tx.items.forEach(i => {
        const p = products.find(x => x.name === i.name)
        if (p) setStock(s => ({ ...s, [p.id]: s[p.id] + i.qty }))
      })
      return { ...tx, voided: true, voidedAt: new Date() }
    }))
    showToast('Transaction voided — stock restored')
  }, [products, setTransactions, setStock, showToast])

  const mergeOrderToTab = useCallback((tabId) => {
    const src = orders['quick'] || {}
    setOrders(prev => ({
      ...prev,
      [tabId]: Object.entries(src).reduce((acc, [id, qty]) => ({
        ...acc, [id]: (acc[id] || 0) + qty
      }), { ...(prev[tabId] || {}) }),
      quick: {}
    }))
    const tab = openTabs.find(t => t.id === tabId)
    switchOrder(tabId)
    showToast('Items added to ' + (tab?.name || 'tab'))
  }, [orders, openTabs, setOrders, switchOrder, showToast])

  const sharedProps = {
    products, setProducts,
    stock, updateStock, setStockValue,
    staff, setStaff,
    currentStaff, setCurrentStaff,
    transactions: hydratedTx, setTransactions,
    openTabs: hydratedTabs, setOpenTabs,
    orders, updateOrder, clearOrder,
    activeOrderKey, switchOrder,
    openNewTabEntry, commitItemsToTab,
    settleTab, cancelTab,
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
      {view === 'sales' && <Sales  {...sharedProps} />}

      {staffOverlayOpen && (
        <StaffOverlay
          staff={staff}
          setStaff={setStaff}
          currentStaff={currentStaff}
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
