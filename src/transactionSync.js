import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import { maybeQueueSyncFailure } from './syncQueue'
import { normaliseTransactionRowLive } from './supabaseRealtimeMerge'

/** Row shape for transactions table — only columns known to exist (upsert + close-till insert). */
export function transactionRowForSupabase(tx) {
  const time =
    tx.time instanceof Date ? tx.time.toISOString()
      : tx.time ?? null

  const voided_at = tx.voidedAt
    ? (tx.voidedAt instanceof Date ? tx.voidedAt.toISOString() : tx.voidedAt)
    : null

  const session_date =
    tx.sessionDate ?? tx.session_date ?? new Date().toISOString().split('T')[0]

  const row = {
    id: tx.id,
    time,
    session_date,
    total: tx.total,
    items: tx.items ?? [],
    payment: tx.payment ?? null,
    staff_name: tx.staff ?? tx.staff_name ?? null,
    type: tx.type ?? null,
    voided: Boolean(tx.voided),
    voided_at,
  }

  const tabName = tx.tabName ?? tx.tab_name
  if (tabName != null && tabName !== '') {
    row.tab_name = tabName
  }

  return row
}

/** Upsert without blocking the till UI. */
export function syncTransactionToSupabaseFireAndForget(tx) {
  void syncTransactionToSupabase(tx).catch(err => {
    console.warn('[transaction sync]', err?.message || err)
  })
}

/** Upsert one transaction — same path as a normal charge / tab settle. */
export async function syncTransactionToSupabase(tx) {
  const row = transactionRowForSupabase(tx)

  if (!supabase) {
    const err = new Error('Supabase not configured')
    maybeQueueSyncFailure('transaction', row, err)
    return { error: err }
  }

  try {
    const { error } = await supabase
      .from('transactions')
      .upsert(row, { onConflict: 'id' })

    logSupabaseWrite('transactions', 'upsert', error)
    if (error) {
      maybeQueueSyncFailure('transaction', row, error)
      return { error }
    }
    return { error: null }
  } catch (err) {
    logSupabaseWrite('transactions', 'upsert', err)
    maybeQueueSyncFailure('transaction', row, err)
    return { error: err }
  }
}

/** UTC calendar date YYYY-MM-DD — must match session_date written on insert. */
export function todaySessionDateForSupabase() {
  return new Date().toISOString().split('T')[0]
}

/** Today's session transactions for the Sales view. */
export async function fetchTodayTransactionsFromSupabase() {
  const sessionDate = todaySessionDateForSupabase()
  if (!supabase) {
    console.log('[transactions] session_date:', sessionDate, 'rows:', 0, '(no supabase)')
    return []
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('session_date', sessionDate)
    .order('time', { ascending: false })

  if (error) {
    console.warn('fetchTodayTransactionsFromSupabase:', error)
    throw error
  }

  const rows = (data ?? []).map(row => normaliseTransactionRowLive(row)).filter(Boolean)
  console.log('[transactions] session_date:', sessionDate, 'rows:', rows.length)
  return rows
}

/** Load all transactions for a session date (past EOD reports). */
export async function fetchTransactionsBySessionDate(sessionDate) {
  if (!supabase || !sessionDate) return []

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('session_date', sessionDate)
    .order('time', { ascending: false })

  if (error) {
    console.warn('fetchTransactionsBySessionDate:', error)
    throw error
  }

  return (data ?? []).map(row => normaliseTransactionRowLive(row)).filter(Boolean)
}

/** Prefer voided state and newest time when the same id appears twice. */
export function dedupeTransactionsById(transactions) {
  const byId = new Map()
  for (const tx of transactions || []) {
    if (tx?.id == null) continue
    const cur = byId.get(tx.id)
    if (!cur) {
      byId.set(tx.id, tx)
      continue
    }
    const pick =
      (tx.voided && !cur.voided)
        ? tx
        : (!tx.voided && cur.voided)
          ? cur
          : new Date(tx.time) >= new Date(cur.time)
            ? tx
            : cur
    byId.set(tx.id, pick)
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  )
}

export function mergeTransactionsDeduped(...lists) {
  return dedupeTransactionsById(lists.flat())
}
