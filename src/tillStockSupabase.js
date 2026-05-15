import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'

/** 'qty' | 'quantity' | null (try qty first, then quantity on first failure) */
let tillStockQtyColumn = null

function normaliseQtyFromRow(row) {
  if (row?.qty !== undefined && row?.qty !== null) return Number(row.qty)
  if (row?.quantity !== undefined && row?.quantity !== null) return Number(row.quantity)
  return 0
}

function upsertPayload(productId, qtyVal, useQuantity) {
  const pid = Number(productId)
  const q = Math.max(0, Number(qtyVal) || 0)
  return useQuantity
    ? { product_id: pid, quantity: q }
    : { product_id: pid, qty: q }
}

function queuePayload(productId, qtyVal) {
  const pid = Number(productId)
  const q = Math.max(0, Number(qtyVal) || 0)
  return { product_id: pid, qty: q }
}

/**
 * Upsert till_stock. Queue always uses { product_id, qty }; DB may use `quantity` column.
 * @param {(row: object, err: unknown) => void} [onQueueableFailure] — e.g. maybeQueueSyncFailure('till_stock', row, err)
 */
export function upsertTillStockRowToSupabase(productId, qty, onQueueableFailure) {
  if (!supabase) return
  const pid = Number(productId)
  if (!Number.isFinite(pid)) return
  const rowForQueue = queuePayload(pid, qty)

  const finish = (error, rowSent) => {
    logSupabaseWrite('till_stock', 'upsert', error)
    if (error && onQueueableFailure) onQueueableFailure(rowForQueue, error)
  }

  const run = (useQuantity) =>
    supabase
      .from('till_stock')
      .upsert(upsertPayload(pid, qty, useQuantity), { onConflict: 'product_id' })

  if (tillStockQtyColumn === 'quantity') {
    run(true)
      .then(({ error }) => finish(error, upsertPayload(pid, qty, true)))
      .catch(err => finish(err, upsertPayload(pid, qty, true)))
    return
  }
  if (tillStockQtyColumn === 'qty') {
    run(false)
      .then(({ error }) => finish(error, upsertPayload(pid, qty, false)))
      .catch(err => finish(err, upsertPayload(pid, qty, false)))
    return
  }

  run(false)
    .then(({ error }) => {
      if (!error) {
        tillStockQtyColumn = 'qty'
        finish(null, upsertPayload(pid, qty, false))
        return
      }
      run(true)
        .then(({ error: err2 }) => {
          if (!err2) tillStockQtyColumn = 'quantity'
          else tillStockQtyColumn = 'qty'
          finish(err2, upsertPayload(pid, qty, tillStockQtyColumn === 'quantity'))
        })
        .catch(err => finish(err, upsertPayload(pid, qty, true)))
    })
    .catch(err => finish(err, upsertPayload(pid, qty, false)))
}

export async function loadTillStockFromSupabase(setStockRaw, options = {}) {
  if (!supabase) return 0
  const retryDelaysMs = options.retryOnEmpty ? [0, 120, 300] : [0]
  let lastData = null
  try {
    for (let i = 0; i < retryDelaysMs.length; i++) {
      const wait = retryDelaysMs[i]
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      const { data, error } = await supabase.from('till_stock').select('*')
      if (error) throw error
      lastData = data
      if (data?.length) break
    }
    const rows = lastData ?? []
    const next = {}
    for (const row of rows) {
      if (row?.product_id == null) continue
      next[Number(row.product_id)] = normaliseQtyFromRow(row)
    }
    if (rows.length && tillStockQtyColumn === null) {
      const r = rows[0]
      if (r && Object.prototype.hasOwnProperty.call(r, 'quantity') && !Object.prototype.hasOwnProperty.call(r, 'qty')) {
        tillStockQtyColumn = 'quantity'
      } else {
        tillStockQtyColumn = 'qty'
      }
    }
    setStockRaw(next)
    return rows.length
  } catch (err) {
    console.warn('loadTillStockFromSupabase failed:', err?.message || err)
    return 0
  }
}

/** Offline queue flush: payload is always { product_id, qty }. */
export async function upsertTillStockFromQueuePayload(payload) {
  if (!supabase || !payload) return { error: new Error('no supabase') }
  const pid = Number(payload.product_id)
  const q = Math.max(0, Number(payload.qty) || 0)
  if (!Number.isFinite(pid)) return { error: new Error('invalid product_id') }

  const run = (useQuantity) =>
    supabase
      .from('till_stock')
      .upsert(upsertPayload(pid, q, useQuantity), { onConflict: 'product_id' })

  try {
    if (tillStockQtyColumn === 'quantity') return await run(true)
    if (tillStockQtyColumn === 'qty') return await run(false)

    const r1 = await run(false)
    if (!r1.error) {
      tillStockQtyColumn = 'qty'
      return r1
    }
    const r2 = await run(true)
    if (!r2.error) tillStockQtyColumn = 'quantity'
    else tillStockQtyColumn = 'qty'
    return r2
  } catch (err) {
    return { error: err }
  }
}

export function syncTillStockToSupabase(map, onQueueableFailure) {
  if (!supabase || !map) return
  for (const [product_id, qty] of Object.entries(map)) {
    upsertTillStockRowToSupabase(product_id, qty, onQueueableFailure)
  }
}
