import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { fmt, mixerBottleDeductionForLine, formatStockItemQuantity, localSessionDateString } from '../utils'
import { useLocalStorage } from '../useLocalStorage'
import {
  buildEodReportData,
  persistEodReportEntry,
  readSavedEodReportsFromStorage,
} from '../eodReports'
import { fetchTransactionsBySessionDate } from '../transactionSync'
import EndOfNightReportBody from './EndOfNightReportBody'
import styles from './Sales.module.css'

function hydrateTransactionDates(tx) {
  return {
    ...tx,
    time: tx.time instanceof Date ? tx.time : new Date(tx.time),
    voidedAt: tx.voidedAt
      ? (tx.voidedAt instanceof Date ? tx.voidedAt : new Date(tx.voidedAt))
      : undefined,
  }
}

function readStoredSessionTransactions() {
  try {
    const raw = localStorage.getItem('bt_transactions')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(hydrateTransactionDates) : []
  } catch {
    return []
  }
}

/** Snapshot at click time — ref first (prop may already be cleared), then localStorage */
function snapshotSessionTransactions(transactionsRef) {
  const fromRef = (transactionsRef.current || []).map(hydrateTransactionDates)
  if (fromRef.length > 0) return fromRef
  const stored = readStoredSessionTransactions()
  if (stored.length > 0) {
    console.log('[close till] transactions ref/prop empty — using bt_transactions from localStorage, count:', stored.length)
  }
  return stored
}

function PastReportTransactions({ sessionDate, savedTransactionIds, visibleStaff, styles: s }) {
  const [loading, setLoading] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [fetchError, setFetchError] = useState(null)
  const savedIdsKey = (savedTransactionIds || []).join(',')

  useEffect(() => {
    if (!sessionDate) {
      setTransactions([])
      setFetchError(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setFetchError(null)
    const idSet = savedIdsKey ? new Set(savedIdsKey.split(',').map(Number)) : null

    fetchTransactionsBySessionDate(sessionDate)
      .then(txs => {
        if (!cancelled) {
          let list = txs
          if (idSet?.size) {
            list = txs.filter(tx => idSet.has(tx.id))
          }
          setTransactions(list)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setTransactions([])
          setFetchError(err)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [sessionDate, savedIdsKey])

  return (
    <div className={s.reportSection}>
      <h3>Transactions</h3>
      {loading && <div className={s.pastReportLoading}>Loading transactions…</div>}
      {!loading && fetchError && (
        <div className={s.pastReportNoTx}>No transaction detail available for this session.</div>
      )}
      {!loading && !fetchError && transactions.length === 0 && (
        <div className={s.pastReportNoTx}>No transaction detail available for this session.</div>
      )}
      {!loading && !fetchError && transactions.map(tx => {
        const time = new Date(tx.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        return (
          <div key={tx.id} className={`${s.txCard} ${tx.voided ? s.txVoided : ''}`}>
            <div className={s.txHead}>
              <span className={s.txTime}>{time}</span>
              <span className={s.txTotal}>{fmt(tx.total)}</span>
            </div>
            <div className={s.txMeta}>
              <span>{visibleStaff(tx.staff)} · </span>
              <span className={`${s.badge} ${tx.payment === 'cash' ? s.badgeCash : tx.payment === 'card' ? s.badgeCard : s.badgeAccount}`}>
                {tx.payment === 'cash' ? 'Cash' : tx.payment === 'card' ? 'Card' : 'Account'}
              </span>
              {tx.type === 'tab' && <span className={`${s.badge} ${s.badgeTab}`}>Tab: {tx.tabName}</span>}
              {tx.voided && <span className={`${s.badge} ${s.badgeVoid}`}>Voided</span>}
            </div>
            <div className={`${s.txDetail} ${tx.voided ? s.txDetailVoided : ''}`}>
              {tx.items.map(i => `${i.qty}× ${i.name}`).join(', ')}
              {tx.payment === 'cash' && typeof tx.changeGiven === 'number' && (
                <span className={s.txNote}> · Change: {fmt(tx.changeGiven)}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

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

export default function Sales({
  transactions, currentlyIn, setTransactions,
  clearSessionTransactions,
  voidTransaction, products,
  stockItems, stockDefinitions, productVariants, showToast,
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const reportOpenRef = useRef(false)
  const [stockReportOpen, setStockReportOpen] = useState(false)
  const [pastReportsOpen, setPastReportsOpen] = useState(false)
  const [savedPastReports, setSavedPastReports] = useState([])
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [expandedPastReportId, setExpandedPastReportId] = useState(null)
  const [float, setFloat] = useState(50)
  const [actualCashInTill, setActualCashInTill] = useState('')
  const [discrepancyReason, setDiscrepancyReason] = useState('')
  const [eodReports, setEodReports] = useLocalStorage('bt_eod_reports', [])
  const [closingTill, setClosingTill] = useState(false)
  const closeTillInFlightRef = useRef(false)
  const transactionsRef = useRef(transactions)
  // Keep ref in sync; while close-till runs, do not wipe ref when parent clears transactions state
  if (transactions.length > 0 || !closeTillInFlightRef.current) {
    transactionsRef.current = transactions
  }
  const inNames = new Set((currentlyIn || []).map(row => row.staffName))
  const visibleStaff = (name) => (name && inNames.has(name) ? name : 'Manager')

  const openEodReport = useCallback(() => {
    reportOpenRef.current = true
    setReportOpen(true)
  }, [])

  const closeEodReport = useCallback(() => {
    reportOpenRef.current = false
    setReportOpen(false)
  }, [])

  const openPastReportsOverlay = useCallback(() => {
    setSavedPastReports(readSavedEodReportsFromStorage())
    setPastReportsOpen(true)
    setExpandedPastReportId(null)
  }, [])

  // EOD overlay opens only via openEodReport — never when transactions change
  useEffect(() => {
    if (reportOpen && !reportOpenRef.current) {
      setReportOpen(false)
    }
  }, [transactions, reportOpen])

  const todaySessionDate = localSessionDateString()
  const sessionTransactions = useMemo(() => {
    return transactions.filter(t => (t.sessionDate ?? todaySessionDate) === todaySessionDate)
  }, [transactions, todaySessionDate])

  const live = sessionTransactions.filter(t => !t.voided)
  const totalTakings = live.reduce((s, t) => s + t.total, 0)
  const cashTotal = live.filter(t => t.payment === 'cash').reduce((s, t) => s + t.total, 0)
  const cardTotal = live.filter(t => t.payment === 'card').reduce((s, t) => s + t.total, 0)
  const accountTotal = live.filter(t => t.payment === 'account').reduce((s, t) => s + t.total, 0)
  const totalItems = live.reduce((s, t) => s + t.items.reduce((a, i) => a + i.qty, 0), 0)

  const popularity = {}
  live.forEach(t => t.items.forEach(i => { popularity[i.name] = (popularity[i.name] || 0) + i.qty }))
  const popSorted = Object.entries(popularity).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const staffMap = {}
  live.forEach(t => {
    const s = visibleStaff(t.staff)
    if (!staffMap[s]) staffMap[s] = { total: 0, count: 0 }
    staffMap[s].total += t.total
    staffMap[s].count++
  })

  const tabTx = live.filter(t => t.type === 'tab')
  const voidedTx = sessionTransactions.filter(t => t.voided)

  const stockItemById = useMemo(() => Object.fromEntries(stockDefinitions.map(s => [s.id, s])), [stockDefinitions])

  const stockReportData = useMemo(() => {
    const drinksByCat = buildDrinksSoldByCategory(products, live)
    const bottleDeductions = accumulateVariantBottleDeductions(products, live, productVariants, stockItemById)
    const remainingGroups = groupRemainingStockByCategory(stockDefinitions)
    return { drinksByCat, bottleDeductions, remainingGroups }
  }, [products, live, productVariants, stockDefinitions, stockItemById])

  const reportHeaderSubtitle = `${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · Generated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

  const expectedCashInTill = cashTotal + float
  const actualCashParsed = actualCashInTill.trim() === '' ? null : parseFloat(actualCashInTill)
  const liveDiscrepancy = actualCashParsed != null && !Number.isNaN(actualCashParsed)
    ? actualCashParsed - expectedCashInTill
    : null

  const liveReportData = useMemo(() => buildEodReportData({
    generatedAt: new Date().toISOString(),
    reportDate: localSessionDateString(),
    subtitle: reportHeaderSubtitle,
    float,
    actualCashInTill: actualCashParsed != null && !Number.isNaN(actualCashParsed) ? actualCashParsed : null,
    discrepancyAmount: liveDiscrepancy,
    discrepancyReason: discrepancyReason.trim(),
    expectedCashInTill,
    totalTakings,
    totalItems,
    cashTotal,
    cardTotal,
    accountTotal,
    liveTransactionCount: live.length,
    popSorted,
    staffMap,
    tabTx,
    voidedTx,
    transactions: sessionTransactions,
  }), [
    reportHeaderSubtitle, float, actualCashParsed, liveDiscrepancy, discrepancyReason,
    expectedCashInTill, totalTakings, totalItems, cashTotal, cardTotal, accountTotal,
    live.length, popSorted, staffMap, tabTx, voidedTx, sessionTransactions,
  ])

  const confirmCloseTill = useCallback(async () => {
    if (closeTillInFlightRef.current) return
    closeTillInFlightRef.current = true
    setClosingTill(true)

    const runCloseTillSequence = async () => {
      // Snapshot from ref before any await (prop/state may clear mid-flight)
      const txsToSave = snapshotSessionTransactions(transactionsRef)

      const snapFloat = float
      const snapActualCash = actualCashInTill
      const snapReason = discrepancyReason
      const snapEodReports = eodReports

      const snapLive = txsToSave.filter(t => !t.voided)
      const snapCash = snapLive.filter(t => t.payment === 'cash').reduce((s, t) => s + t.total, 0)
      const snapCard = snapLive.filter(t => t.payment === 'card').reduce((s, t) => s + t.total, 0)
      const snapAccount = snapLive.filter(t => t.payment === 'account').reduce((s, t) => s + t.total, 0)
      const snapTotalItems = snapLive.reduce((s, t) => s + t.items.reduce((a, i) => a + i.qty, 0), 0)
      const snapTotalTakings = snapLive.reduce((s, t) => s + t.total, 0)
      const snapPopularity = {}
      snapLive.forEach(t => t.items.forEach(i => { snapPopularity[i.name] = (snapPopularity[i.name] || 0) + i.qty }))
      const snapPopSorted = Object.entries(snapPopularity).sort((a, b) => b[1] - a[1]).slice(0, 6)
      const snapStaffMap = {}
      snapLive.forEach(t => {
        const s = visibleStaff(t.staff)
        if (!snapStaffMap[s]) snapStaffMap[s] = { total: 0, count: 0 }
        snapStaffMap[s].total += t.total
        snapStaffMap[s].count++
      })
      const snapTabTx = snapLive.filter(t => t.type === 'tab')
      const snapVoidedTx = txsToSave.filter(t => t.voided)
      const snapExpectedCash = snapCash + snapFloat
      const snapActualParsed = snapActualCash.trim() === '' ? null : parseFloat(snapActualCash)
      const snapDiscrepancy = snapActualParsed != null && !Number.isNaN(snapActualParsed)
        ? snapActualParsed - snapExpectedCash
        : null

      // Step 1: EOD report → localStorage
      const reportData = buildEodReportData({
        generatedAt: new Date().toISOString(),
        reportDate: localSessionDateString(),
        subtitle: reportHeaderSubtitle,
        float: snapFloat,
        actualCashInTill: snapActualParsed != null && !Number.isNaN(snapActualParsed) ? snapActualParsed : null,
        discrepancyAmount: snapDiscrepancy,
        discrepancyReason: snapReason.trim(),
        expectedCashInTill: snapExpectedCash,
        totalTakings: snapTotalTakings,
        totalItems: snapTotalItems,
        cashTotal: snapCash,
        cardTotal: snapCard,
        accountTotal: snapAccount,
        liveTransactionCount: snapLive.length,
        popSorted: snapPopSorted,
        staffMap: snapStaffMap,
        tabTx: snapTabTx,
        voidedTx: snapVoidedTx,
        transactions: txsToSave,
      })
      const session_date = localSessionDateString()
      const entry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        reportDate: session_date,
        session_date,
        totalTakings: snapTotalTakings,
        reportData,
      }
      const nextReports = persistEodReportEntry(snapEodReports, entry)
      setEodReports(nextReports)
      setSavedPastReports(nextReports)
      console.log('[close till] EOD report saved to localStorage, count:', nextReports.length)

      // Step 2: Clear session in App (after EOD persist)
      await clearSessionTransactions()
      transactionsRef.current = []

      // Steps 3–5: Close overlays and reset form (sequential, after clear)
      flushSync(() => closeEodReport())
      await Promise.resolve()
      flushSync(() => setCloseConfirmOpen(false))
      await Promise.resolve()
      flushSync(() => {
        setFloat(50)
        setActualCashInTill('')
        setDiscrepancyReason('')
        setExpandedPastReportId(null)
      })
      console.log('[close till] AFTER UI reset — reportOpen→false, closeConfirmOpen→false, float→50, actualCash→"", notes→""')

      showToast('Till closed. Report saved.')
    }

    try {
      await runCloseTillSequence()
    } catch (e) {
      console.warn('[close till] runCloseTillSequence failed:', e)
      try {
        await clearSessionTransactions()
        transactionsRef.current = []
      } catch (clearErr) {
        console.warn('[close till] clearSessionTransactions failed:', clearErr)
      }
      flushSync(() => closeEodReport())
      flushSync(() => setCloseConfirmOpen(false))
      flushSync(() => {
        setFloat(50)
        setActualCashInTill('')
        setDiscrepancyReason('')
        setExpandedPastReportId(null)
      })
      showToast('Till closed. Report saved locally.')
    } finally {
      closeTillInFlightRef.current = false
      setClosingTill(false)
    }
  }, [
    transactions, float, actualCashInTill, discrepancyReason,
    eodReports, reportHeaderSubtitle, visibleStaff,
    setEodReports, clearSessionTransactions, closeEodReport, showToast,
  ])

  const formatPastReportDate = (entry) => {
    const d = entry.reportDate || entry.reportData?.reportDate
    if (!d) return 'Unknown date'
    const parsed = new Date(`${d}T12:00:00`)
    return parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <button type="button" className={styles.reportBtn} onClick={openEodReport}>📊 End of night report</button>
        <button type="button" className={styles.pastReportsBtn} onClick={openPastReportsOverlay}>Past reports</button>
        <button type="button" className={styles.reportBtnSecondary} onClick={() => setStockReportOpen(true)}>📦 Stock report</button>
        {!sessionTransactions.length ? (
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

            {sessionTransactions.map(tx => {
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
                    {tx.notes && (
                      <span className={styles.txNote}> · Note: {tx.notes}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

      </div>

      {reportOpen && (
        <div className={styles.reportOverlay} onClick={closeEodReport}>
          <div className={styles.reportSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.reportHeader}>
              <h2>End of Night Report</h2>
              <p>{reportHeaderSubtitle}</p>
            </div>

            <EndOfNightReportBody
              report={liveReportData}
              interactive
              float={float}
              onFloatChange={setFloat}
              actualCashInput={actualCashInTill}
              onActualCashInputChange={setActualCashInTill}
              discrepancyReason={discrepancyReason}
              onDiscrepancyReasonChange={setDiscrepancyReason}
            />

            <button type="button" className={styles.printBtn} onClick={() => window.print()}>🖨 Print report</button>
            <button type="button" className={styles.closeTillBtn} onClick={() => setCloseConfirmOpen(true)}>Close till</button>
            <button type="button" className={styles.closeBtn} onClick={closeEodReport}>Close</button>
          </div>
        </div>
      )}


      {closeConfirmOpen && (
        <div className={styles.reportOverlay} onClick={() => setCloseConfirmOpen(false)}>
          <div className={styles.confirmSheet} onClick={e => e.stopPropagation()}>
            <h2 className={styles.confirmTitle}>Save &amp; close till?</h2>
            <p className={styles.confirmMessage}>This will save the end of night report and all sales data for this session.</p>
            <div className={styles.confirmBtns}>
              <button type="button" className={styles.confirmCancelBtn} onClick={() => setCloseConfirmOpen(false)}>Cancel</button>
              <button type="button" className={styles.confirmSaveBtn} onClick={confirmCloseTill} disabled={closingTill}>Save &amp; close</button>
            </div>
          </div>
        </div>
      )}

      {pastReportsOpen && (
        <div className={styles.reportOverlay} onClick={() => setPastReportsOpen(false)}>
          <div className={styles.reportSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.reportHeader}>
              <h2>Past reports</h2>
              <p>Last {savedPastReports.length} saved end of night reports</p>
            </div>
            {!savedPastReports.length ? (
              <div className={styles.empty}>No saved reports yet</div>
            ) : (
              savedPastReports.map(entry => (
                <div key={entry.id} className={styles.pastReportBlock}>
                  <button
                    type="button"
                    className={styles.pastReportHead}
                    onClick={() => setExpandedPastReportId(expandedPastReportId === entry.id ? null : entry.id)}
                  >
                    <span>{formatPastReportDate(entry)}</span>
                    <span>{fmt(entry.totalTakings ?? entry.reportData?.takings?.totalTakings ?? 0)}</span>
                  </button>
                  {expandedPastReportId === entry.id && (
                    <div className={styles.pastReportBody}>
                      <p className={styles.pastReportMeta}>{entry.reportData?.subtitle || ''}</p>
                      <EndOfNightReportBody report={entry.reportData} />
                      <PastReportTransactions
                        sessionDate={entry.session_date ?? entry.reportDate ?? entry.reportData?.session_date}
                        savedTransactionIds={(entry.reportData?.transactions ?? []).map(t => t.id)}
                        visibleStaff={visibleStaff}
                        styles={styles}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
            <button type="button" className={styles.closeBtn} onClick={() => setPastReportsOpen(false)}>Close</button>
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
