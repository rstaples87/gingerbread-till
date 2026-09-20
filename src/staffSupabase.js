import { supabase } from './supabase'
import { readSyncQueue } from './syncQueueStore'

export const STAFF_OP_TYPES = new Set(['staff_add', 'staff_pin', 'staff_remove'])

function isNetworkError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')
}

/**
 * Apply one staff write (also used to replay queued writes). Resolves { error }, never throws.
 *  staff_add    { id, name, pin, role, active }  — upsert by id, so a replay can't duplicate the person
 *  staff_pin    { id?, name, pin }
 *  staff_remove { id?, name }
 */
export async function applyStaffOp(type, payload) {
  if (!supabase) return { error: new Error('no supabase') }
  try {
    if (type === 'staff_add') {
      let res = await supabase.from('staff').upsert(payload, { onConflict: 'id' })
      if (res.error && !isNetworkError(res.error)) {
        // Older databases may not have the `active` column.
        const { active: _a, ...rest } = payload
        res = await supabase.from('staff').upsert(rest, { onConflict: 'id' })
      }
      return { error: res.error ?? null }
    }
    if (type === 'staff_pin') {
      const q = supabase.from('staff').update({ pin: payload.pin })
      const res = payload.id ? await q.eq('id', payload.id) : await q.eq('name', payload.name)
      return { error: res.error ?? null }
    }
    if (type === 'staff_remove') {
      const q = supabase.from('staff').delete()
      const res = payload.id ? await q.eq('id', payload.id) : await q.eq('name', payload.name)
      return { error: res.error ?? null }
    }
    return { error: new Error('unknown staff op ' + type) }
  } catch (err) {
    return { error: err }
  }
}

/** Layer still-queued staff changes on top of the staff list fetched from the server. */
export function withPendingStaffOps(rows) {
  let out = [...rows]
  for (const item of readSyncQueue()) {
    const p = item?.payload
    if (!p || !STAFF_OP_TYPES.has(item.type)) continue
    const same = s => (p.id ? s.id === p.id : s.name === p.name)
    if (item.type === 'staff_add') {
      if (!out.some(s => s.id === p.id)) {
        out.push({ id: p.id, name: p.name, pin: String(p.pin ?? '0000'), role: p.role ?? 'staff', active: p.active !== false })
      }
    } else if (item.type === 'staff_pin') {
      out = out.map(s => (same(s) ? { ...s, pin: p.pin } : s))
    } else if (item.type === 'staff_remove') {
      out = out.filter(s => !same(s))
    }
  }
  return out
}
