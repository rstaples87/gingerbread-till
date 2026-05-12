import { useState } from 'react'
import { CATEGORIES, TAB_PRESETS, DEFAULT_TAB_LIMIT } from '../data'
import { fmt, getOrderTotal, orderToItems, mixerServesPerDrink, tabTotal } from '../utils'
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
  processCharge, showToast,
}) {
  const [hiddenCats, setHiddenCats] = useState(new Set())
  const [numpad, setNumpad] = useState(null) // { productId, value }
  const [chargeModal, setChargeModal] = useState(false)
  const [confPayment, setConfPayment] = useState('cash')
  const [newTabModal, setNewTabModal] = useState(false)
  const [newTabName, setNewTabName] = useState('')
  const [payment, setPayment] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [variantSheet, setVariantSheet] = useState(null) // { productId, label, options, deduct, needsMixer }
  const [mixerSheet, setMixerSheet] = useState(null) // { productId, spiritStockId, options }
  const stockItemById = Object.fromEntries(stockDefinitions.map(i => [i.id, i]))

  const order = orders[activeOrderKey] || {}
  const categories = tillCategories?.length ? tillCategories : CATEGORIES
  const isTab = activeOrderKey !== 'quick'
  const total = getOrderTotal(order, products)
  const hasItems = Object.keys(order).length > 0

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

  const lowItems = products.filter(p => {
    const variantStatus = getVariantStatus(p)
    if (variantStatus) return variantStatus.isLow
    const s = stock[p.id] ?? 0
    if (p.bottleYield) {
      const portions = Math.floor(s * p.bottleYield)
      return portions > 0 && portions <= 5
    }
    return s > 0 && s <= 5
  }).map(p => p.name)
  const outItems = products.filter(p => {
    const variantStatus = getVariantStatus(p)
    if (variantStatus) return variantStatus.isOut
    const s = stock[p.id] ?? 0
    if (p.bottleYield) return (s * p.bottleYield) < 1
    return s === 0
  }).map(p => p.name)

  const toggleCat = (cat) => {
    setHiddenCats(prev => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
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
      setNumpad({ productId, value: '1', selectedStockId: variant.stockIds[0], selectedMixerId: null })
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
    } else if (portionsAvailable < 1) return

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
      const existing = prev[id]
      const existingQty = typeof existing === 'number' ? existing : (existing?.qty || 0)
      const selectedStockId = numpad.selectedStockId ?? (typeof existing === 'object' ? existing?.selectedStockId : null)
      const selectedMixerId = numpad.selectedMixerId ?? (typeof existing === 'object' ? existing?.selectedMixerId : null)
      return { ...prev, [id]: { qty: existingQty + qty, selectedStockId, selectedMixerId } }
    })
    setNumpad(null)
    showToast(`Added ${qty}× ${product.name}`)
  }

  const changeQty = (id, delta) => {
    const line = order[id]
    const existingQty = typeof line === 'number' ? line : (line?.qty || 0)
    const qty = existingQty + delta
    if (qty <= 0) {
      updateOrder(activeOrderKey, prev => {
        const n = { ...prev }
        delete n[id]
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
      const prevLine = prev[id]
      const selectedStockId = typeof prevLine === 'object' ? prevLine?.selectedStockId : null
      const selectedMixerId = typeof prevLine === 'object' ? prevLine?.selectedMixerId : null
      return { ...prev, [id]: { qty, selectedStockId, selectedMixerId } }
    })
  }

  const handleCharge = () => {
    if (isTab) { commitItemsToTab(activeOrderKey); return }
    setConfPayment(payment)
    setCashTendered('')
    setChargeModal(true)
  }

  const confirmCharge = () => {
    const tenderedValue = parseFloat(cashTendered)
    const hasTendered = cashTendered.trim() !== '' && !Number.isNaN(tenderedValue)
    const extras = confPayment === 'cash' && hasTendered
      ? { tenderedAmount: tenderedValue, changeGiven: Math.max(0, tenderedValue - total) }
      : undefined
    processCharge(confPayment, extras)
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
  const isAmountTooLow = isCashConfirm && hasTendered && tenderedValue < total
  const canConfirmCharge = !isCashConfirm || (hasTendered && tenderedValue >= total)
  const changeDue = isCashConfirm && hasTendered ? Math.max(0, tenderedValue - total) : 0

  return (
    <div className={styles.wrap}>
      {/* Low stock banner */}
      {(outItems.length > 0 || lowItems.length > 0) && (
        <div className={styles.banner}>
          {outItems.length > 0 && `⚠ Out of stock: ${outItems.join(', ')}. `}
          {lowItems.length > 0 && `Low stock: ${lowItems.join(', ')}.`}
        </div>
      )}

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
              {tab.name}
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
            className={`${styles.catToggle} ${hiddenCats.has(cat) ? styles.catOff : styles.catOn}`}
            onClick={() => toggleCat(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className={`${styles.productsScroll} ${tabLimitReached ? styles.productsScrollBlocked : ''}`}>
        {categories.filter(c => !hiddenCats.has(c)).map(cat => (
          <div key={cat} className={styles.catSection}>
            <div className={styles.catLabel}>{cat}</div>
            <div className={styles.grid}>
              {products.filter(p => p.category === cat).map(p => {
                const variantStatus = getVariantStatus(p)
                const s = stock[p.id] ?? 0
                const portionsAvailable = p.bottleYield ? Math.floor(s * p.bottleYield) : s
                const isOut = variantStatus ? variantStatus.isOut : (p.bottleYield ? portionsAvailable < 1 : s === 0)
                const isLow = variantStatus ? variantStatus.isLow : (p.bottleYield ? portionsAvailable > 0 && portionsAvailable <= 5 : s > 0 && s <= 5)
                const portionLabel = p.bottleYield ? getPortionLabel(p) : null
                return (
                  <button
                    key={p.id}
                    className={`${styles.prodBtn} ${isOut ? styles.prodOut : ''}`}
                    onClick={() => openNumpad(p.id)}
                    disabled={isOut || tabLimitReached}
                  >
                    <div className={styles.prodName}>{p.name}</div>
                    <div className={styles.prodPrice}>{fmt(p.price)}</div>
                    <div className={`${styles.prodStock} ${isLow ? styles.stockLow : ''}`}>
                      {isOut
                        ? 'Out of stock'
                        : variantStatus
                          ? variantStatus.display
                          : p.bottleYield
                          ? `${portionsAvailable} ${portionLabel} available`
                          : isLow
                            ? `Low — ${s} left`
                            : `${s} in stock`}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Order panel */}
      <div className={styles.orderPanel}>
        <div className={styles.orderHead}>
          <span className={styles.orderTitle}>{orderHeadTitle}</span>
          <button className={styles.clearBtn} onClick={() => clearOrder(activeOrderKey)}>Clear</button>
        </div>
        <div className={styles.orderItems}>
          {!hasItems ? (
            <div className={styles.orderEmpty}>Tap a product to add it</div>
          ) : (
            Object.entries(order).map(([id, line]) => {
              const qty = typeof line === 'number' ? line : (line?.qty || 0)
              const spiritId = typeof line === 'object' ? line?.selectedStockId : null
              const mixerId = typeof line === 'object' ? line?.selectedMixerId : null
              const p = products.find(x => x.id === Number(id))
              if (!p) return null
              const spiritName = spiritId ? stockItemById[spiritId]?.name : null
              const mixerLine = mixerId ? mixerChoiceLabel(stockItemById[mixerId]?.name) : null
              const variantSubtitle = spiritName && mixerLine ? `${spiritName} · ${mixerLine}` : null
              return (
                <div key={id} className={styles.orderItem}>
                  <div>
                    <div className={styles.oiName}>{p.name}</div>
                    {variantSubtitle && (
                      <div className={styles.oiUnit}>{variantSubtitle}</div>
                    )}
                    <div className={styles.oiUnit}>{fmt(p.price)} each</div>
                  </div>
                  <div className={styles.oiControls}>
                    <button className={styles.qtyBtn} onClick={() => changeQty(Number(id), -1)}>−</button>
                    <span className={styles.oiQty}>{qty}</span>
                    <button className={styles.qtyBtn} onClick={() => changeQty(Number(id), 1)}>+</button>
                    <span className={styles.oiSub}>{fmt(p.price * qty)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className={styles.orderFooter}>
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
            <div className={styles.actionBtns}>
              <button
                type="button"
                className={styles.tabBtn}
                disabled={!hasItems || isTab}
                onClick={handleAddToTab}
              >
                Add to tab ↑
              </button>
              <button
                type="button"
                className={styles.chargeBtn}
                disabled={!hasItems || (isTab && wouldExceedTabLimit)}
                onClick={handleCharge}
              >
                {isTab ? 'Add items' : 'Charge'}
              </button>
            </div>
            {isTab && hasItems && wouldExceedTabLimit && (
              <div className={styles.chargeLimitHint}>Adding these items would exceed the tab limit</div>
            )}
          </div>
        </div>
      </div>

      {/* Numpad overlay */}
      {numpad && (
        <div className={styles.overlay} onClick={() => setNumpad(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.numpadProduct}>
              {products.find(p => p.id === numpad.productId)?.name} — {fmt(products.find(p => p.id === numpad.productId)?.price)} each
            </div>
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
                      setNumpad({ productId: pid, value: '1', selectedStockId: opt.id, selectedMixerId: null })
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
              {orderToItems(order, products).map(i => `${i.qty}× ${i.name}`).join('\n')}
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
