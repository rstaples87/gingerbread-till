import { useState } from 'react'
import { DEFAULT_TAB_LIMIT } from '../data'
import { fmt, tabTotal } from '../utils'
import styles from './TabsView.module.css'

export default function TabsView({ openTabs, currentlyIn, settleTab, cancelTab, switchOrder, showToast, updateTabLimit }) {
  const [settleModal, setSettleModal] = useState(null) // tabId
  const [settlePayment, setSettlePayment] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [limitEditTabId, setLimitEditTabId] = useState(null)
  const [limitDraft, setLimitDraft] = useState('')
  const inNames = new Set((currentlyIn || []).map(row => row.staffName))

  const startLimitEdit = (tab) => {
    setLimitEditTabId(tab.id)
    setLimitDraft(String(tab.limit ?? DEFAULT_TAB_LIMIT))
  }

  const cancelLimitEdit = () => {
    setLimitEditTabId(null)
    setLimitDraft('')
  }

  const confirmLimitEdit = () => {
    const v = parseFloat(limitDraft)
    if (Number.isNaN(v)) {
      showToast('Please enter a valid amount')
      return
    }
    updateTabLimit(limitEditTabId, v)
    cancelLimitEdit()
  }

  const closeSettleModal = () => {
    setSettleModal(null)
    setCashTendered('')
  }

  const handleSettle = (tabId) => {
    setSettlePayment('cash')
    setCashTendered('')
    setSettleModal(tabId)
  }

  const confirmSettle = () => {
    const tabRow = openTabs.find(t => t.id === settleModal)
    if (!tabRow) return
    const total = tabTotal(tabRow)
    const tenderedValue = parseFloat(cashTendered)
    const hasTendered = cashTendered.trim() !== '' && !Number.isNaN(tenderedValue)
    const extras = settlePayment === 'cash' && hasTendered
      ? { tenderedAmount: tenderedValue, changeGiven: Math.max(0, tenderedValue - total) }
      : {}
    settleTab(settleModal, settlePayment, extras)
    setSettleModal(null)
    setCashTendered('')
  }

  const handleSwitchToTab = (id) => {
    switchOrder(id)
    // Switch nav to till — parent handles via App but we signal via showToast as hint
    showToast('Switched to till — ' + openTabs.find(t => t.id === id)?.name)
  }

  const tab = openTabs.find(t => t.id === settleModal)
  const settleTotal = tab ? tabTotal(tab) : 0
  const tenderedValue = parseFloat(cashTendered)
  const hasTendered = cashTendered.trim() !== '' && !Number.isNaN(tenderedValue)
  const isCashSettle = settlePayment === 'cash'
  const isAmountTooLow = isCashSettle && hasTendered && tenderedValue < settleTotal
  const canConfirmSettle = !isCashSettle || (hasTendered && tenderedValue >= settleTotal)
  const changeDue = isCashSettle && hasTendered ? Math.max(0, tenderedValue - settleTotal) : 0

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {!openTabs.length ? (
          <div className={styles.empty}>No open tabs</div>
        ) : (
          openTabs.map(tab => {
            const total = tabTotal(tab)
            const limitVal = tab.limit ?? DEFAULT_TAB_LIMIT
            const remaining = limitVal - total
            const opened = new Date(tab.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            const totalItems = tab.items.reduce((s, i) => s + i.qty, 0)
            const editingLimit = limitEditTabId === tab.id
            return (
              <div key={tab.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>{tab.name}</span>
                  <span
                    className={`${styles.cardTotal} ${
                      total >= limitVal ? styles.cardTotalAtLimit
                        : remaining > 0 && remaining < 20 ? styles.cardTotalNear
                        : ''
                    }`}
                  >
                    {fmt(total)}
                  </span>
                </div>
                <div className={styles.cardLimitSection}>
                  {editingLimit ? (
                    <div className={styles.limitEditRow}>
                      <input
                        className={styles.limitEditInput}
                        type="text"
                        inputMode="decimal"
                        value={limitDraft}
                        onChange={e => setLimitDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                        autoFocus
                      />
                      <button type="button" className={styles.limitConfirmBtn} onClick={confirmLimitEdit} aria-label="Confirm limit">✓</button>
                      <button type="button" className={styles.limitCancelBtn} onClick={cancelLimitEdit}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className={styles.cardLimitRow}>
                        <span className={styles.cardLimitLabel}>Limit: {fmt(limitVal)}</span>
                        <button type="button" className={styles.changeLimitBtn} onClick={() => startLimitEdit(tab)}>Change limit</button>
                      </div>
                      <div
                        className={
                          `${styles.cardRemaining} ${
                            remaining <= 0 ? styles.cardRemainingOver
                              : remaining < 20 ? styles.cardRemainingWarn
                              : ''
                          }`
                        }
                      >
                        {fmt(remaining)} remaining
                        {remaining <= 0 && (
                          <span className={styles.cardLimitWarnText}> ⚠ Limit reached</span>
                        )}
                        {remaining > 0 && remaining < 20 && (
                          <span className={styles.cardLimitApproachText}> ⚠ Approaching limit</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.cardMeta}>
                  Opened {opened} · {(tab.staff && inNames.has(tab.staff)) ? tab.staff : 'Manager'} · {totalItems} items
                </div>
                <div className={styles.cardItems}>
                  {tab.items.length
                    ? tab.items.map(i => `${i.qty}× ${i.name} — ${fmt(i.price * i.qty)}`).join('\n')
                    : 'No items yet'}
                </div>
                <div className={styles.cardBtns}>
                  <button className={`${styles.btn} ${styles.btnAdd}`} onClick={() => handleSwitchToTab(tab.id)}>Add items</button>
                  <button className={`${styles.btn} ${styles.btnSettle}`} onClick={() => handleSettle(tab.id)}>Settle</button>
                  <button className={`${styles.btn} ${styles.btnCancel}`} onClick={() => { if (confirm('Cancel this tab? Items will be discarded.')) cancelTab(tab.id) }}>Cancel</button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {settleModal && tab && (
        <div className={styles.overlay} onClick={closeSettleModal}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>Settle tab</div>
            <div className={styles.sheetAmount}>{fmt(settleTotal)}</div>
            <div className={styles.sheetItems}>{tab.items.map(i => `${i.qty}× ${i.name}`).join('\n')}</div>
            <div className={styles.payLabel}>Payment method</div>
            <div className={styles.payRow}>
              {['cash','card','account'].map(type => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.payBtn} ${settlePayment === type ? styles.payBtnActive : ''}`}
                  onClick={() => setSettlePayment(type)}
                >
                  {type === 'cash' ? '💵 Cash' : type === 'card' ? '💳 Card' : '📋 Account'}
                </button>
              ))}
            </div>
            {settlePayment === 'cash' && (
              <div className={styles.cashTenderSection}>
                <div className={styles.cashTenderLabel}>Cash tendered</div>
                <div className={styles.quickRow}>
                  {[5, 10, 20, 50].map(amount => (
                    <button
                      key={amount}
                      type="button"
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
              <button type="button" className={styles.cancelBtn} onClick={closeSettleModal}>Cancel</button>
              <button type="button" className={styles.confirmBtn} onClick={confirmSettle} disabled={!canConfirmSettle}>Settle &amp; close tab</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
