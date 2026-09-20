import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import { readPendingDeltaMap } from './syncQueueStore'

function isMissingRpcError(err) {
  const msg = String(err?.message ?? '').toLowerCase()
  return err?.code === 'PGRST202' || err?.code === '42883' || msg.includes('could not find the function')
}

/**
 * Apply a +/- stock delta atomically via an RPC (payload carries op_id so replays apply once).
 * If the RPC hasn't been created in the database yet, falls back to read-modify-write.
 */
async function applyDelta(rpcName, rpcArgs, table, keyCol, keyVal, delta) {
  if (!supabase) return { error: new Error('no supabase') }
  try {
    const res = await supabase.rpc(rpcName, rpcArgs)
    if (!isMissingRpcError(res.error)) return { error: res.error ?? null }
    const { data, error } = await supabase.from(table).select('qty').eq(keyCol, keyVal).maybeSingle()
    if (error) return { error }
    const next = Math.max(0, Number(data?.qty ?? 0) + delta)
    const up = await supabase.from(table).upsert({ [keyCol]: keyVal, qty: next }, { onConflict: keyCol })
    return { error: up.error ?? null }
  } catch (err) {
    return { error: err }
  }
}

/** payload: { product_id, delta, op_id } */
export function applyTillStockDelta(payload) {
  const pid = Number(payload?.product_id)
  const delta = Number(payload?.delta)
  if (!Number.isFinite(pid) || !Number.isFinite(delta)) return Promise.resolve({ error: new Error('invalid payload') })
  return applyDelta(
    'adjust_till_stock',
    { p_product_id: pid, p_delta: delta, p_op_id: payload.op_id },
    'till_stock', 'product_id', pid, delta,
  )
}

/** payload: { stock_key, delta, op_id } */
export function applyStockItemDelta(payload) {
  const key = payload?.stock_key
  const delta = Number(payload?.delta)
  if (!key || !Number.isFinite(delta)) return Promise.resolve({ error: new Error('invalid payload') })
  return applyDelta(
    'adjust_stock_item',
    { p_stock_key: key, p_delta: delta, p_op_id: payload.op_id },
    'stock_items', 'stock_key', key, delta,
  )
}

/** Add still-queued (unsynced) deltas on top of server values so a refetch doesn't hide them. */
export function withPendingDeltas(map, type, keyField) {
  const pending = readPendingDeltaMap(type, keyField)
  const out = { ...map }
  for (const [k, d] of Object.entries(pending)) {
    out[k] = Math.max(0, Number(out[k] ?? 0) + d)
  }
  return out
}

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
  const { fallback, retryOnEmpty } = options
  if (!supabase) {
    if (fallback != null) setStockRaw(fallback)
    return 0
  }
  const retryDelaysMs = retryOnEmpty ? [0, 120, 300] : [0]
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
    if (!rows.length) {
      if (fallback != null) setStockRaw(fallback)
      return 0
    }
    const next = {}
    for (const row of rows) {
      if (row?.product_id == null) continue
      next[Number(row.product_id)] = normaliseQtyFromRow(row)
    }
    if (tillStockQtyColumn === null) {
      const r = rows[0]
      if (r && Object.prototype.hasOwnProperty.call(r, 'quantity') && !Object.prototype.hasOwnProperty.call(r, 'qty')) {
        tillStockQtyColumn = 'quantity'
      } else {
        tillStockQtyColumn = 'qty'
      }
    }
    setStockRaw(withPendingDeltas(next, 'till_stock_delta', 'product_id'))
    return rows.length
  } catch (err) {
    console.warn('loadTillStockFromSupabase failed:', err?.message || err)
    if (fallback != null) setStockRaw(fallback)
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
