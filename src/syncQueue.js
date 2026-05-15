import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'

export const SYNC_QUEUE_KEY = 'bt_sync_queue'

export function readSyncQueue() {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeSyncQueue(items) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items))
  } catch {}
}

export function enqueueSyncQueueItem(type, payload) {
  const queue = readSyncQueue()
  queue.push({ type, payload, timestamp: Date.now() })
  writeSyncQueue(queue)
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

export function maybeQueueSyncFailure(type, payload, err) {
  if (!isLikelyNetworkFailure(err)) {
    console.warn('Sync failed (not queued):', err?.message ?? err)
    return
  }
  enqueueSyncQueueItem(type, payload)
}

export async function flushSyncQueue() {
  if (!supabase) return
  const queue = readSyncQueue()
  if (!queue.length) return
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
        res = await supabase.from('till_stock').upsert(item.payload, { onConflict: 'product_id' })
        logSupabaseWrite('till_stock', 'upsert', res?.error)
      } else if (item.type === 'bar_order') {
        res = await supabase.from('bar_orders').insert(item.payload)
        logSupabaseWrite('bar_orders', 'insert', res?.error)
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
  writeSyncQueue(remaining)
}
