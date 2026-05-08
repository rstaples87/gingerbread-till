import { useState } from 'react'
import { fmt } from '../utils'
import styles from './Sales.module.css'

export default function Sales({ transactions, setTransactions, voidTransaction, products }) {
  const [reportOpen, setReportOpen] = useState(false)
  const [float, setFloat] = useState(50)

  const live = transactions.filter(t => !t.voided)
  const totalTakings = live.reduce((s, t) => s + t.total, 0)
  const cashTotal = live.filter(t => t.payment === 'cash').reduce((s, t) => s + t.total, 0)
  const cardTotal = live.filter(t => t.payment === 'card').reduce((s, t) => s + t.total, 0)
  const accountTotal = live.filter(t => t.payment === 'account').reduce((s, t) => s + t.total, 0)
  const totalItems = live.reduce((s, t) => s + t.items.reduce((a, i) => a + i.qty, 0), 0)

  // Popularity
  const popularity = {}
  live.forEach(t => t.items.forEach(i => { popularity[i.name] = (popularity[i.name] || 0) + i.qty }))
  const popSorted = Object.entries(popularity).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxQty = popSorted[0]?.[1] || 1

  // Staff
  const staffMap = {}
  live.forEach(t => {
    const s = t.staff || 'Unassigned'
    if (!staffMap[s]) staffMap[s] = { total: 0, count: 0 }
    staffMap[s].total += t.total
    staffMap[s].count++
  })

  const tabTx = live.filter(t => t.type === 'tab')
  const voidedTx = transactions.filter(t => t.voided)

  if (!transactions.length) {
    return (
      <div className={styles.wrap}>
        <div className={styles.scroll}>
          <div className={styles.empty}>No sales yet</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}><div className={styles.scLabel}>Total takings</div><div className={styles.scValue}>{fmt(totalTakings)}</div></div>
          <div className={styles.statCard}><div className={styles.scLabel}>Items sold</div><div className={styles.scValue}>{totalItems}</div></div>
          <div className={styles.statCard}><div className={styles.scLabel}>Cash</div><div className={styles.scValue}>{fmt(cashTotal)}</div></div>
          <div className={styles.statCard}><div className={styles.scLabel}>Card</div><div className={styles.scValue}>{fmt(cardTotal)}</div></div>
          {accountTotal > 0 && (
            <div className={`${styles.statCard} ${styles.span2}`}><div className={styles.scLabel}>On account</div><div className={styles.scValue}>{fmt(accountTotal)}</div></div>
          )}
        </div>

        {transactions.map(tx => {
          const time = new Date(tx.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          return (
            <div key={tx.id} className={`${styles.txCard} ${tx.voided ? styles.txVoided : ''}`}>
              <div className={styles.txHead}>
                <span className={styles.txTime}>{time}</span>
                <span className={styles.txTotal}>{fmt(tx.total)}</span>
              </div>
              <div className={styles.txMeta}>
                {tx.staff && <span>{tx.staff} · </span>}
                <span className={`${styles.badge} ${tx.payment === 'cash' ? styles.badgeCash : tx.payment === 'card' ? styles.badgeCard : styles.badgeAccount}`}>
                  {tx.payment === 'cash' ? 'Cash' : tx.payment === 'card' ? 'Card' : 'Account'}
                </span>
                {tx.type === 'tab' && <span className={`${styles.badge} ${styles.badgeTab}`}>Tab: {tx.tabName}</span>}
                {tx.voided && <span className={`${styles.badge} ${styles.badgeVoid}`}>Voided</span>}
                {!tx.voided && (
                  <button className={styles.voidBtn} onClick={() => { if (confirm('Void this transaction? Stock will be restored.')) voidTransaction(tx.id) }}>Void</button>
                )}
              </div>
              <div className={styles.txDetail}>{tx.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</div>
            </div>
          )
        })}

        <button className={styles.reportBtn} onClick={() => setReportOpen(true)}>📊 End of night report</button>
        <button className={styles.sessionBtn} onClick={() => { if (confirm('Clear all sales data and start fresh?')) setTransactions([]) }}>Clear session data</button>
      </div>

      {/* End of night report */}
      {reportOpen && (
        <div className={styles.reportOverlay} onClick={() => setReportOpen(false)}>
          <div className={styles.reportSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.reportHeader}>
              <h2>End of Night Report</h2>
              <p>{new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · Generated {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>

            <div className={styles.reportSection}>
              <h3>Cash float</h3>
              <div className={styles.floatRow}>
                <span>Starting float</span>
                <input
                  className={styles.floatInput}
                  type="number"
                  value={float}
                  min={0}
                  step={5}
                  onChange={e => setFloat(parseFloat(e.target.value) || 0)}
                />
                <span>£</span>
              </div>
            </div>

            <div className={styles.reportSection}>
              <h3>Takings summary</h3>
              {[
                ['Total transactions', live.length],
                ['Total items sold', totalItems],
                ['Cash sales', fmt(cashTotal)],
                ['Card sales', fmt(cardTotal)],
                ...(accountTotal > 0 ? [['On account', fmt(accountTotal)]] : []),
              ].map(([label, val]) => (
                <div key={label} className={styles.reportRow}><span>{label}</span><span>{val}</span></div>
              ))}
              <div className={`${styles.reportRow} ${styles.reportTotal}`}><span>Total takings</span><span>{fmt(totalTakings)}</span></div>
            </div>

            <div className={styles.reportSection}>
              <h3>Cash reconciliation</h3>
              <div className={styles.reportRow}><span>Cash sales</span><span>{fmt(cashTotal)}</span></div>
              <div className={styles.reportRow}><span>Starting float</span><span>{fmt(float)}</span></div>
              <div className={`${styles.reportRow} ${styles.reportTotal} ${styles.reportHighlight}`}><span>Expected cash in till</span><span>{fmt(cashTotal + float)}</span></div>
              <div className={styles.reportRow}><span>Cash to bank (less float)</span><span>{fmt(cashTotal)}</span></div>
            </div>

            {popSorted.length > 0 && (
              <div className={styles.reportSection}>
                <h3>Top sellers</h3>
                {popSorted.map(([name, qty], i) => (
                  <div key={name}>
                    <div className={styles.popItem}>
                      <span className={styles.popRank}>{i + 1}</span>
                      <span style={{ flex: 1, padding: '0 10px' }}>{name}</span>
                      <span style={{ color: '#aaa', fontSize: 12 }}>{qty} sold</span>
                    </div>
                    <div className={styles.popBar} style={{ width: `${Math.round(qty / maxQty * 100)}%` }} />
                  </div>
                ))}
              </div>
            )}

            {Object.keys(staffMap).length > 0 && (
              <div className={styles.reportSection}>
                <h3>By staff</h3>
                {Object.entries(staffMap).map(([name, data]) => (
                  <div key={name} className={styles.reportRow}><span>{name}</span><span>{fmt(data.total)} ({data.count} sales)</span></div>
                ))}
              </div>
            )}

            {tabTx.length > 0 && (
              <div className={styles.reportSection}>
                <h3>Tabs settled</h3>
                {tabTx.map(t => (
                  <div key={t.id} className={styles.reportRow}><span>{t.tabName}</span><span>{fmt(t.total)}</span></div>
                ))}
              </div>
            )}

            {voidedTx.length > 0 && (
              <div className={styles.reportSection}>
                <h3>Voided transactions</h3>
                {voidedTx.map(t => (
                  <div key={t.id} className={`${styles.reportRow} ${styles.reportVoided}`}>
                    <span>{new Date(t.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — {t.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</span>
                    <span>{fmt(t.total)}</span>
                  </div>
                ))}
              </div>
            )}

            <button className={styles.printBtn} onClick={() => window.print()}>🖨 Print report</button>
            <button className={styles.closeBtn} onClick={() => setReportOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
