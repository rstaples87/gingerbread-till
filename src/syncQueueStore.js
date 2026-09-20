// Offline sync queue storage (no Supabase imports, so any module can read it without import cycles).
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

/** Sum of queued stock deltas per key, e.g. readPendingDeltaMap('till_stock_delta', 'product_id'). */
export function readPendingDeltaMap(type, keyField) {
  const out = {}
  for (const item of readSyncQueue()) {
    if (item?.type !== type || !item.payload) continue
    const key = item.payload[keyField]
    out[key] = (out[key] ?? 0) + Number(item.payload.delta || 0)
  }
  return out
}
