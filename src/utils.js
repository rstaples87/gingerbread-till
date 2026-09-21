export const fmt = n => '£' + Number(n).toFixed(2)

/** Trading day rolls over at 06:00 local, so a night running past midnight stays one session. */
export const SESSION_ROLLOVER_HOUR = 6

/**
 * Trading-day date YYYY-MM-DD (local time, 06:00 rollover). Single source of truth for
 * transactions, bar_orders and EOD reports' session_date, and for the queries that read them.
 */
export function localSessionDateString(now = new Date()) {
  const d = new Date(now.getTime() - SESSION_ROLLOVER_HOUR * 3600 * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Human-readable counted quantity for stock items with optional displayUnit
 * (used in Stock take + stock report). Sized packs use "qty x …", simple plurals use "qty …".
 */
export function formatStockItemQuantity(qty, item) {
  const du = item?.displayUnit
  if (du) {
    if (/\d/.test(du) || du.includes('-pack')) {
      return `${qty} x ${du}`
    }
    return `${qty} ${du}`
  }
  const u = item?.unit || 'unit'
  return `${qty} ${u}${qty === 1 ? '' : 's'}`
}

/** Mixer serves per till drink: doubles use two portions */
export function mixerServesPerDrink(productId) {
  return productId === 16 || productId === 17 ? 2 : 1
}

/** Fractional mixer bottles to deduct for line qty (uses stock item bottleYield) */
export function mixerBottleDeductionForLine(productId, lineQty, mixerBottleYield) {
  const y = mixerBottleYield
  if (!y || y <= 0) return lineQty
  return (mixerServesPerDrink(productId) / y) * lineQty
}

const getLineQty = (line) => (typeof line === 'number' ? line : (line?.qty || 0))
const getLineStockId = (line) => (typeof line === 'object' ? line?.selectedStockId : null)
const getLineMixerId = (line) => (typeof line === 'object' ? line?.selectedMixerId : null)
const getLineDisplayName = (line) => (typeof line === 'object' ? line?.displayName : null)

/** Panel/receipt label: variant display name when set, else product name */
export const orderLineLabel = (line, productName) => getLineDisplayName(line) || productName

/**
 * Order lines are keyed by product id. A line that carries dish options or a note gets its own key,
 * "<productId>~<signature>", so two steaks cooked differently stay separate lines.
 */
export const lineProductId = key => parseInt(String(key), 10)

const slug = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Same options + same note => same signature (identical lines merge). options: [{ group, choice }] */
export function lineSignature(options, note) {
  const opts = (options || []).map(o => slug(o.group) + ':' + slug(o.choice)).join('|')
  const n = slug(note)
  return [opts, n ? 'n:' + n : ''].filter(Boolean).join('|')
}

export function orderLineKey(productId, options, note) {
  const sig = lineSignature(options, note)
  return sig ? productId + '~' + sig : String(productId)
}

/** "Medium rare, Chips — “sauce on side”" for an order line or a sale line. */
export function lineDetailText(line) {
  if (!line || typeof line !== 'object') return ''
  const opts = (line.options || []).map(o => o.choice).join(', ')
  return [opts, line.note ? '“' + line.note + '”' : ''].filter(Boolean).join(' — ')
}

export const getOrderTotal = (order, products) =>
  Object.entries(order).reduce((sum, [id, line]) => {
    const p = products.find(x => x.id === lineProductId(id))
    const qty = getLineQty(line)
    return sum + (p ? p.price * qty : 0)
  }, 0)

/** VAT rate and food/drink group copied onto every sale line, so past reports never change if a product is edited later. */
export const DEFAULT_VAT_RATE = 20
export const lineTaxFields = (p) => ({
  vatRate: Number(p?.vatRate ?? DEFAULT_VAT_RATE),
  group: p?.group === 'food' ? 'food' : 'drink',
})

export const orderToItems = (order, products) =>
  Object.entries(order).map(([id, line]) => {
    const p = products.find(x => x.id === lineProductId(id))
    if (!p) return null
    return {
      productId: p.id,
      name: orderLineLabel(line, p.name),
      qty: getLineQty(line),
      price: p.price,
      selectedStockId: getLineStockId(line),
      selectedMixerId: getLineMixerId(line),
      displayName: getLineDisplayName(line) || undefined,
      ...(typeof line === 'object' && line?.options?.length ? { options: line.options } : {}),
      ...(typeof line === 'object' && line?.note ? { note: line.note } : {}),
      ...lineTaxFields(p),
    }
  }).filter(Boolean)

/**
 * Split order lines into display tickets: food lines -> 'kitchen', everything else -> 'bar'.
 * items: [{ name, qty, price, group, options?, note? }]; base: fields shared by every ticket.
 * kitchenOnly drops the bar ticket (e.g. drinks in a quick sale are served straight away).
 */
export function stationTickets(items, base, { kitchenOnly = false } = {}) {
  const make = (station, list) => (list.length ? {
    ...base,
    items: list.map(({ group: _group, ...rest }) => rest),
    total: Math.round(list.reduce((sum, i) => sum + i.price * i.qty, 0) * 100) / 100,
    station,
  } : null)
  return [
    make('kitchen', items.filter(i => i.group === 'food')),
    kitchenOnly ? null : make('bar', items.filter(i => i.group !== 'food')),
  ].filter(Boolean)
}

/** What staff and tickets call a tab: "Table 6 · Smith" when it has a customer name, else just "Table 6". */
export const tabLabel = (tab) => (tab?.customer ? `${tab.name} · ${tab.customer}` : String(tab?.name ?? ''))

/** "Table 6" for numbered tables, otherwise the table's own name (e.g. "Milling Room 1"). */
export const tableLabel = (table) => (/^\d+$/.test(String(table?.name)) ? `Table ${table.name}` : String(table?.name ?? ''))

/**
 * Merge the tab `src` into the tab `dst` (two parties joining). Same dishes with the same choices/notes add up;
 * covers are added; both customer names are kept; the earlier open time is kept. Returns the new dst tab.
 */
export function mergeTabData(dst, src) {
  const items = (dst.items || []).map(i => ({ ...i }))
  for (const it of src.items || []) {
    const ex = items.find(i =>
      (i.productId === it.productId || (!i.productId && !it.productId && i.name === it.name)) &&
      (i.selectedStockId ?? null) === (it.selectedStockId ?? null) &&
      (i.selectedMixerId ?? null) === (it.selectedMixerId ?? null) &&
      lineSignature(i.options, i.note) === lineSignature(it.options, it.note))
    if (ex) ex.qty += it.qty
    else items.push({ ...it })
  }
  const merged = { ...dst, items }
  if (dst.covers != null || src.covers != null) merged.covers = (dst.covers ?? 0) + (src.covers ?? 0)
  const names = [...new Set([dst.customer, src.customer].filter(Boolean))]
  if (names.length) merged.customer = names.join(' & ')
  else delete merged.customer
  const a = new Date(dst.openedAt).getTime()
  const b = new Date(src.openedAt).getTime()
  if (Number.isFinite(b) && (!Number.isFinite(a) || b < a)) merged.openedAt = src.openedAt
  return merged
}

/** Quantity for display: whole numbers as they are, part-shares (from an even split) to 2 decimals. */
export const fmtQty = (q) => {
  const n = Number(q) || 0
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6
const linesTotal = (lines) => round2(lines.reduce((s, i) => s + i.price * i.qty, 0))

/**
 * Split a bill by items: take `picks` ({ lineIndex: qtyTaken }) off `items`.
 * Returns { lines (what this person pays for), remaining (what is left on the table), amount }.
 */
export function takeItemsPart(items, picks) {
  const lines = []
  const remaining = []
  items.forEach((it, idx) => {
    const take = Math.min(Number(it.qty), Math.max(0, Number(picks?.[idx]) || 0))
    if (take > 1e-9) lines.push({ ...it, qty: round6(take) })
    const left = Number(it.qty) - take
    if (left > 1e-9) remaining.push({ ...it, qty: round6(left) })
  })
  return { lines, remaining, amount: linesTotal(lines) }
}

/**
 * Split a bill evenly: one of `people` equal shares comes off the bill. The share is rounded to the penny and
 * every line is scaled by the same fraction, so the sale's lines add up to exactly what was paid.
 * With one person left, they pay everything that remains.
 */
export function takeEvenShare(items, people) {
  const total = linesTotal(items)
  if (people <= 1 || total <= 0) {
    return { lines: items.map(i => ({ ...i })), remaining: [], amount: total }
  }
  const amount = round2(total / people)
  const s = amount / total
  const lines = items.map(i => ({ ...i, qty: round6(i.qty * s) })).filter(i => i.qty > 1e-9)
  const remaining = items.map(i => ({ ...i, qty: round6(i.qty * (1 - s)) })).filter(i => i.qty > 1e-9)
  return { lines, remaining, amount: linesTotal(lines) }
}

export const tabTotal = tab =>
  tab.items.reduce((s, i) => s + i.price * i.qty, 0)

export const itemsText = items =>
  items.map(i => {
    const detail = lineDetailText(i)
    return `${fmtQty(i.qty)}× ${i.name}${detail ? ' (' + detail + ')' : ''}`
  }).join('\n')

/** One-line text for a sale line, used in sales lists: "2× Sirloin (Medium rare, Chips — “sauce on side”)". */
export const saleLineText = i => {
  const detail = lineDetailText(i)
  return `${fmtQty(i.qty)}× ${i.name}${detail ? ' (' + detail + ')' : ''}`
}
