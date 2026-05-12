import { useMemo, useState } from 'react'
import { fmt, mixerBottleDeductionForLine, formatStockItemQuantity } from '../utils'
import styles from './Sales.module.css'

const DRINK_CATEGORIES = ['Wine', 'Beer', 'Cider', 'Spirits', 'Shots', 'Soft Drinks']

const SPIRIT_BREAKDOWN_CATS = ['House Spirits', 'Premium Spirits', 'Other Spirits', 'Mixers']

const SPIRIT_STOCK_CAT = new Set(['House Spirits', 'Premium Spirits', 'Other Spirits'])

function formatBottles2(v) {
  return (Math.round((v ?? 0) * 100) / 100).toFixed(2)
}

function buildDrinksSoldByCategory(products, live) {
  const byKey = {}
  for (const tx of live) {
    for (const i of tx.items) {
      const p = products.find(x => x.id === i.productId || x.name === i.name)
      if (!p || !DRINK_CATEGORIES.includes(p.category)) continue
      const key = p.id
      if (!byKey[key]) {
        byKey[key] = { name: p.name, category: p.category, qty: 0, revenue: 0 }
      }
      byKey[key].qty += i.qty
      byKey[key].revenue += i.price * i.qty
    }
  }
  const out = {}
  for (const cat of DRINK_CATEGORIES) {
    const rows = Object.values(byKey).filter(r => r.category === cat).sort((a, b) => a.name.localeCompare(b.name))
    if (rows.length) out[cat] = rows
  }
  return out
}

function accumulateVariantBottleDeductions(products, live, productVariants, stockItemById) {
  const bottleById = {}
  for (const tx of live) {
    for (const i of tx.items) {
      const p = products.find(x => x.id === i.productId || x.name === i.name)
      if (!p) continue
      const pv = productVariants[p.id]

      if (i.selectedStockId && pv) {
        const def = stockItemById[i.selectedStockId]
        if (def && SPIRIT_STOCK_CAT.has(def.category)) {
          const bottles = (pv.deduct || 1) * i.qty
          bottleById[i.selectedStockId] = (bottleById[i.selectedStockId] || 0) + bottles
        }
      }

      if (i.selectedMixerId) {
        const mdef = stockItemById[i.selectedMixerId]
        if (mdef?.category === 'Mixers') {
          const bottles = mixerBottleDeductionForLine(p.id, i.qty, mdef.bottleYield)
          bottleById[i.selectedMixerId] = (bottleById[i.selectedMixerId] || 0) + bottles
        }
      }
    }
  }
  return bottleById
}

function groupRemainingStockByCategory(stockDefinitions) {
  const seen = new Set()
  const order = []
  const groups = {}
  for (const item of stockDefinitions) {
    const cat = item.category
    if (!groups[cat]) {
      groups[cat] = []
      order.push(cat)
    }
    groups[cat].push(item)
  }
  return order.map(cat => ({ cat, items: groups[cat] }))
}

function stockRowHighlight(stockVal, bottleYield) {
  const hasYield = bottleYield && bottleYield > 0
  const portions = hasYield ? Math.floor(stockVal * bottleYield) : null
  const isZero = hasYield ? stockVal <= 0 || portions < 1 : stockVal <= 0
  if (isZero) return styles.reportStockZero
  const isLow = hasYield ? stockVal > 0 && stockVal < 0.2 : stockVal > 0 && stockVal < 3
  if (isLow) return styles.reportStockLow
  return ''
}

export default function Sales({ transactions, currentlyIn, setTransactions, voidTransaction, products, stockItems, stockDefinitions, productVariants }) {
  const [reportOpen, setReportOpen] = useState(false)
  const [stockReportOpen, setStockReportOpen] = useState(false)
  const [float, setFloat] = useState(50)
  const inNames = new Set((currentlyIn || []).map(row => row.staffName))
  const visibleStaff = (name) => (name && inNames.has(name) ? name : 'Manager')

  const live = transactions.filter(t => !t.voided)
  const totalTakings = live.reduce((s, t) => s + t.total, 0)
  const cashTotal = live.filter(t => t.payment === 'cash').reduce((s, t) => s + t.total, 0)
  const cardTotal = live.filter(t => t.payment === 'card').reduce((s, t) => s + t.total, 0)
  const accountTotal = live.filter(t => t.payment === 'account').reduce((s, t) => s + t.total, 0)
  const totalItems = live.reduce((s, t) => s + t.items.reduce((a, i) => a + i.qty, 0), 0)

  const popularity = {}
  live.forEach(t => t.items.forEach(i => { popularity[i.name] = (popularity[i.name] || 0) + i.qty }))
  const popSorted = Object.entries(popularity).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxQty = popSorted[0]?.[1] || 1

  const staffMap = {}
  live.forEach(t => {
    const s = visibleStaff(t.staff)
    if (!staffMap[s]) staffMap[s] = { total: 0, count: 0 }
    staffMap[s].total += t.total
    staffMap[s].count++
  })

  const tabTx = live.filter(t => t.type === 'tab')
  const voidedTx = transactions.filter(t => t.voided)

  const stockItemById = useMemo(() => Object.fromEntries(stockDefinitions.map(s => [s.id, s])), [stockDefinitions])

  const stockReportData = useMemo(() => {
    const drinksByCat = buildDrinksSoldByCategory(products, live)
    const bottleDeductions = accumulateVariantBottleDeductions(products, live, productVariants, stockItemById)
    const remainingGroups = groupRemainingStockByCategory(stockDefinitions)
    return { drinksByCat, bottleDeductions, remainingGroups }
  }, [products, live, productVariants, stockDefinitions, stockItemById])

  const reportHeaderSubtitle = `${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · Generated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {!transactions.length ? (
          <div className={styles.empty}>No sales yet</div>
        ) : (
          <>
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
                    <span>{visibleStaff(tx.staff)} · </span>
                    <span className={`${styles.badge} ${tx.payment === 'cash' ? styles.badgeCash : tx.payment === 'card' ? styles.badgeCard : styles.badgeAccount}`}>
                      {tx.payment === 'cash' ? 'Cash' : tx.payment === 'card' ? 'Card' : 'Account'}
                    </span>
                    {tx.type === 'tab' && <span className={`${styles.badge} ${styles.badgeTab}`}>Tab: {tx.tabName}</span>}
                    {tx.voided && <span className={`${styles.badge} ${styles.badgeVoid}`}>Voided</span>}
                    {!tx.voided && (
                      <button type="button" className={styles.voidBtn} onClick={() => { if (confirm('Void this transaction? Stock will be restored.')) voidTransaction(tx.id) }}>Void</button>
                    )}
                  </div>
                  <div className={styles.txDetail}>
                    {tx.items.map(i => `${i.qty}× ${i.name}`).join(', ')}
                    {tx.payment === 'cash' && typeof tx.changeGiven === 'number' && (
                      <span className={styles.txNote}> · Change: {fmt(tx.changeGiven)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

        <button type="button" className={styles.reportBtn} onClick={() => setReportOpen(true)}>📊 End of night report</button>
        <button type="button" className={styles.reportBtnSecondary} onClick={() => setStockReportOpen(true)}>📦 Stock report</button>
        <button type="button" className={styles.sessionBtn} onClick={() => { if (confirm('Clear all sales data and start fresh?')) setTransactions([]) }}>Clear session data</button>
      </div>

      {reportOpen && (
        <div className={styles.reportOverlay} onClick={() => setReportOpen(false)}>
          <div className={styles.reportSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.reportHeader}>
              <h2>End of Night Report</h2>
              <p>{reportHeaderSubtitle}</p>
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

            <button type="button" className={styles.printBtn} onClick={() => window.print()}>🖨 Print report</button>
            <button type="button" className={styles.closeBtn} onClick={() => setReportOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {stockReportOpen && (
        <div className={styles.reportOverlay} onClick={() => setStockReportOpen(false)}>
          <div className={styles.reportSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.reportHeader}>
              <h2>Stock Report</h2>
              <p>{reportHeaderSubtitle}</p>
            </div>

            <div className={styles.reportSection}>
              <h3>Drinks sold</h3>
              {Object.keys(stockReportData.drinksByCat).length === 0 ? (
                <div className={styles.reportRow}><span>No product sales this session</span></div>
              ) : (
                DRINK_CATEGORIES.map(cat => {
                  const rows = stockReportData.drinksByCat[cat]
                  if (!rows?.length) return null
                  const subQty = rows.reduce((s, r) => s + r.qty, 0)
                  const subRev = rows.reduce((s, r) => s + r.revenue, 0)
                  return (
                    <div key={cat}>
                      <div className={styles.reportCategoryHeading}>{cat}</div>
                      <div className={styles.reportTableHead}>
                        <span>Product</span>
                        <span className={styles.reportColNum}>Qty</span>
                        <span className={styles.reportColNum}>Revenue</span>
                      </div>
                      {rows.map(r => (
                        <div key={r.name} className={styles.reportTableRow}>
                          <span>{r.name}</span>
                          <span className={styles.reportColNum}>{r.qty}</span>
                          <span className={styles.reportColNum}>{fmt(r.revenue)}</span>
                        </div>
                      ))}
                      <div className={`${styles.reportTableRow} ${styles.reportSubtotalRow}`}>
                        <span>{cat} subtotal</span>
                        <span className={styles.reportColNum}>{subQty}</span>
                        <span className={styles.reportColNum}>{fmt(subRev)}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className={styles.reportSection}>
              <h3>Spirit breakdown</h3>
              {(() => {
                const hasAny = SPIRIT_BREAKDOWN_CATS.some(cat =>
                  stockDefinitions.some(def => def.category === cat && (stockReportData.bottleDeductions[def.id] || 0) > 0),
                )
                if (!hasAny) {
                  return <div className={styles.reportRow}><span>No variant-tracked spirit or mixer sales this session</span></div>
                }
                return SPIRIT_BREAKDOWN_CATS.map(cat => {
                  const items = stockDefinitions.filter(s => s.category === cat)
                  const rows = items
                    .map(def => {
                      const bottles = stockReportData.bottleDeductions[def.id] || 0
                      if (bottles <= 0) return null
                      const y = def.bottleYield
                      const measures = y ? Math.round(bottles * y) : Math.round(bottles)
                      return { def, measures, bottlesEqStr: formatBottles2(bottles) }
                    })
                    .filter(Boolean)
                  if (!rows.length) return null
                  return (
                    <div key={cat}>
                      <div className={styles.reportCategoryHeading}>{cat}</div>
                      <div className={styles.reportTableHead}>
                        <span>Stock item</span>
                        <span className={styles.reportColNum}>{cat === 'Mixers' ? 'Serves' : 'Measures'}</span>
                        <span className={styles.reportColNum}>Bottles eq.</span>
                      </div>
                      {rows.map(({ def, measures, bottlesEqStr }) => (
                        <div key={def.id} className={styles.reportTableRow}>
                          <span>{def.name}</span>
                          <span className={styles.reportColNum}>{measures}</span>
                          <span className={styles.reportColNum}>{bottlesEqStr}</span>
                        </div>
                      ))}
                    </div>
                  )
                })
              })()}
            </div>

            <div className={styles.reportSection}>
              <h3>Remaining stock</h3>
              {stockReportData.remainingGroups.map(({ cat, items }) => (
                <div key={cat}>
                  <div className={styles.reportCategoryHeading}>{cat}</div>
                  {items.map(item => {
                    const stockVal = stockItems?.[item.id] ?? 0
                    const y = item.bottleYield
                    const hl = stockRowHighlight(stockVal, y)
                    if (y) {
                      return (
                        <div key={item.id} className={`${styles.reportTableRow} ${hl}`}>
                          <span>{item.name}</span>
                          <span className={styles.reportColNum}>{formatBottles2(stockVal)} bot.</span>
                          <span className={styles.reportColNum}>{Math.floor(stockVal * y)} portions</span>
                        </div>
                      )
                    }
                    return (
                      <div key={item.id} className={`${styles.reportTableRow} ${styles.reportTableRowUnits} ${hl}`}>
                        <span>{item.name}</span>
                        <span className={styles.reportColNum}>{formatStockItemQuantity(stockVal, item)}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className={styles.reportSection}>
              <h3>Session summary</h3>
              <div className={styles.reportRow}><span>Total transactions</span><span>{live.length}</span></div>
              <div className={styles.reportRow}><span>Total items sold</span><span>{totalItems}</span></div>
              <div className={styles.reportRow}><span>Total revenue</span><span>{fmt(totalTakings)}</span></div>
              <div className={styles.reportRow}><span>Cash</span><span>{fmt(cashTotal)}</span></div>
              <div className={styles.reportRow}><span>Card</span><span>{fmt(cardTotal)}</span></div>
              {accountTotal > 0 && (
                <div className={styles.reportRow}><span>Account</span><span>{fmt(accountTotal)}</span></div>
              )}
              {voidedTx.length > 0 && (
                <>
                  <div className={styles.reportCategoryHeading} style={{ marginTop: 10 }}>Voided transactions</div>
                  {voidedTx.map(t => (
                    <div key={t.id} className={`${styles.reportRow} ${styles.reportVoided}`}>
                      <span>{new Date(t.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — {t.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</span>
                      <span>{fmt(t.total)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <button type="button" className={styles.printBtn} onClick={() => window.print()}>🖨 Print stock report</button>
            <button type="button" className={styles.closeBtn} onClick={() => setStockReportOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
