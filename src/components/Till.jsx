import { useState, useEffect } from 'react'
import { CATEGORIES, TAB_PRESETS, DEFAULT_TAB_LIMIT } from '../data'
import { fmt, getOrderTotal, orderToItems, orderLineLabel, mixerServesPerDrink, tabTotal, localSessionDateString, lineProductId, orderLineKey, lineDetailText, saleLineText, stationTickets, tabLabel, allocateDiscount, lineAmount } from '../utils'
import DiscountSheet from './DiscountSheet'
import { features } from '../features'
import TipPicker from './TipPicker'
import { supabase } from '../supabase'
import { logSupabaseWrite } from '../supabaseWriteLog'
import { enqueueSyncQueueItem, isLikelyNetworkFailure } from '../syncQueue'
import styles from './Till.module.css'

function getPortionLabel(product) {
  return product.portionSize >= 100 ? 'glasses' : 'measures'
}

/** Strip "(mixer)" suffix for till labels — matches requested button naming */
function mixerChoiceLabel(stockItemName) {
  return String(stockItemName || '').replace(/\s*\(mixer\)\s*$/i, '').trim()
}

export default function Till({
  products, productVariants, stock, stockItems, stockDefinitions, mixerStockIds, tillCategories,
  orders, updateOrder, clearOrder, activeOrderKey, switchOrder,
  openTabs, openNewTabEntry, commitItemsToTab, mergeOrderToTab,
  processCharge, showToast, currentStaff, settleTab, optionGroups = [],
  managerUnlocked, verifyManagerPin, unlockManager,
}) {
  const [hiddenCats, setHiddenCats] = useState(() => {
    const list = tillCategories?.length ? [...tillCategories] : [...CATEGORIES]
    return new Set(list)
  })
  const [numpad, setNumpad] = useState(null) // { productId, value }
  const [chargeModal, setChargeModal] = useState(false)
  const [chargeTip, setChargeTip] = useState(0)
  const [settleTip, setSettleTip] = useState(0)
  const [confPayment, setConfPayment] = useState('cash')
  const [newTabModal, setNewTabModal] = useState(false)
  const [newTabName, setNewTabName] = useState('')
  const [payment, setPayment] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [variantSheet, setVariantSheet] = useState(null) // { productId, label, options, deduct, needsMixer }
  const [mixerSheet, setMixerSheet] = useState(null) // { productId, spiritStockId, options }
  const [settleModalOpen, setSettleModalOpen] = useState(false)
  const [settleModalTabId, setSettleModalTabId] = useState(null)
  const [settlePayment, setSettlePayment] = useState('cash')
  const [settleCashTendered, setSettleCashTendered] = useState('')
  const [postAddBdsPrompt, setPostAddBdsPrompt] = useState(null) // { payload } for bar_orders insert
  const [postSendBdsPrompt, setPostSendBdsPrompt] = useState(false)
  const [tabOrderNotes, setTabOrderNotes] = useState('')
  const [quickDiscount, setQuickDiscount] = useState(null) // { kind, value, reason, sig } for the sale being rung up
  const [discountOpen, setDiscountOpen] = useState(false)
  const stockItemById = Object.fromEntries(stockDefinitions.map(i => [i.id, i]))

  const variantDisplayName = (stockId) => (stockId ? stockItemById[stockId]?.name : null) || null

  useEffect(() => {
    setTabOrderNotes('')
  }, [activeOrderKey])

  const order = orders[activeOrderKey] || {}
  const categories = tillCategories?.length ? tillCategories : CATEGORIES
  const isTab = activeOrderKey !== 'quick'
  const hasItems = Object.keys(order).length > 0
  // A discount/comp on the current sale applies only to the order as it was when the discount was given.
  const orderSig = JSON.stringify(order)
  const activeDiscount = features.discounts && !isTab && quickDiscount && quickDiscount.sig === orderSig ? quickDiscount : null
  const saleItems = activeDiscount
    ? allocateDiscount(orderToItems(order, products), { ...activeDiscount, lines: 'all' })
    : null
  const discountOff = saleItems ? saleItems.reduce((s, i) => s + (Number(i.discount) || 0), 0) : 0
  const total = saleItems
    ? Math.round(saleItems.reduce((s, i) => s + lineAmount(i), 0) * 100) / 100
    : getOrderTotal(order, products)
  useEffect(() => {
    if (quickDiscount && (isTab || quickDiscount.sig !== orderSig)) {
      setQuickDiscount(null)
      if (!isTab && hasItems) showToast('Discount removed because the order changed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the order changing
  }, [orderSig, isTab])

  // Low stock banner
  const getCombinedVariantStock = (productId) => {
    const variant = productVariants[productId]
    if (!variant) return null
    if (variant.mixerOnly && variant.fixedSpiritStockId) {
      return stockItems?.[variant.fixedSpiritStockId] ?? 0
    }
    return variant.stockIds.reduce((sum, id) => sum + (stockItems?.[id] ?? 0), 0)
  }

  const getVariantStatus = (product) => {
    const variant = productVariants[product.id]
    const mixedDrink = variant?.needsMixer || variant?.mixerOnly
    const mixerCombined = mixedDrink
      ? (variant.mixerStockIds?.length ? variant.mixerStockIds : mixerStockIds).reduce((sum, mid) => sum + (stockItems?.[mid] ?? 0), 0)
      : null

    const combined = getCombinedVariantStock(product.id)
    if (combined == null) return null

    if (mixedDrink) {
      const mixerChoices = variant.mixerStockIds?.length ? variant.mixerStockIds : mixerStockIds
      const mixerHasServe = mixerChoices.some(mid => {
        const def = stockItemById[mid]
        const y = def?.bottleYield ?? 0
        const st = stockItems?.[mid] ?? 0
        if (!y) return st > 0
        return Math.floor(st * y) >= 1
      })
      if (!mixerHasServe) return { isOut: true, isLow: false, display: 'Out of stock' }
      const deduct = variant.deduct || 1
      const spiritOk = variant.mixerOnly
        ? (stockItems?.[variant.fixedSpiritStockId] ?? 0) >= deduct
        : variant.stockIds.some(sid => (stockItems?.[sid] ?? 0) >= deduct)
      if (!spiritOk) return { isOut: true, isLow: false, display: 'Out of stock' }
    }

    if (combined <= 0) return { isOut: true, isLow: false, display: 'Out of stock' }

    let threshold = 1
    if (product.category === 'Beer' || product.category === 'Cider') threshold = 6
    else if (product.category === 'Soft Drinks') threshold = 3
    else if (product.category === 'Spirits' || product.category === 'Shots') threshold = 0.5
    else if (product.category === 'Wine' && product.name.includes('(glass)')) threshold = 1

    const mixerLow = mixedDrink && mixerCombined > 0 && mixerCombined < 3

    return {
      isOut: combined <= 0,
      isLow: combined < threshold || mixerLow,
      display: mixedDrink
        ? `${Number.isInteger(combined) ? combined : combined.toFixed(2)} spirit · ${mixerCombined} mixer bottles`
        : `${Number.isInteger(combined) ? combined : combined.toFixed(2)} linked stock`,
    }
  }

  const lowItems = products.filter(p => p.group !== 'food').filter(p => {
    const variantStatus = getVariantStatus(p)
    if (variantStatus) return variantStatus.isLow
    const s = stock[p.id] ?? 0
    if (p.bottleYield) {
      const portions = Math.floor(s * p.bottleYield)
      return portions > 0 && portions <= 5
    }
    return s > 0 && s <= 5
  }).map(p => p.name)
  const outItems = products.filter(p => p.group !== 'food').filter(p => {
    const variantStatus = getVariantStatus(p)
    if (variantStatus) return variantStatus.isOut
    const s = stock[p.id] ?? 0
    if (p.bottleYield) return (s * p.bottleYield) < 1
    return s === 0
  }).map(p => p.name)

  const toggleCat = (cat) => {
    setHiddenCats(prev => {
      const n = new Set(prev)
      if (n.has(cat)) n.delete(cat)
      else n.add(cat)
      return n
    })
  }

  const visibleCats = categories.filter(c => !hiddenCats.has(c))
  const allChipsOpen = categories.length > 0 && hiddenCats.size === 0

  const openOrCloseAllChips = () => {
    if (allChipsOpen) {
      setHiddenCats(new Set(categories))
    } else {
      setHiddenCats(new Set())
    }
  }

  const openMixerChooser = (productId, spiritStockId) => {
    const variant = productVariants[productId]
    const mixerChoices = variant?.mixerStockIds?.length ? variant.mixerStockIds : mixerStockIds
    const options = mixerChoices.map(id => {
      const def = stockItemById[id]
      const y = def?.bottleYield ?? 0
      const st = stockItems?.[id] ?? 0
      const servesLeft = y ? Math.floor(st * y) : Math.floor(st)
      return {
        id,
        name: mixerChoiceLabel(def?.name || id),
        servesLeft,
      }
    })
    setMixerSheet({ productId, spiritStockId, options })
  }

  /** Option groups (e.g. steak cooking) assigned to a dish. POS build only. */
  const optionGroupsFor = (product) => (
    features.foodOptions && Array.isArray(product?.optionGroupIds)
      ? product.optionGroupIds.map(gid => optionGroups.find(g => g.id === gid)).filter(Boolean)
      : []
  )

  const openNumpad = (productId) => {
    const variant = productVariants[productId]
    if (variant?.mixerOnly && variant.fixedSpiritStockId) {
      openMixerChooser(productId, variant.fixedSpiritStockId)
      return
    }
    if (!variant) {
      setNumpad({ productId, value: '1', selectedStockId: null, selectedMixerId: null })
      return
    }
    if (variant.needsMixer) {
      if (variant.stockIds.length === 1) {
        openMixerChooser(productId, variant.stockIds[0])
        return
      }
      const options = variant.stockIds.map(id => ({
        id,
        stock: stockItems?.[id] ?? 0,
        name: stockItemById[id]?.name || id,
      }))
      setVariantSheet({ productId, label: variant.label, options, deduct: variant.deduct, needsMixer: true })
      return
    }
    if (variant.stockIds.length === 1) {
      const stockId = variant.stockIds[0]
      setNumpad({
        productId,
        value: '1',
        selectedStockId: stockId,
        selectedMixerId: null,
        displayName: variantDisplayName(stockId),
      })
      return
    }
    const options = variant.stockIds.map(id => ({
      id,
      stock: stockItems?.[id] ?? 0,
      name: stockItemById[id]?.name || id,
    }))
    setVariantSheet({ productId, label: variant.label, options, deduct: variant.deduct, needsMixer: false })
  }

  const npDigit = (d) => {
    setNumpad(prev => {
      let v = prev.value
      if (v === '1' && d !== '0') v = d
      else if (v.length < 2) v += d
      else v = v.slice(1) + d
      return { ...prev, value: v }
    })
  }

  const npDelete = () => setNumpad(prev => ({ ...prev, value: prev.value.slice(0, -1) || '1' }))

  const npDecQty = () => {
    setNumpad(prev => {
      const n = Math.max(1, (parseInt(prev.value, 10) || 1) - 1)
      return { ...prev, value: String(n) }
    })
  }

  const npIncQty = () => {
    setNumpad(prev => {
      const cur = Math.max(1, parseInt(prev.value, 10) || 1)
      const n = Math.min(99, cur + 1)
      return { ...prev, value: String(n) }
    })
  }

  const npConfirm = () => {
    const qty = Math.max(1, parseInt(numpad.value) || 1)
    const id = numpad.productId
    const product = products.find(p => p.id === id)
    if (!product) return
    const currentStock = stock[id] ?? 0
    const portionsAvailable = product.bottleYield ? Math.floor(currentStock * product.bottleYield) : currentStock
    if (numpad.selectedStockId && productVariants[id]) {
      const available = stockItems?.[numpad.selectedStockId] ?? 0
      const required = (productVariants[id].deduct || 1) * qty
      if (available < required) {
        showToast('Not enough stock for selection')
        return
      }
    } else if (product.group !== 'food' && portionsAvailable < 1) return

    const itemGroups = optionGroupsFor(product)
    const missing = itemGroups.find(g => g.required && !numpad.options?.[g.id])
    if (missing) {
      showToast('Choose: ' + missing.name)
      return
    }
    const chosenOptions = itemGroups
      .filter(g => numpad.options?.[g.id])
      .map(g => ({ group: g.name, choice: numpad.options[g.id] }))
    const lineNote = (numpad.note || '').trim()
    const lineKey = orderLineKey(id, chosenOptions, lineNote)

    if (numpad.selectedMixerId) {
      const mixItem = stockItemById[numpad.selectedMixerId]
      const y = mixItem?.bottleYield
      const st = stockItems?.[numpad.selectedMixerId] ?? 0
      const servesAvail = y ? Math.floor(st * y) : Math.floor(st)
      const needServes = mixerServesPerDrink(id) * qty
      if (servesAvail < needServes) {
        showToast('Not enough mixer stock')
        return
      }
    }

    updateOrder(activeOrderKey, prev => {
      const existing = prev[lineKey]
      const existingQty = typeof existing === 'number' ? existing : (existing?.qty || 0)
      const selectedStockId = numpad.selectedStockId ?? (typeof existing === 'object' ? existing?.selectedStockId : null)
      const selectedMixerId = numpad.selectedMixerId ?? (typeof existing === 'object' ? existing?.selectedMixerId : null)
      const displayName =
        numpad.displayName
        ?? variantDisplayName(selectedStockId)
        ?? (typeof existing === 'object' ? existing?.displayName : null)
        ?? null
      return {
        ...prev,
        [lineKey]: {
          qty: existingQty + qty,
          selectedStockId,
          selectedMixerId,
          displayName,
          ...(chosenOptions.length ? { options: chosenOptions } : {}),
          ...(lineNote ? { note: lineNote } : {}),
        },
      }
    })
    setNumpad(null)
    showToast(`Added ${qty}× ${product.name}`)
  }

  const changeQty = (lineKey, delta) => {
    const id = lineProductId(lineKey)
    const line = order[lineKey]
    const existingQty = typeof line === 'number' ? line : (line?.qty || 0)
    const qty = existingQty + delta
    if (qty <= 0) {
      updateOrder(activeOrderKey, prev => {
        const n = { ...prev }
        delete n[lineKey]
        return n
      })
      return
    }
    if (delta > 0) {
      const selectedStockId = typeof line === 'object' ? line?.selectedStockId : null
      const selectedMixerId = typeof line === 'object' ? line?.selectedMixerId : null
      if (selectedStockId && productVariants[id]) {
        const available = stockItems?.[selectedStockId] ?? 0
        const required = (productVariants[id].deduct || 1) * qty
        if (available < required) {
          showToast('Not enough stock for selection')
          return
        }
      }
      if (selectedMixerId) {
        const mixItem = stockItemById[selectedMixerId]
        const y = mixItem?.bottleYield
        const st = stockItems?.[selectedMixerId] ?? 0
        const servesAvail = y ? Math.floor(st * y) : Math.floor(st)
        const needServes = mixerServesPerDrink(id) * qty
        if (servesAvail < needServes) {
          showToast('Not enough mixer stock')
          return
        }
      }
    }
    updateOrder(activeOrderKey, prev => {
      const prevLine = prev[lineKey]
      const selectedStockId = typeof prevLine === 'object' ? prevLine?.selectedStockId : null
      const selectedMixerId = typeof prevLine === 'object' ? prevLine?.selectedMixerId : null
      const displayName = typeof prevLine === 'object' ? prevLine?.displayName : null
      const keepOptions = typeof prevLine === 'object' && prevLine?.options?.length ? { options: prevLine.options } : {}
      const keepNote = typeof prevLine === 'object' && prevLine?.note ? { note: prevLine.note } : {}
      return { ...prev, [lineKey]: { qty, selectedStockId, selectedMixerId, displayName, ...keepOptions, ...keepNote } }
    })
  }

  const handleCharge = () => {
    setConfPayment(payment)
    setCashTendered('')
    setChargeModal(true)
  }

  const confirmCharge = () => {
    const tenderedValue = parseFloat(cashTendered)
    const hasTendered = cashTendered.trim() !== '' && !Number.isNaN(tenderedValue)
    const noteTrim = tabOrderNotes.trim()
    const extras = {
      ...(confPayment === 'cash' && hasTendered
        ? { tenderedAmount: tenderedValue, changeGiven: Math.max(0, tenderedValue - (total + (features.tips ? chargeTip : 0))) }
        : {}),
      ...(noteTrim ? { notes: noteTrim } : {}),
      ...(features.tips && chargeTip > 0 ? { tip: chargeTip } : {}),
    }
    if (features.stations) {
      // Food in a quick sale (e.g. takeaway) still needs cooking; drinks are served straight away.
      const kitchen = buildStationPayloads({ tabName: 'Quick sale', notes: noteTrim || null, kitchenOnly: true })
      if (kitchen.length) sendToStations(kitchen)
    }
    processCharge(confPayment, { ...extras, ...(activeDiscount ? { discount: { kind: activeDiscount.kind, value: activeDiscount.value, reason: activeDiscount.reason } } : {}) })
    setQuickDiscount(null)
    setTabOrderNotes('')
    setChargeModal(false)
    setCashTendered('')
  }

  const closeChargeModal = () => {
    setChargeModal(false)
    setCashTendered('')
  }

  const handleAddToTab = () => {
    if (!openTabs.length) { setNewTabModal(true); return }
    if (openTabs.length === 1) { mergeOrderToTab(openTabs[0].id); return }
    const names = openTabs.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
    const choice = prompt('Add to which tab?\n' + names + '\n\nEnter number:')
    const idx = parseInt(choice) - 1
    if (!isNaN(idx) && openTabs[idx]) mergeOrderToTab(openTabs[idx].id)
  }

  const confirmNewTab = () => {
    const name = newTabName.trim()
    if (!name) { showToast('Please enter a name'); return }
    openNewTabEntry(name)
    setNewTabModal(false)
    setNewTabName('')
  }

  const activeTab = openTabs.find(t => t.id === activeOrderKey)
  const orderHeadTitle = activeOrderKey === 'quick' ? 'Quick sale' : (activeTab?.name || 'Tab')
  const tabLimit = activeTab ? (activeTab.limit ?? DEFAULT_TAB_LIMIT) : null
  const tabCommittedTotal = activeTab ? tabTotal(activeTab) : 0
  const tabCombinedTotal = tabCommittedTotal + total
  const tabRemaining = tabLimit != null ? tabLimit - tabCombinedTotal : null
  const tabLimitReached = Boolean(isTab && tabLimit != null && tabCommittedTotal >= tabLimit)
  const wouldExceedTabLimit = Boolean(isTab && tabLimit != null && tabCommittedTotal + total > tabLimit)
  const tenderedValue = parseFloat(cashTendered)
  const hasTendered = cashTendered.trim() !== '' && !Number.isNaN(tenderedValue)
  const isCashConfirm = confPayment === 'cash'
  const payTotal = Math.round((total + (features.tips ? chargeTip : 0)) * 100) / 100
  const isAmountTooLow = isCashConfirm && hasTendered && tenderedValue < payTotal
  const canConfirmCharge = !isCashConfirm || (hasTendered && tenderedValue >= payTotal)
  const changeDue = isCashConfirm && hasTendered ? Math.max(0, tenderedValue - payTotal) : 0

  const canSettleNow =
    Boolean(activeTab) && (tabCommittedTotal > 0 || (hasItems && !wouldExceedTabLimit))

  const closeSettleModal = () => {
    setSettleModalOpen(false)
    setSettleModalTabId(null)
    setSettleCashTendered('')
  }

  const openSettleModal = () => {
    if (!activeTab) return
    if (hasItems) {
      if (wouldExceedTabLimit) {
        showToast('Cannot settle: items would exceed the tab limit')
        return
      }
      const committed = commitItemsToTab(activeOrderKey)
      if (!committed) return
    } else if (tabCommittedTotal <= 0) {
      return
    }
    setSettleModalTabId(activeOrderKey)
    setSettlePayment('cash')
    setSettleCashTendered('')
    setTimeout(() => setSettleModalOpen(true), 0)
  }

  const settleTabForModal = settleModalTabId ? openTabs.find(t => t.id === settleModalTabId) : null
  const settleModalTotal = settleTabForModal ? tabTotal(settleTabForModal) : 0
  const settleTenderedValue = parseFloat(settleCashTendered)
  const settleHasTendered = settleCashTendered.trim() !== '' && !Number.isNaN(settleTenderedValue)
  const settleIsCash = settlePayment === 'cash'
  const settleTipAmt = features.tips && settlePayment !== 'account' ? settleTip : 0
  const settlePayTotal = Math.round((settleModalTotal + settleTipAmt) * 100) / 100
  const settleAmountTooLow = settleIsCash && settleHasTendered && settleTenderedValue < settlePayTotal
  const settleCanConfirm = !settleIsCash || (settleHasTendered && settleTenderedValue >= settlePayTotal)
  const settleChangeDue = settleIsCash && settleHasTendered ? Math.max(0, settleTenderedValue - settlePayTotal) : 0

  const confirmSettleTill = () => {
    if (!settleModalTabId || !settleTabForModal) {
      closeSettleModal()
      return
    }
    const extras = settlePayment === 'cash' && settleHasTendered
      ? { tenderedAmount: settleTenderedValue, changeGiven: settleChangeDue }
      : {}
    settleTab(settleModalTabId, settlePayment, { ...extras, ...(settleTipAmt > 0 ? { tip: settleTipAmt } : {}) })
    closeSettleModal()
  }

  const buildBarOrderItemsFromPanel = () => {
    const lines = []
    for (const [id, line] of Object.entries(order)) {
      const p = products.find(x => x.id === lineProductId(id))
      if (!p) continue
      const qty = typeof line === 'number' ? line : (line?.qty || 0)
      const mixerId = typeof line === 'object' ? line?.selectedMixerId : null
      const mixerLine = mixerId ? mixerChoiceLabel(stockItemById[mixerId]?.name) : null
      let name = orderLineLabel(line, p.name)
      if (mixerLine) name = `${name} (${mixerLine})`
      if (features.stations) {
        // Kitchen/bar tickets show choices and notes on their own lines.
        const opts = (typeof line === 'object' ? line?.options || [] : []).map(o => o.choice).join(', ')
        const lineNote = typeof line === 'object' ? line?.note : ''
        lines.push({
          name, qty, price: Number(p.price), group: p.group === 'food' ? 'food' : 'drink',
          ...(opts ? { options: opts } : {}),
          ...(lineNote ? { note: lineNote } : {}),
        })
        continue
      }
      const detail = lineDetailText(line)
      if (detail) name = `${name} (${detail})`
      lines.push({ name, qty, price: Number(p.price) })
    }
    return lines
  }

  const buildBarOrderPayloadFromPanel = () => {
    if (!isTab || !activeTab) return null
    const items = buildBarOrderItemsFromPanel()
    if (!items.length) return null
    const t = getOrderTotal(order, products)
    const noteTrim = tabOrderNotes.trim()
    return {
      tab_name: activeTab.name,
      items,
      total: Math.round(t * 100) / 100,
      staff_name: currentStaff || 'Unknown',
      status: 'pending',
      session_date: localSessionDateString(),
      notes: noteTrim ? noteTrim : null,
    }
  }

  /** Returns 'sent', 'queued' (offline — replayed by the sync queue) or false. */
  const insertBarOrderPayload = async (payload) => {
    if (!payload || !supabase) {
      showToast('Could not send to BDS')
      return false
    }
    // Client-side id + sent_at make the insert idempotent, so a queued replay can't duplicate the order.
    const row = {
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
      sent_at: payload.sent_at ?? new Date().toISOString(),
    }
    try {
      let { error } = await supabase.from('bar_orders').upsert(row, { onConflict: 'id' })
      if (error && !isLikelyNetworkFailure(error) && row.notes != null) {
        const { notes: _n, ...rest } = row
        const second = await supabase.from('bar_orders').upsert(rest, { onConflict: 'id' })
        error = second.error
      }
      logSupabaseWrite('bar_orders', 'insert', error)
      if (error) throw error
      return 'sent'
    } catch (e) {
      console.warn(e)
      if (isLikelyNetworkFailure(e)) {
        enqueueSyncQueueItem('bar_order', row)
        return 'queued'
      }
      showToast('Could not send to BDS')
      return false
    }
  }

  const bdsToast = (result) =>
    showToast(result === 'queued'
      ? 'Offline — order will reach the bar screen when back online'
      : 'Order sent to BDS')

  const handleAddItemsClick = () => {
    if (!hasItems || wouldExceedTabLimit || !isTab || !activeTab) return
    if (features.stations) {
      const payloads = buildStationPayloads({ tabName: tabLabel(activeTab), covers: activeTab.covers, notes: tabOrderNotes.trim() })
      const committed = commitItemsToTab(activeOrderKey)
      if (committed) {
        setTabOrderNotes('')
        if (payloads.length) sendToStations(payloads)
      }
      return
    }
    const payload = buildBarOrderPayloadFromPanel()
    if (!payload) return
    const ok = commitItemsToTab(activeOrderKey)
    if (ok) {
      setTabOrderNotes('')
      setPostAddBdsPrompt({ payload })
    }
  }

  const confirmPostAddSendToBds = async () => {
    const payload = postAddBdsPrompt?.payload
    setPostAddBdsPrompt(null)
    if (!payload) return
    const ok = await insertBarOrderPayload(payload)
    if (ok) bdsToast(ok)
  }

  const handleSendToBar = async () => {
    if (!isTab || !activeTab || !hasItems) return
    if (features.stations) {
      const payloads = buildStationPayloads({ tabName: tabLabel(activeTab), covers: activeTab.covers, notes: tabOrderNotes.trim() })
      if (!payloads.length) return
      if (await sendToStations(payloads)) {
        setTabOrderNotes('')
        setPostSendBdsPrompt(true)
      }
      return
    }
    const payload = buildBarOrderPayloadFromPanel()
    if (!payload) return
    const ok = await insertBarOrderPayload(payload)
    if (!ok) return
    setTabOrderNotes('')
    bdsToast(ok)
    setPostSendBdsPrompt(true)
  }

  /** POS: one ticket per station that has items — food to the kitchen screen, drinks to the bar screen. */
  const buildStationPayloads = ({ tabName, covers, notes, kitchenOnly = false }) => {
    const items = buildBarOrderItemsFromPanel()
    if (!items.length) return []
    return stationTickets(items, {
      tab_name: tabName,
      staff_name: currentStaff || 'Unknown',
      status: 'pending',
      session_date: localSessionDateString(),
      notes: notes || null,
      ...(covers != null ? { covers } : {}),
    }, { kitchenOnly })
  }

  const sendToStations = async (payloads) => {
    let anyQueued = false
    let ok = true
    for (const p of payloads) {
      const r = await insertBarOrderPayload(p)
      if (!r) ok = false
      if (r === 'queued') anyQueued = true
    }
    if (!ok) return false
    const where = payloads.map(p => (p.station === 'kitchen' ? 'kitchen' : 'bar')).join(' and ')
    showToast(anyQueued ? `Offline — will reach the ${where} screen when back online` : `Sent to ${where}`)
    return true
  }

  const confirmPostSendAddToTab = () => {
    setPostSendBdsPrompt(false)
    setTabOrderNotes('')
    commitItemsToTab(activeOrderKey)
  }

  return (
    <div className={styles.wrap}>
      {/* Tabs bar */}
      <div className={`${styles.tabsBar} hide-scroll`}>
        <button
          type="button"
          className={`${styles.tabChip} ${activeOrderKey === 'quick' ? styles.tabChipActive : ''}`}
          onClick={() => switchOrder('quick')}
        >
          Quick sale
        </button>
        {openTabs.map(tab => {
          const hasOrderItems = orders[tab.id] && Object.keys(orders[tab.id]).length > 0
          const lim = tab.limit ?? DEFAULT_TAB_LIMIT
          const combined = tabTotal(tab) + getOrderTotal(orders[tab.id] || {}, products)
          const rem = lim - combined
          const chipAtOrOverLimit = combined >= lim
          const chipNearLimit = !chipAtOrOverLimit && rem <= 20
          const chipActive = activeOrderKey === tab.id
          let chipClass = styles.tabChip
          if (chipActive) chipClass += ` ${styles.tabChipActive}`
          else if (hasOrderItems) chipClass += ` ${styles.tabChipHasItems}`
          if (chipAtOrOverLimit) chipClass += ` ${styles.tabChipAtLimit}`
          else if (chipNearLimit) chipClass += ` ${styles.tabChipNearLimit}`
          return (
            <button
              key={tab.id}
              type="button"
              className={chipClass}
              onClick={() => switchOrder(tab.id)}
            >
              {chipNearLimit && <span className={styles.tabChipWarnMark} aria-hidden>!</span>}
              {tabLabel(tab)}
            </button>
          )
        })}
        <button className={styles.addTabBtn} onClick={() => setNewTabModal(true)} title="New tab">+</button>
      </div>

      {tabLimitReached && activeTab && (
        <div className={styles.tabLimitBanner}>
          ⚠ Tab limit of {fmt(tabLimit)} reached for {activeTab.name}. Please settle the tab before adding more items.
        </div>
      )}

      {/* Category toggles */}
      <div className={`${styles.catToggles} hide-scroll`}>
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            className={`${styles.catToggle} ${hiddenCats.has(cat) ? styles.catOff : styles.catOn}`}
            onClick={() => toggleCat(cat)}
          >
            {cat}
          </button>
        ))}
        <button
          type="button"
          className={styles.openAllBtn}
          onClick={openOrCloseAllChips}
        >
          {allChipsOpen ? 'Close all' : 'Open all'}
        </button>
      </div>

      {/* Products */}
      <div className={`${styles.productsScroll} ${tabLimitReached ? styles.productsScrollBlocked : ''}`}>
        {visibleCats.map(cat => (
          <div key={cat} className={styles.catSection}>
            <div className={styles.grid}>
              {products.filter(p => p.category === cat).map(p => {
                const variantStatus = getVariantStatus(p)
                const s = stock[p.id] ?? 0
                const portionsAvailable = p.bottleYield ? Math.floor(s * p.bottleYield) : s
                const isFood = p.group === 'food'
                const isOut = isFood ? false : variantStatus ? variantStatus.isOut : (p.bottleYield ? portionsAvailable < 1 : s === 0)
                const isLow = isFood ? false : variantStatus ? variantStatus.isLow : (p.bottleYield ? portionsAvailable > 0 && portionsAvailable <= 5 : s > 0 && s <= 5)
                const portionLabel = p.bottleYield ? getPortionLabel(p) : null
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.prodBtn} ${isOut ? styles.prodOut : ''}`}
                    onClick={() => openNumpad(p.id)}
                    disabled={isOut || tabLimitReached}
                  >
                    <div className={styles.prodName}>{p.name}</div>
                    <div className={styles.prodPrice}>{fmt(p.price)}</div>
                    {!isFood && <div className={`${styles.prodStock} ${isLow ? styles.stockLow : ''}`}>
                      {isOut
                        ? 'Out of stock'
                        : variantStatus
                          ? variantStatus.display
                          : p.bottleYield
                            ? `${portionsAvailable} ${portionLabel} available`
                            : isLow
                              ? `Low — ${s} left`
                              : `${s} in stock`}
                    </div>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Low stock banner */}
      {(outItems.length > 0 || lowItems.length > 0) && (
        <div className={styles.banner}>
          {outItems.length > 0 && `⚠ Out of stock: ${outItems.join(', ')}. `}
          {lowItems.length > 0 && `Low stock: ${lowItems.join(', ')}.`}
        </div>
      )}

      {/* Order panel */}
      <div className={styles.orderPanel}>
        <div className={styles.orderHead}>
          <span className={styles.orderTitle}>{orderHeadTitle}</span>
          <button
            className={styles.clearBtn}
            onClick={() => {
              clearOrder(activeOrderKey)
              setTabOrderNotes('')
            }}
          >
            Clear
          </button>
        </div>
        <div className={styles.orderItems}>
          {!hasItems ? (
            <div className={styles.orderEmpty}>Tap a product to add it</div>
          ) : (
            Object.entries(order).map(([id, line]) => {
              const qty = typeof line === 'number' ? line : (line?.qty || 0)
              const mixerId = typeof line === 'object' ? line?.selectedMixerId : null
              const p = products.find(x => x.id === lineProductId(id))
              if (!p) return null
              const detailLine = lineDetailText(line)
              const mixerLine = mixerId ? mixerChoiceLabel(stockItemById[mixerId]?.name) : null
              return (
                <div key={id} className={styles.orderItem}>
                  <div>
                    <div className={styles.oiName}>{orderLineLabel(line, p.name)}</div>
                    {mixerLine && (
                      <div className={styles.oiUnit}>{mixerLine}</div>
                    )}
                    {detailLine && (
                      <div className={styles.oiUnit}>{detailLine}</div>
                    )}
                    <div className={styles.oiUnit}>{fmt(p.price)} each</div>
                  </div>
                  <div className={styles.oiControls}>
                    <button className={styles.qtyBtn} onClick={() => changeQty(id, -1)}>−</button>
                    <span className={styles.oiQty}>{qty}</span>
                    <button className={styles.qtyBtn} onClick={() => changeQty(id, 1)}>+</button>
                    <span className={styles.oiSub}>{fmt(p.price * qty)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className={styles.orderNoteWrap}>
          <input
            className={styles.orderNoteInput}
            type="text"
            maxLength={500}
            placeholder="Add a note for the bar (e.g. no ice)..."
            value={tabOrderNotes}
            onChange={(e) => setTabOrderNotes(e.target.value)}
            aria-label="Note for Bar Display System"
          />
        </div>
        <div className={styles.orderFooter}>
          {features.discounts && !isTab && hasItems && (
            <div className={styles.totalRow}>
              {activeDiscount ? (
                <>
                  <span className={styles.totalLabel}>
                    {activeDiscount.kind === 'comp' ? 'Comp' : 'Discount'} ({activeDiscount.reason})
                  </span>
                  <span className={styles.totalAmount}>
                    −{fmt(discountOff)}{' '}
                    <button type="button" onClick={() => setQuickDiscount(null)} aria-label="Remove discount" style={{ border: 'none', background: 'none', color: 'var(--red)', fontSize: 16 }}>✕</button>
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setDiscountOpen(true)}
                  style={{ border: '1px solid var(--border)', background: 'var(--white)', borderRadius: 10, padding: '7px 12px', fontSize: 14 }}
                >
                  Discount / comp
                </button>
              )}
            </div>
          )}
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total</span>
            <span className={styles.totalAmount}>{fmt(total)}</span>
          </div>
          {isTab && tabLimit != null && tabRemaining != null && (
            <div
              className={
                `${styles.orderTabLimit} ${
                  tabRemaining <= 0 ? styles.orderTabLimitAtOrOver
                    : tabRemaining < 20 ? styles.orderTabLimitWarn
                    : ''
                }`
              }
            >
              Tab limit: {fmt(tabLimit)} · {fmt(tabRemaining)} remaining
            </div>
          )}
          {!isTab && (
            <div className={styles.payToggle}>
              {['cash', 'card'].map(type => (
                <button
                  key={type}
                  className={`${styles.payBtn} ${payment === type ? styles.payBtnActive : ''}`}
                  onClick={() => setPayment(type)}
                >
                  {type === 'cash' ? '💵 Cash' : '💳 Card'}
                </button>
              ))}
            </div>
          )}
          <div className={styles.actionBtnsWrap}>
            {isTab ? (
              <>
                <div className={`${styles.actionBtns} ${styles.actionBtnsThree}`}>
                  <button
                    type="button"
                    className={styles.tabBtn}
                    disabled={!hasItems || wouldExceedTabLimit}
                    onClick={handleAddItemsClick}
                  >
                    Add items
                  </button>
                  <button
                    type="button"
                    className={styles.settleNowBtn}
                    disabled={!canSettleNow}
                    onClick={openSettleModal}
                  >
                    Settle now
                  </button>
                  <button
                    type="button"
                    className={styles.sendToBarBtn}
                    disabled={!hasItems}
                    onClick={handleSendToBar}
                  >
                    {features.stations ? 'Send to kitchen / bar' : 'Send to BDS'}
                  </button>
                </div>
                {hasItems && wouldExceedTabLimit && (
                  <div className={styles.chargeLimitHint}>Adding these items would exceed the tab limit</div>
                )}
              </>
            ) : (
              <div className={styles.actionBtns}>
                <button
                  type="button"
                  className={styles.tabBtn}
                  disabled={!hasItems}
                  onClick={handleAddToTab}
                >
                  Add to tab ↑
                </button>
                <button
                  type="button"
                  className={styles.chargeBtn}
                  disabled={!hasItems}
                  onClick={handleCharge}
                >
                  Charge
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {discountOpen && (
        <DiscountSheet
          title="Discount / comp — this sale"
          items={orderToItems(order, products)}
          allowLines={false}
          onApply={(spec) => { setQuickDiscount({ kind: spec.kind, value: spec.value, reason: spec.reason, sig: orderSig }); setDiscountOpen(false) }}
          onClose={() => setDiscountOpen(false)}
          managerUnlocked={managerUnlocked}
          verifyManagerPin={verifyManagerPin}
          unlockManager={unlockManager}
        />
      )}

      {/* Numpad overlay */}
      {numpad && (
        <div className={styles.overlay} onClick={() => setNumpad(null)}>
          <div className={styles.sheet} style={{ maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className={styles.numpadProduct}>
              {products.find(p => p.id === numpad.productId)?.name} — {fmt(products.find(p => p.id === numpad.productId)?.price)} each
            </div>
            {(() => {
              const np = products.find(p => p.id === numpad.productId)
              const groups = optionGroupsFor(np)
              if (!features.foodOptions) return null
              return (
                <div className={styles.optionsBlock}>
                  {groups.map(g => (
                    <div key={g.id} className={styles.optGroup}>
                      <div className={styles.optLabel}>{g.name}{g.required ? ' *' : ' (optional)'}</div>
                      <div className={styles.optChips}>
                        {g.choices.map(c => {
                          const on = numpad.options?.[g.id] === c
                          return (
                            <button
                              key={c}
                              type="button"
                              className={`${styles.optChip} ${on ? styles.optChipOn : ''}`}
                              onClick={() => setNumpad(prev => ({
                                ...prev,
                                options: { ...(prev.options || {}), [g.id]: on && !g.required ? undefined : c },
                              }))}
                            >
                              {c}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  <input
                    className={styles.optNote}
                    type="text"
                    maxLength={120}
                    placeholder="Note (e.g. sauce on side)"
                    value={numpad.note || ''}
                    onChange={e => setNumpad(prev => ({ ...prev, note: e.target.value }))}
                    aria-label="Note for this item"
                  />
                </div>
              )
            })()}
            <div className={styles.numpadQtyRow}>
              <button type="button" className={styles.numpadQtyMinus} onClick={npDecQty} aria-label="Decrease quantity">−</button>
              <div className={styles.numpadDisplay}>{parseInt(numpad.value, 10) || 1}</div>
              <button type="button" className={styles.numpadQtyPlus} onClick={npIncQty} aria-label="Increase quantity">+</button>
            </div>
            <div className={styles.numpadGrid}>
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} className={styles.npBtn} onClick={() => npDigit(d)}>{d}</button>
              ))}
              <button className={`${styles.npBtn} ${styles.npDel}`} onClick={npDelete}>⌫ Del</button>
              <button className={styles.npBtn} onClick={() => npDigit('0')}>0</button>
              <button className={`${styles.npBtn} ${styles.npConfirm}`} onClick={npConfirm}>Add ✓</button>
            </div>
            <button className={styles.cancelBtn} onClick={() => setNumpad(null)}>Cancel</button>
          </div>
        </div>
      )}

      {variantSheet && (
        <div className={styles.overlay} onClick={() => setVariantSheet(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>{variantSheet.label}</div>
            <div className={styles.variantGrid}>
              {variantSheet.options.map(opt => {
                const itemStock = stockItems?.[opt.id] ?? 0
                return (
                  <button
                    key={opt.id}
                    className={styles.variantBtn}
                    disabled={itemStock <= 0}
                    onClick={() => {
                      const pid = variantSheet.productId
                      setVariantSheet(null)
                      if (variantSheet.needsMixer) {
                        openMixerChooser(pid, opt.id)
                        return
                      }
                      setNumpad({
                        productId: pid,
                        value: '1',
                        selectedStockId: opt.id,
                        selectedMixerId: null,
                        displayName: opt.name,
                      })
                    }}
                  >
                    <div>{opt.name}</div>
                    <div className={styles.variantMeta}>Stock: {Number.isInteger(itemStock) ? itemStock : itemStock.toFixed(2)}</div>
                  </button>
                )
              })}
            </div>
            <button className={styles.cancelBtn} onClick={() => setVariantSheet(null)}>Cancel</button>
          </div>
        </div>
      )}

      {mixerSheet && (
        <div className={styles.overlay} onClick={() => setMixerSheet(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>Which mixer?</div>
            <div className={styles.variantGrid}>
              {mixerSheet.options.map(opt => {
                const noneLeft = opt.servesLeft <= 0
                return (
                  <button
                    key={opt.id}
                    className={styles.variantBtn}
                    disabled={noneLeft}
                    onClick={() => {
                      setMixerSheet(null)
                      setNumpad({
                        productId: mixerSheet.productId,
                        value: '1',
                        selectedStockId: mixerSheet.spiritStockId,
                        selectedMixerId: opt.id,
                        displayName: variantDisplayName(mixerSheet.spiritStockId),
                      })
                    }}
                  >
                    <div>{opt.name} — {opt.servesLeft} serves left</div>
                  </button>
                )
              })}
            </div>
            <button className={styles.cancelBtn} onClick={() => setMixerSheet(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Charge confirm overlay */}
      {chargeModal && (
        <div className={styles.overlay} onClick={closeChargeModal}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>Confirm charge</div>
            <div className={styles.sheetAmount}>{fmt(total)}</div>
            <div className={styles.sheetItems}>
              {(saleItems || orderToItems(order, products)).map(saleLineText).join('\n')}
            </div>
            <div className={styles.sheetPayLabel}>Payment method</div>
            <div className={styles.sheetPayRow}>
              {['cash','card'].map(type => (
                <button
                  key={type}
                  className={`${styles.sheetPayBtn} ${confPayment === type ? styles.sheetPayActive : ''}`}
                  onClick={() => setConfPayment(type)}
                >
                  {type === 'cash' ? '💵 Cash' : '💳 Card'}
                </button>
              ))}
            </div>
            {features.tips && <TipPicker bill={total} onChange={setChargeTip} />}
            {confPayment === 'cash' && (
              <div className={styles.cashTenderSection}>
                <div className={styles.cashTenderLabel}>Cash tendered</div>
                <div className={styles.quickRow}>
                  {[5, 10, 20, 50].map(amount => (
                    <button
                      key={amount}
                      className={styles.quickBtn}
                      onClick={() => setCashTendered(String(amount))}
                    >
                      {fmt(amount)}
                    </button>
                  ))}
                </div>
                <input
                  className={styles.cashInput}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cashTendered}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^0-9.]/g, '')
                    setCashTendered(next)
                  }}
                />
                {hasTendered && (
                  <div className={styles.changeRow}>
                    <span className={styles.changeLabel}>Change due</span>
                    {isAmountTooLow ? (
                      <span className={styles.amountLow}>Amount too low</span>
                    ) : (
                      <span className={styles.changeAmount}>{fmt(changeDue)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className={styles.sheetBtns}>
              <button className={styles.cancelBtn} onClick={closeChargeModal}>Cancel</button>
              <button className={styles.confirmBtn} onClick={confirmCharge} disabled={!canConfirmCharge}>Confirm charge</button>
            </div>
          </div>
        </div>
      )}

      {settleModalOpen && settleTabForModal && (
        <div className={styles.overlay} onClick={closeSettleModal}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>Settle tab</div>
            <div className={styles.sheetAmount}>{fmt(settleModalTotal)}</div>
            <div className={styles.sheetItems}>
              {settleTabForModal.items.length
                ? settleTabForModal.items.map(saleLineText).join('\n')
                : 'No items'}
            </div>
            <div className={styles.sheetPayLabel}>Payment method</div>
            <div className={`${styles.sheetPayRow} ${styles.sheetPayRowThree}`}>
              {['cash', 'card', 'account'].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.sheetPayBtn} ${settlePayment === type ? styles.sheetPayActive : ''}`}
                  onClick={() => setSettlePayment(type)}
                >
                  {type === 'cash' ? '💵 Cash' : type === 'card' ? '💳 Card' : '📋 Account'}
                </button>
              ))}
            </div>
            {features.tips && settlePayment !== 'account' && <TipPicker bill={settleModalTotal} onChange={setSettleTip} />}
            {settlePayment === 'cash' && (
              <div className={styles.cashTenderSection}>
                <div className={styles.cashTenderLabel}>Cash tendered</div>
                <div className={styles.quickRow}>
                  {[5, 10, 20, 50].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className={styles.quickBtn}
                      onClick={() => setSettleCashTendered(String(amount))}
                    >
                      {fmt(amount)}
                    </button>
                  ))}
                </div>
                <input
                  className={styles.cashInput}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={settleCashTendered}
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^0-9.]/g, '')
                    setSettleCashTendered(next)
                  }}
                />
                {settleHasTendered && (
                  <div className={styles.changeRow}>
                    <span className={styles.changeLabel}>Change due</span>
                    {settleAmountTooLow ? (
                      <span className={styles.amountLow}>Amount too low</span>
                    ) : (
                      <span className={styles.changeAmount}>{fmt(settleChangeDue)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.cancelBtn} onClick={closeSettleModal}>Cancel</button>
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={confirmSettleTill}
                disabled={!settleCanConfirm}
              >
                Settle &amp; close tab
              </button>
            </div>
          </div>
        </div>
      )}

      {postAddBdsPrompt && (
        <div className={styles.overlay} onClick={() => setPostAddBdsPrompt(null)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-add-bds-title"
            onClick={e => e.stopPropagation()}
          >
            <p id="post-add-bds-title" className={styles.promptMessage}>
              Send this round to the Bar Display System?
            </p>
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.cancelBtn} onClick={() => setPostAddBdsPrompt(null)}>
                No thanks
              </button>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.promptNavyBtn}`}
                onClick={confirmPostAddSendToBds}
              >
                Yes, send
              </button>
            </div>
          </div>
        </div>
      )}

      {postSendBdsPrompt && (
        <div className={styles.overlay} onClick={() => setPostSendBdsPrompt(false)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-send-bds-title"
            onClick={e => e.stopPropagation()}
          >
            <p id="post-send-bds-title" className={styles.promptMessage}>
              Add these items to the tab?
            </p>
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.cancelBtn} onClick={() => setPostSendBdsPrompt(false)}>
                No thanks
              </button>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.promptNavyBtn}`}
                onClick={confirmPostSendAddToTab}
              >
                Yes, add to tab
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New tab overlay */}
      {newTabModal && (
        <div className={styles.overlay} onClick={() => setNewTabModal(false)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <h2 className={styles.newTabTitle}>Open a new tab</h2>
            <input
              className={styles.newTabInput}
              type="text"
              placeholder="Name or table number…"
              maxLength={24}
              value={newTabName}
              onChange={e => setNewTabName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmNewTab()}
              autoFocus
            />
            <div className={styles.presetGrid}>
              {TAB_PRESETS.map(p => (
                <button key={p} className={styles.presetBtn} onClick={() => setNewTabName(p)}>{p}</button>
              ))}
            </div>
            <div className={styles.sheetBtns}>
              <button className={styles.cancelBtn} onClick={() => setNewTabModal(false)}>Cancel</button>
              <button className={styles.confirmBtn} onClick={confirmNewTab}>Open tab</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
