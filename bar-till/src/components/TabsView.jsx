import { useState } from 'react'
import { fmt, tabTotal } from '../utils'
import styles from './TabsView.module.css'

export default function TabsView({ openTabs, settleTab, cancelTab, switchOrder, showToast }) {
  const [settleModal, setSettleModal] = useState(null) // tabId
  const [settlePayment, setSettlePayment] = useState('cash')

  const handleSettle = (tabId) => {
    setSettlePayment('cash')
    setSettleModal(tabId)
  }

  const confirmSettle = () => {
    settleTab(settleModal, settlePayment)
    setSettleModal(null)
  }

  const handleSwitchToTab = (id) => {
    switchOrder(id)
    // Switch nav to till — parent handles via App but we signal via showToast as hint
    showToast('Switched to till — ' + openTabs.find(t => t.id === id)?.name)
  }

  const tab = openTabs.find(t => t.id === settleModal)

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {!openTabs.length ? (
          <div className={styles.empty}>No open tabs</div>
        ) : (
          openTabs.map(tab => {
            const total = tabTotal(tab)
            const opened = new Date(tab.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            const totalItems = tab.items.reduce((s, i) => s + i.qty, 0)
            return (
              <div key={tab.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>{tab.name}</span>
                  <span className={styles.cardTotal}>{fmt(total)}</span>
                </div>
                <div className={styles.cardMeta}>
                  Opened {opened}{tab.staff ? ' · ' + tab.staff : ''} · {totalItems} items
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
        <div className={styles.overlay} onClick={() => setSettleModal(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>Settle tab</div>
            <div className={styles.sheetAmount}>{fmt(tabTotal(tab))}</div>
            <div className={styles.sheetItems}>{tab.items.map(i => `${i.qty}× ${i.name}`).join('\n')}</div>
            <div className={styles.payLabel}>Payment method</div>
            <div className={styles.payRow}>
              {['cash','card','account'].map(type => (
                <button
                  key={type}
                  className={`${styles.payBtn} ${settlePayment === type ? styles.payBtnActive : ''}`}
                  onClick={() => setSettlePayment(type)}
                >
                  {type === 'cash' ? '💵 Cash' : type === 'card' ? '💳 Card' : '📋 Account'}
                </button>
              ))}
            </div>
            <div className={styles.sheetBtns}>
              <button className={styles.cancelBtn} onClick={() => setSettleModal(null)}>Cancel</button>
              <button className={styles.confirmBtn} onClick={confirmSettle}>Settle &amp; close tab</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
