function sessionDateKey(row) {
  const d = row?.session_date
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0]
  return String(d)
}

function barOrderRowInView(row, sessionDate) {
  if (!row?.id) return false
  if (sessionDateKey(row) !== sessionDate) return false
  if (row.archived === true) return false
  return true
}

function sentAtMs(row) {
  const t = row?.sent_at
  if (!t) return 0
  const ms = new Date(t).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function sortBySentAtDesc(list) {
  return [...list].sort((a, b) => sentAtMs(b) - sentAtMs(a))
}

/**
 * Merge a Supabase Realtime postgres_changes payload into bar_orders list for today’s view.
 */
export function mergeBarOrdersRealtime(prev, payload, sessionDate) {
  const eventType = payload.eventType || payload.event
  const newRow = payload.new
  const oldRow = payload.old

  if (eventType === 'INSERT') {
    if (!newRow || !barOrderRowInView(newRow, sessionDate)) return prev
    if (prev.some((r) => r.id === newRow.id)) {
      return prev.map((r) => (r.id === newRow.id ? newRow : r))
    }
    return sortBySentAtDesc([...prev, newRow])
  }

  if (eventType === 'UPDATE') {
    const id = newRow?.id ?? oldRow?.id
    if (!id) return prev
    if (!newRow || !barOrderRowInView(newRow, sessionDate)) {
      return prev.filter((r) => r.id !== id)
    }
    const idx = prev.findIndex((r) => r.id === id)
    if (idx === -1) return sortBySentAtDesc([...prev, newRow])
    const next = [...prev]
    next[idx] = newRow
    return sortBySentAtDesc(next)
  }

  if (eventType === 'DELETE') {
    const id = oldRow?.id
    if (!id) return prev
    return prev.filter((r) => r.id !== id)
  }

  return prev
}
