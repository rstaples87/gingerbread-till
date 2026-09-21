import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import {
  upsertTillStockFromQueuePayload,
  applyTillStockDelta,
  applyStockItemDelta,
} from './tillStockSupabase'
import { MENU_OP_TYPES, applyMenuOp } from './menuSupabase'
import { STAFF_OP_TYPES, applyStaffOp } from './staffSupabase'
import {
  SYNC_QUEUE_KEY,
  readSyncQueue,
  writeSyncQueue,
  enqueueSyncQueueItem,
  readPendingDeltaMap,
} from './syncQueueStore'

export { SYNC_QUEUE_KEY, readSyncQueue, writeSyncQueue, enqueueSyncQueueItem, readPendingDeltaMap }

/** eod_reports rows still waiting to upload (so the UI can keep showing them). */
export function readPendingEodReportRows() {
  return readSyncQueue().filter(i => i?.type === 'eod_report' && i.payload).map(i => i.payload)
}

/** "Save shift log" day ranges still waiting to be applied on the server. */
export function readPendingAttendanceSaveRanges() {
  return readSyncQueue().filter(i => i?.type === 'attendance_save' && i.payload).map(i => i.payload)
}

/** attendance_log rows still waiting to upload. */
export function readPendingAttendanceRows() {
  return readSyncQueue().filter(i => i?.type === 'attendance' && i.payload).map(i => i.payload)
}

export function isLikelyNetworkFailure(err) {
  if (!err) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String(err.message ?? err).toLowerCase()
  if (msg.includes('failed to fetch')) return true
  if (msg.includes('network')) return true
  if (msg.includes('load failed')) return true
  if (msg.includes('aborted')) return true
  const name = err.name
  if (name === 'TypeError' && msg.includes('fetch')) return true
  return false
}

/** Expired/invalid login token: the write should wait and retry after the token refreshes, not be dropped. */
export function isAuthTokenFailure(err) {
  if (!err) return false
  const msg = String(err.message ?? err).toLowerCase()
  return (
    err.code === 'PGRST301' ||
    err.code === '42501' ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('row-level security')
  )
}

export function maybeQueueSyncFailure(type, payload, err) {
  if (!isLikelyNetworkFailure(err) && !isAuthTokenFailure(err)) {
    console.warn('Sync failed (not queued):', err?.message ?? err)
    return
  }
  enqueueSyncQueueItem(type, payload)
}

let flushInFlight = false

export async function flushSyncQueue() {
  if (!supabase || flushInFlight) return
  const queue = readSyncQueue()
  if (!queue.length) return
  flushInFlight = true
  try {
    // Renew the login token first if it expired while offline (harmless if it can't yet).
    try { await supabase.auth.getSession() } catch {}
    await flushItems(queue)
  } finally {
    flushInFlight = false
  }
}

async function flushItems(queue) {
  const remaining = []
  for (const item of queue) {
    try {
      let res
      if (item.type === 'transaction') {
        res = await supabase.from('transactions').upsert(item.payload, { onConflict: 'id' })
        logSupabaseWrite('transactions', 'upsert', res?.error)
      } else if (item.type === 'stock') {
        res = await supabase.from('stock_items').upsert(item.payload, { onConflict: 'stock_key' })
        logSupabaseWrite('stock_items', 'upsert', res?.error)
      } else if (item.type === 'till_stock') {
        res = await upsertTillStockFromQueuePayload(item.payload)
        logSupabaseWrite('till_stock', 'upsert', res?.error)
      } else if (item.type === 'bar_order') {
        res = await supabase.from('bar_orders').upsert(item.payload, { onConflict: 'id' })
        if (res?.error && item.payload.notes != null && !isLikelyNetworkFailure(res.error)) {
          const { notes: _n, ...rest } = item.payload
          res = await supabase.from('bar_orders').upsert(rest, { onConflict: 'id' })
        }
        logSupabaseWrite('bar_orders', 'upsert', res?.error)
      } else if (item.type === 'till_stock_delta') {
        res = await applyTillStockDelta(item.payload)
        logSupabaseWrite('till_stock', 'adjust', res?.error)
      } else if (item.type === 'stock_delta') {
        res = await applyStockItemDelta(item.payload)
        logSupabaseWrite('stock_items', 'adjust', res?.error)
      } else if (MENU_OP_TYPES.has(item.type)) {
        res = await applyMenuOp(item.type, item.payload)
        logSupabaseWrite(item.type, 'write', res?.error)
      } else if (STAFF_OP_TYPES.has(item.type)) {
        res = await applyStaffOp(item.type, item.payload)
        logSupabaseWrite('staff', item.type, res?.error)
      } else if (item.type === 'attendance_save') {
        res = await supabase
          .from('attendance_log')
          .update({ saved: true })
          .gte('time', item.payload.start)
          .lt('time', item.payload.end)
        logSupabaseWrite('attendance_log', 'update', res?.error)
      } else if (item.type === 'attendance') {
        res = await supabase.from('attendance_log').upsert(item.payload, { onConflict: 'id' })
        logSupabaseWrite('attendance_log', 'upsert', res?.error)
      } else if (item.type === 'eod_report') {
        res = await supabase.from('eod_reports').upsert(item.payload, { onConflict: 'id' })
        logSupabaseWrite('eod_reports', 'upsert', res?.error)
      } else if (item.type === 'tabs') {
        res = await supabase.from('tabs').upsert(item.payload, { onConflict: 'id' })
        logSupabaseWrite('tabs', 'upsert', res?.error)
      } else if (item.type === 'tabs_delete') {
        res = await supabase.from('tabs').delete().eq('id', item.payload.id)
        logSupabaseWrite('tabs', 'delete', res?.error)
      } else {
        remaining.push(item)
        continue
      }
      if (res?.error) remaining.push(item)
    } catch {
      remaining.push(item)
    }
  }
  // Keep anything queued while this flush was running (appended after `queue` was read).
  const addedDuringFlush = readSyncQueue().slice(queue.length)
  writeSyncQueue([...remaining, ...addedDuringFlush])
}
