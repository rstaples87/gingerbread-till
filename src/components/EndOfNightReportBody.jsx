import { fmt } from '../utils'
import styles from './Sales.module.css'

function formatDiscrepancyDisplay(amount) {
  if (amount == null || Number.isNaN(amount)) {
    return { text: '—', className: '' }
  }
  if (amount === 0) {
    return { text: 'Balanced', className: styles.discrepancyBalanced }
  }
  if (amount < 0) {
    return { text: fmt(amount), className: styles.discrepancyNegative }
  }
  return { text: fmt(amount), className: styles.discrepancyPositive }
}

export default function EndOfNightReportBody({
  report,
  interactive = false,
  float,
  onFloatChange,
  actualCashInput = '',
  onActualCashInputChange,
  discrepancyReason = '',
  onDiscrepancyReasonChange,
}) {
  const t = report.takings
  const cash = report.cashReconciliation
  const expectedCash = cash.expectedCashInTill
  const actualParsed = interactive
    ? (actualCashInput.trim() === '' ? null : parseFloat(actualCashInput))
    : report.actualCashInTill
  const discrepancy = interactive
    ? (actualParsed != null && !Number.isNaN(actualParsed) ? actualParsed - expectedCash : null)
    : report.discrepancyAmount
  const discrepancyDisplay = formatDiscrepancyDisplay(discrepancy)
  const topSellers = report.topSellers || []
  const maxQty = topSellers[0]?.qty || 1
  const reasonText = interactive ? discrepancyReason : (report.discrepancyReason || '')

  return (
    <>
      <div className={styles.reportSection}>
        <h3>Cash float</h3>
        {interactive ? (
          <div className={styles.floatRow}>
            <span>Starting float</span>
            <input
              className={styles.floatInput}
              type="number"
              value={float}
              min={0}
              step={5}
              onChange={e => onFloatChange(parseFloat(e.target.value) || 0)}
            />
            <span>£</span>
          </div>
        ) : (
          <div className={styles.reportRow}><span>Starting float</span><span>{fmt(report.float)}</span></div>
        )}
      </div>

      <div className={styles.reportSection}>
        <h3>Takings summary</h3>
        {[
          ['Total transactions', t.transactionCount],
          ['Total items sold', t.totalItems],
          ['Cash sales', fmt(t.cashTotal)],
          ['Card sales', fmt(t.cardTotal)],
          ...(t.accountTotal > 0 ? [['On account', fmt(t.accountTotal)]] : []),
        ].map(([label, val]) => (
          <div key={label} className={styles.reportRow}><span>{label}</span><span>{val}</span></div>
        ))}
        <div className={`${styles.reportRow} ${styles.reportTotal}`}>
          <span>Total takings</span><span>{fmt(t.totalTakings)}</span>
        </div>
      </div>

      <div className={styles.reportSection}>
        <h3>Cash reconciliation</h3>
        <div className={styles.reportRow}><span>Cash sales</span><span>{fmt(cash.cashSales)}</span></div>
        <div className={styles.reportRow}><span>Starting float</span><span>{fmt(cash.startingFloat)}</span></div>
        <div className={`${styles.reportRow} ${styles.reportTotal} ${styles.reportHighlight}`}>
          <span>Expected cash in till</span><span>{fmt(expectedCash)}</span>
        </div>
        <div className={styles.reportRow}><span>Cash to bank (less float)</span><span>{fmt(cash.cashToBank)}</span></div>
      </div>

      <div className={styles.reportSection}>
        <h3>Discrepancy</h3>
        {interactive ? (
          <>
            <div className={styles.floatRow}>
              <span>Actual cash in till</span>
              <input
                className={styles.floatInput}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                placeholder="0.00"
                value={actualCashInput}
                onChange={e => onActualCashInputChange(e.target.value)}
              />
              <span>£</span>
            </div>
            <div className={styles.reportRow}>
              <span>Discrepancy</span>
              <span className={discrepancyDisplay.className}>{discrepancyDisplay.text}</span>
            </div>
            <div className={styles.floatRow}>
              <span>Reason / notes</span>
              <input
                className={styles.floatInput}
                type="text"
                maxLength={500}
                placeholder="Optional explanation"
                value={discrepancyReason}
                onChange={e => onDiscrepancyReasonChange(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className={styles.reportRow}>
              <span>Actual cash in till</span>
              <span>{report.actualCashInTill != null ? fmt(report.actualCashInTill) : '—'}</span>
            </div>
            <div className={styles.reportRow}>
              <span>Discrepancy</span>
              <span className={discrepancyDisplay.className}>{discrepancyDisplay.text}</span>
            </div>
            {reasonText ? (
              <div className={styles.reportRow}>
                <span>Reason / notes</span>
                <span style={{ textAlign: 'right', maxWidth: '60%' }}>{reasonText}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {topSellers.length > 0 && (
        <div className={styles.reportSection}>
          <h3>Top sellers</h3>
          {topSellers.map(({ name, qty }, i) => (
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

      {(report.staffBreakdown || []).length > 0 && (
        <div className={styles.reportSection}>
          <h3>By staff</h3>
          {report.staffBreakdown.map(({ name, total, count }) => (
            <div key={name} className={styles.reportRow}>
              <span>{name}</span>
              <span>{fmt(total)} ({count} sales)</span>
            </div>
          ))}
        </div>
      )}

      {(report.tabsSettled || []).length > 0 && (
        <div className={styles.reportSection}>
          <h3>Tabs settled</h3>
          {report.tabsSettled.map(t => (
            <div key={`${t.tabName}-${t.time}`} className={styles.reportRow}>
              <span>{t.tabName}</span>
              <span>{fmt(t.total)}</span>
            </div>
          ))}
        </div>
      )}

      {(report.voidedTransactions || []).length > 0 && (
        <div className={styles.reportSection}>
          <h3>Voided transactions</h3>
          {report.voidedTransactions.map(t => (
            <div key={t.id} className={`${styles.reportRow} ${styles.reportVoided}`}>
              <span>
                {new Date(t.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                {' — '}
                {t.items.map(i => `${i.qty}× ${i.name}`).join(', ')}
              </span>
              <span>{fmt(t.total)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
