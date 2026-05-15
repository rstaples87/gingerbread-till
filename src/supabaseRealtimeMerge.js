/** App product row (stock comes from till_stock map). */
export function normaliseProductRowLive(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    name: row.name,
    price: Number(row.price),
    category: row.category,
    stock: 0,
  }
}

export function normaliseTransactionRowLive(row) {
  if (!row) return null
  let items = row.items
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items)
    } catch {
      items = []
    }
  }
  if (!Array.isArray(items)) items = []
  return {
    id: Number(row.id),
    time: new Date(row.time),
    total: Number(row.total ?? 0),
    items,
    payment: row.payment ?? null,
    staff: row.staff_name ?? row.staff ?? null,
    type: row.type ?? null,
    tabName: row.tab_name ?? row.tabName ?? null,
    voided: Boolean(row.voided),
    voidedAt: row.voided_at ? new Date(row.voided_at) : undefined,
    tenderedAmount: row.tendered_amount != null ? Number(row.tendered_amount) : undefined,
    changeGiven: row.change_given != null ? Number(row.change_given) : undefined,
  }
}

export function normaliseTabRowLive(row) {
  if (!row) return null
  let items = row.items
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items)
    } catch {
      items = []
    }
  }
  if (!Array.isArray(items)) items = []
  const lim = row.tab_limit ?? row.limit
  return {
    id: String(row.id),
    name: row.name ?? '',
    items,
    openedAt: new Date(row.opened_at ?? row.openedAt ?? Date.now()),
    staff: row.staff ?? row.staff_name ?? undefined,
    limit: lim != null && lim !== '' ? Number(lim) : undefined,
  }
}

export function mergeProductsRealtime(prev, payload) {
  const eventType = payload.eventType ?? payload.event
  const newRow = payload.new
  const oldRow = payload.old
  const id = Number(newRow?.id ?? oldRow?.id)
  if (!Number.isFinite(id)) return prev

  if (eventType === 'DELETE') {
    return prev.filter((p) => p.id !== id)
  }

  const row = newRow
  if (!row) return prev
  const normalised = normaliseProductRowLive(row)
  if (!normalised) return prev

  const idx = prev.findIndex((p) => p.id === id)
  if (idx === -1) return [...prev, normalised].sort((a, b) => a.id - b.id)
  const next = [...prev]
  next[idx] = normalised
  return next.sort((a, b) => a.id - b.id)
}

export function mergeTillStockMapRealtime(prev, payload) {
  const eventType = payload.eventType ?? payload.event
  const newRow = payload.new
  const oldRow = payload.old
  const pid = Number(newRow?.product_id ?? oldRow?.product_id)
  if (!Number.isFinite(pid)) return prev

  if (eventType === 'DELETE') {
    const next = { ...prev }
    delete next[pid]
    return next
  }

  const qty = Number(newRow?.qty ?? newRow?.quantity ?? 0)
  return { ...prev, [pid]: qty }
}

function txTimeMs(tx) {
  const t = tx?.time
  if (!t) return 0
  const d = t instanceof Date ? t : new Date(t)
  const ms = d.getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function mergeTransactionsRealtime(prev, payload) {
  const eventType = payload.eventType || payload.event
  const newRow = payload.new
  const oldRow = payload.old
  const id = Number(newRow?.id ?? oldRow?.id)
  if (!Number.isFinite(id)) return prev

  if (eventType === 'DELETE') {
    return prev.filter((t) => t.id !== id)
  }

  const normalised = normaliseTransactionRowLive(newRow)
  if (!normalised) return prev

  const idx = prev.findIndex((t) => t.id === id)
  if (idx === -1) return [normalised, ...prev].sort((a, b) => txTimeMs(b) - txTimeMs(a))
  const next = [...prev]
  next[idx] = normalised
  return next.sort((a, b) => txTimeMs(b) - txTimeMs(a))
}

export function mergeTabsRealtime(prev, payload) {
  const eventType = payload.eventType ?? payload.event
  const newRow = payload.new
  const oldRow = payload.old
  const id = String(newRow?.id ?? oldRow?.id ?? '')
  if (!id) return prev

  if (eventType === 'DELETE') {
    return prev.filter((t) => t.id !== id)
  }

  const normalised = normaliseTabRowLive(newRow)
  if (!normalised) return prev

  const idx = prev.findIndex((t) => t.id === id)
  if (idx === -1) return [...prev, normalised]
  const next = [...prev]
  next[idx] = normalised
  return next
}
