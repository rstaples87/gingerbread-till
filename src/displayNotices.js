import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import { enqueueSyncQueueItem, isLikelyNetworkFailure } from './syncQueue'
import { localSessionDateString } from './utils'

/**
 * A one-line notice on the kitchen or bar display ("MOVED from Table 4"), shown as a ticket with no dishes.
 * Sent like any order: it queues if the network is down. Returns true if sent or queued.
 */
export async function sendStationNotice({ station, tabName, text, staff }) {
  if (!supabase) return false
  const row = {
    id: crypto.randomUUID(),
    tab_name: tabName,
    items: [{ qty: 1, name: text, price: 0 }],
    total: 0,
    staff_name: staff || 'Unknown',
    status: 'pending',
    session_date: localSessionDateString(),
    station,
  }
  try {
    const { error } = await supabase.from('bar_orders').upsert(row, { onConflict: 'id' })
    logSupabaseWrite('bar_orders', 'upsert', error)
    if (error) throw error
    return true
  } catch (err) {
    if (isLikelyNetworkFailure(err)) {
      enqueueSyncQueueItem('bar_order', row)
      return true
    }
    console.warn('station notice failed:', err?.message || err)
    return false
  }
}

/** Which screens care about a tab's items: food -> kitchen, anything else -> bar. */
export function stationsFor(items) {
  const out = new Set()
  for (const i of items || []) out.add(i.group === 'food' ? 'kitchen' : 'bar')
  return [...out]
}
