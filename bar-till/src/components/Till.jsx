import { useState } from 'react'
import { CATEGORIES, TAB_PRESETS } from '../data'
import { fmt, getOrderTotal, orderToItems } from '../utils'
import styles from './Till.module.css'

export default function Till({
  products, stock,
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

  const order = orders[activeOrderKey] || {}
  const isTab = activeOrderKey !== 'quick'
  const total = getOrderTotal(order, products)
  const hasItems = Object.keys(order).length > 0

  // Low stock banner
  const lowItems = products.filter(p => stock[p.id] > 0 && stock[p.id] <= 5).map(p => p.name)
  const outItems = products.filter(p => stock[p.id] === 0).map(p => p.name)

  const toggleCat = (cat) => {
    setHiddenCats(prev => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  const openNumpad = (productId) => {
    setNumpad({ productId, value: '1' })
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

  const npConfirm = () => {
    const qty = Math.max(1, parseInt(numpad.value) || 1)
    const id = numpad.productId
    if (stock[id] <= 0) return
    updateOrder(activeOrderKey, prev => ({ ...prev, [id]: (prev[id] || 0) + qty }))
    setNumpad(null)
    showToast(`Added ${qty}× ${products.find(p => p.id === id)?.name}`)
  }

  const changeQty = (id, delta) => {
    updateOrder(activeOrderKey, prev => {
      const qty = (prev[id] || 0) + delta
      if (qty <= 0) { const n = { ...prev }; delete n[id]; return n }
      return { ...prev, [id]: qty }
    })
  }

  const handleCharge = () => {
    if (isTab) { commitItemsToTab(activeOrderKey); return }
    setConfPayment(payment)
    setChargeModal(true)
  }

  const confirmCharge = () => {
    processCharge(confPayment)
    setChargeModal(false)
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
          className={`${styles.tabChip} ${activeOrderKey === 'quick' ? styles.tabChipActive : ''}`}
          onClick={() => switchOrder('quick')}
        >
          Quick sale
        </button>
        {openTabs.map(tab => {
          const hasOrderItems = orders[tab.id] && Object.keys(orders[tab.id]).length > 0
          return (
            <button
              key={tab.id}
              className={`${styles.tabChip} ${activeOrderKey === tab.id ? styles.tabChipActive : hasOrderItems ? styles.tabChipHasItems : ''}`}
              onClick={() => switchOrder(tab.id)}
            >
              {tab.name}
            </button>
          )
        })}
        <button className={styles.addTabBtn} onClick={() => setNewTabModal(true)} title="New tab">+</button>
      </div>

      {/* Category toggles */}
      <div className={`${styles.catToggles} hide-scroll`}>
        {CATEGORIES.map(cat => (
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
      <div className={styles.productsScroll}>
        {CATEGORIES.filter(c => !hiddenCats.has(c)).map(cat => (
          <div key={cat} className={styles.catSection}>
            <div className={styles.catLabel}>{cat}</div>
            <div className={styles.grid}>
              {products.filter(p => p.category === cat).map(p => {
                const s = stock[p.id]
                const isOut = s === 0
                const isLow = s > 0 && s <= 5
                return (
                  <button
                    key={p.id}
                    className={`${styles.prodBtn} ${isOut ? styles.prodOut : ''}`}
                    onClick={() => openNumpad(p.id)}
                    disabled={isOut}
                  >
                    <div className={styles.prodName}>{p.name}</div>
                    <div className={styles.prodPrice}>{fmt(p.price)}</div>
                    <div className={`${styles.prodStock} ${isLow ? styles.stockLow : ''}`}>
                      {isOut ? 'Out of stock' : isLow ? `Low — ${s} left` : `${s} in stock`}
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
            Object.entries(order).map(([id, qty]) => {
              const p = products.find(x => x.id === Number(id))
              if (!p) return null
              return (
                <div key={id} className={styles.orderItem}>
                  <div>
                    <div className={styles.oiName}>{p.name}</div>
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
          <div className={styles.actionBtns}>
            <button
              className={styles.tabBtn}
              disabled={!hasItems || isTab}
              onClick={handleAddToTab}
            >
              Add to tab ↑
            </button>
            <button
              className={styles.chargeBtn}
              disabled={!hasItems}
              onClick={handleCharge}
            >
              {isTab ? 'Add items' : 'Charge'}
            </button>
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
            <div className={styles.numpadDisplay}>{parseInt(numpad.value) || 1}</div>
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

      {/* Charge confirm overlay */}
      {chargeModal && (
        <div className={styles.overlay} onClick={() => setChargeModal(false)}>
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
            <div className={styles.sheetBtns}>
              <button className={styles.cancelBtn} onClick={() => setChargeModal(false)}>Cancel</button>
              <button className={styles.confirmBtn} onClick={confirmCharge}>Confirm charge</button>
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
