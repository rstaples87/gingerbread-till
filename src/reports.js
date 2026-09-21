// Pure report calculations (no Supabase / React) so they can be tested on their own.
//
// Prices are VAT-inclusive. For each sale line: net = gross / (1 + rate/100), VAT = gross - net.
// VAT rate and food/drink group come from the sale line (copied at time of sale); lines from before
// that was recorded default to 20% and drink. Voided sales are left out.

const DEFAULT_RATE = 20

function lineFacts(item) {
  const qty = Number(item?.qty) || 0
  const gross = (Number(item?.price) || 0) * qty
  const rate = Number.isFinite(Number(item?.vatRate)) && item?.vatRate !== null && item?.vatRate !== undefined
    ? Number(item.vatRate)
    : DEFAULT_RATE
  const net = gross / (1 + rate / 100)
  return { qty, gross, net, vat: gross - net, group: item?.group === 'food' ? 'food' : 'drink' }
}

const blank = () => ({ gross: 0, net: 0, vat: 0, qty: 0 })
const add = (t, f) => { t.gross += f.gross; t.net += f.net; t.vat += f.vat; t.qty += f.qty }

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100

function pad2(n) { return String(n).padStart(2, '0') }
export function dayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

/** @param {Array} transactions each { time, total, items[], payment, voided, type } */
export function buildSalesReport(transactions) {
  const summary = { ...blank(), transactions: 0 }
  const byGroup = { food: blank(), drink: blank() }
  const byPayment = {}
  const byItem = new Map()
  const byHour = Array.from({ length: 24 }, () => blank())
  const byDay = new Map()

  for (const tx of transactions || []) {
    if (!tx || tx.voided) continue
    const time = tx.time instanceof Date ? tx.time : new Date(tx.time)
    if (Number.isNaN(time.getTime())) continue
    const items = Array.isArray(tx.items) ? tx.items : []
    summary.transactions += 1
    const pay = tx.payment || 'other'
    byPayment[pay] = byPayment[pay] || { gross: 0, count: 0 }
    byPayment[pay].count += 1

    for (const item of items) {
      const f = lineFacts(item)
      add(summary, f)
      add(byGroup[f.group], f)
      byPayment[pay].gross += f.gross
      add(byHour[time.getHours()], f)
      const dk = dayKey(time)
      if (!byDay.has(dk)) byDay.set(dk, blank())
      add(byDay.get(dk), f)
      const name = item?.name || 'Unknown item'
      if (!byItem.has(name)) byItem.set(name, { name, group: f.group, ...blank() })
      const row = byItem.get(name)
      add(row, f)
      if (f.group === 'food') row.group = 'food'
    }
  }

  return {
    summary,
    byGroup,
    byPayment,
    byItem: Array.from(byItem.values()).sort((a, b) => b.gross - a.gross),
    byHour,
    byDay: Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
  }
}

/** CSV text for the sales-by-item table (gross/net/VAT to 2dp). */
export function itemsToCsv(rows) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`
  const lines = [['Item', 'Group', 'Quantity', 'Sales inc VAT', 'Sales ex VAT', 'VAT'].join(',')]
  for (const r of rows) {
    lines.push([esc(r.name), r.group, r.qty, round2(r.gross).toFixed(2), round2(r.net).toFixed(2), round2(r.vat).toFixed(2)].join(','))
  }
  return lines.join('\n')
}

/** YYYY-MM-DD shifted by n days (pure string maths, no timezone drift). */
export function shiftDate(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}
