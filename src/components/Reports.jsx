import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTransactionsForRange } from '../transactionSync'
import { buildSalesReport, itemsToCsv, round2, shiftDate } from '../reports'
import { fmt, localSessionDateString, formatStockItemQuantity } from '../utils'
import styles from './Reports.module.css'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
]

function rangeFor(preset, custom) {
  const today = localSessionDateString()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'yesterday') { const y = shiftDate(today, -1); return { from: y, to: y } }
  if (preset === 'week') return { from: shiftDate(today, -6), to: today }
  if (preset === 'month') return { from: shiftDate(today, -29), to: today }
  return { from: custom.from || today, to: custom.to || today }
}

const money = n => fmt(round2(n))

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return rows.map(r => (
    <div key={r.label} className={styles.barRow}>
      <span className={styles.barLabel}>{r.label}</span>
      <span className={styles.barTrack}><div className={styles.bar} style={{ width: `${(r.value / max) * 100}%` }} /></span>
      <span className={styles.barVal}>{money(r.value)}</span>
    </div>
  ))
}

export default function Reports({ stockDefinitions = [], stockItems = {}, products = [], stock = {} }) {
  const [preset, setPreset] = useState('today')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [timeView, setTimeView] = useState('hour')
  const [itemSort, setItemSort] = useState('gross')
  const [itemFilter, setItemFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { from, to } = rangeFor(preset, custom)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await fetchTransactionsForRange(from, to))
    } catch (err) {
      setRows(null)
      setError(navigator.onLine === false
        ? 'Reports need a connection. Try again when you have signal.'
        : 'Could not load sales. ' + (err?.message || ''))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  const report = useMemo(() => (rows ? buildSalesReport(rows) : null), [rows])

  const items = useMemo(() => {
    if (!report) return []
    const f = itemFilter.trim().toLowerCase()
    const list = f ? report.byItem.filter(i => i.name.toLowerCase().includes(f)) : report.byItem
    return [...list].sort((a, b) => (itemSort === 'qty' ? b.qty - a.qty : b.gross - a.gross))
  }, [report, itemFilter, itemSort])

  const downloadCsv = () => {
    const blob = new Blob([itemsToCsv(report.byItem)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sales-by-item_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const stockRows = useMemo(() => {
    const f = stockFilter.trim().toLowerCase()
    return [...stockDefinitions]
      .filter(d => !f || `${d.name} ${d.category}`.toLowerCase().includes(f))
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)))
  }, [stockDefinitions, stockFilter])

  const s = report?.summary

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.section}>
          <div className={styles.controls}>
            {PRESETS.map(p => (
              <button key={p.key} type="button" className={`${styles.chip} ${preset === p.key ? styles.chipOn : ''}`} onClick={() => setPreset(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className={styles.controls}>
              <input className={styles.date} type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
              <span>to</span>
              <input className={styles.date} type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
            </div>
          )}
          <div className={styles.foot}>
            Trading days {from}{to !== from ? ` to ${to}` : ''} (a day runs to 6am). Voided sales are left out. Prices include VAT.
            {' '}<button type="button" className={styles.chip} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>

        {error && <div className={`${styles.msg} ${styles.err}`}>{error}</div>}
        {loading && !report && <div className={styles.msg}>Loading sales…</div>}

        {report && (
          <>
            <div className={styles.section}>
              <div className={styles.h}>Sales totals</div>
              <div className={styles.grid}>
                <div className={styles.card}><div className={styles.label}>Total inc VAT</div><div className={styles.value}>{money(s.gross)}</div></div>
                <div className={styles.card}><div className={styles.label}>Total ex VAT</div><div className={styles.value}>{money(s.net)}</div></div>
                <div className={styles.card}><div className={styles.label}>VAT</div><div className={styles.value}>{money(s.vat)}</div></div>
                <div className={styles.card}>
                  <div className={styles.label}>Transactions</div>
                  <div className={styles.value}>{s.transactions}</div>
                  <div className={styles.sub}>{s.transactions ? `avg ${money(s.gross / s.transactions)}` : ''}</div>
                </div>
              </div>
              <div className={styles.foot}>
                {Object.entries(report.byPayment).map(([k, v]) => `${k}: ${money(v.gross)} (${v.count})`).join('  ·  ')}
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.h}>Food and drink</div>
              <table className={styles.table}>
                <thead><tr><th></th><th className={styles.num}>Inc VAT</th><th className={styles.num}>Ex VAT</th><th className={styles.num}>VAT</th><th className={styles.num}>Share</th></tr></thead>
                <tbody>
                  {['food', 'drink'].map(g => (
                    <tr key={g}>
                      <td>{g === 'food' ? 'Food' : 'Drink'}</td>
                      <td className={styles.num}>{money(report.byGroup[g].gross)}</td>
                      <td className={styles.num}>{money(report.byGroup[g].net)}</td>
                      <td className={styles.num}>{money(report.byGroup[g].vat)}</td>
                      <td className={styles.num}>{s.gross ? Math.round((report.byGroup[g].gross / s.gross) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.section}>
              <div className={styles.h}>Sales by time</div>
              <div className={styles.controls}>
                <button type="button" className={`${styles.chip} ${timeView === 'hour' ? styles.chipOn : ''}`} onClick={() => setTimeView('hour')}>By hour of day</button>
                <button type="button" className={`${styles.chip} ${timeView === 'day' ? styles.chipOn : ''}`} onClick={() => setTimeView('day')}>By day</button>
              </div>
              {timeView === 'hour'
                ? <Bars rows={report.byHour.map((h, i) => ({ label: `${String(i).padStart(2, '0')}:00`, value: h.gross })).filter(r => r.value > 0)} />
                : <Bars rows={report.byDay.map(d => ({ label: d.day.slice(5), value: d.gross }))} />}
              {!s.gross && <div className={styles.msg}>No sales in this period.</div>}
            </div>

            <div className={styles.section}>
              <div className={styles.h}>Sales by item</div>
              <input className={styles.search} placeholder="Search items" value={itemFilter} onChange={e => setItemFilter(e.target.value)} />
              <div className={styles.controls}>
                <button type="button" className={`${styles.chip} ${itemSort === 'gross' ? styles.chipOn : ''}`} onClick={() => setItemSort('gross')}>By sales</button>
                <button type="button" className={`${styles.chip} ${itemSort === 'qty' ? styles.chipOn : ''}`} onClick={() => setItemSort('qty')}>By quantity</button>
                <button type="button" className={styles.btn} onClick={downloadCsv} disabled={!report.byItem.length}>Download CSV</button>
              </div>
              <table className={styles.table}>
                <thead><tr><th>Item</th><th className={styles.num}>Qty</th><th className={styles.num}>Inc VAT</th><th className={styles.num}>Ex VAT</th></tr></thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.name}>
                      <td>{i.name} <span className={styles.sub}>{i.group === 'food' ? 'food' : ''}</span></td>
                      <td className={styles.num}>{i.qty}</td>
                      <td className={styles.num}>{money(i.gross)}</td>
                      <td className={styles.num}>{money(i.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.length && <div className={styles.msg}>No items.</div>}
            </div>
          </>
        )}

        <div className={styles.section}>
          <div className={styles.h}>Stock levels (drinks)</div>
          <input className={styles.search} placeholder="Search stock" value={stockFilter} onChange={e => setStockFilter(e.target.value)} />
          <table className={styles.table}>
            <thead><tr><th>Item</th><th>Category</th><th className={styles.num}>In stock</th></tr></thead>
            <tbody>
              {stockRows.map(d => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.category}</td>
                  <td className={styles.num}>{formatStockItemQuantity(Math.round((Number(stockItems[d.id]) || 0) * 100) / 100, d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.foot}>Till products (counted in the till): {products.filter(p => Number(stock[p.id]) > 0).length} of {products.length} in stock.</div>
        </div>
      </div>
    </div>
  )
}
