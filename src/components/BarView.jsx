import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { logSupabaseWrite } from '../supabaseWriteLog'
import { fmt, localSessionDateString } from '../utils'
import { mergeBarOrdersRealtime } from './barViewRealtime'
import styles from './BarView.module.css'

function parseItems(items) {
  if (Array.isArray(items)) return items
  if (items && typeof items === 'string') {
    try {
      const p = JSON.parse(items)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

function formatSentTime(sentAt) {
  if (!sentAt) return '—'
  const d = new Date(sentAt)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function BarView({ showToast }) {
  const [rows, setRows] = useState([])
  const [sessionDate] = useState(() => localSessionDateString())

  const loadOrders = useCallback(async () => {
    if (!supabase) return
    let { data, error } = await supabase
      .from('bar_orders')
      .select('*')
      .eq('session_date', sessionDate)
      .eq('archived', false)
      .order('sent_at', { ascending: false })
    if (error) {
      const fb = await supabase
        .from('bar_orders')
        .select('*')
        .eq('session_date', sessionDate)
        .eq('archived', false)
      data = fb.data
      error = fb.error
    }
    if (error) {
      console.warn('Bar orders load:', error.message)
      showToast?.('Could not load Bar Display System orders')
      return
    }
    setRows(data || [])
  }, [sessionDate, showToast])

  useEffect(() => {
    if (!supabase) return undefined
    loadOrders()

    // Realtime: bar_orders must be in publication supabase_realtime (see migrations/20260213120000_bar_orders.sql).
    const onRealtimeChange = (payload) => {
      setRows((prev) => mergeBarOrdersRealtime(prev, payload, sessionDate))
    }

    const channel = supabase
      .channel('bar_orders_display')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bar_orders' },
        onRealtimeChange,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bar_orders' },
        onRealtimeChange,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadOrders, sessionDate])

  const updateStatus = async (id, status) => {
    if (!supabase) return
    const { error } = await supabase.from('bar_orders').update({ status }).eq('id', id)
    if (error) {
      showToast?.('Update failed')
      return
    }
  }

  const onUnderwayChange = (row, checked) => {
    if (row.status === 'complete') return
    updateStatus(row.id, checked ? 'underway' : 'pending')
  }

  const onCompleteChange = (row, checked) => {
    if (checked) {
      updateStatus(row.id, 'complete')
    } else {
      updateStatus(row.id, 'underway')
    }
  }

  const clearCompleted = async () => {
    if (!supabase) return
    const { error } = await supabase
      .from('bar_orders')
      .update({ archived: true })
      .eq('session_date', sessionDate)
      .eq('status', 'complete')
      .eq('archived', false)
    logSupabaseWrite('bar_orders', 'update', error)
    if (error) {
      showToast?.('Could not archive orders')
      return
    }
    showToast?.('Completed orders cleared')
  }

  const active = rows.filter((r) => r.status !== 'complete')
  const completed = rows.filter((r) => r.status === 'complete')
  const hasCompleted = completed.length > 0

  if (!supabase) {
    return (
      <div className={styles.wrap}>
        <p className={styles.missing}>Bar Display System needs Supabase (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>Bar Display System</h1>
        <p className={styles.sub}>{sessionDate}</p>
      </div>
      <div className={styles.scroll}>
        {active.length === 0 && completed.length === 0 && (
          <p className={styles.empty}>No orders for today yet.</p>
        )}
        {active.map((row) => (
          <OrderCard
            key={row.id}
            row={row}
            onUnderwayChange={onUnderwayChange}
            onCompleteChange={onCompleteChange}
          />
        ))}
        {hasCompleted && (
          <>
            <h2 className={styles.sectionTitle}>Completed</h2>
            {completed.map((row) => (
              <OrderCard
                key={row.id}
                row={row}
                onUnderwayChange={onUnderwayChange}
                onCompleteChange={onCompleteChange}
              />
            ))}
          </>
        )}
      </div>
      {hasCompleted && (
        <div className={styles.footer}>
          <button type="button" className={styles.clearBtn} onClick={clearCompleted}>
            Clear completed orders
          </button>
        </div>
      )}
    </div>
  )
}

function OrderCard({ row, onUnderwayChange, onCompleteChange }) {
  const isComplete = row.status === 'complete'
  const isUnderway = row.status === 'underway' || isComplete
  const borderClass = isComplete ? styles.cardComplete : isUnderway ? styles.cardUnderway : styles.card

  const underwayChecked = isUnderway
  const completeChecked = isComplete

  return (
    <div className={borderClass}>
      <div className={styles.tabName}>{row.tab_name}</div>
      <div className={styles.meta}>
        <span>{formatSentTime(row.sent_at)}</span>
        <span className={styles.staff}>{row.staff_name || '—'}</span>
      </div>
      <ul className={styles.items}>
        {parseItems(row.items).map((it, idx) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={idx}>{it.qty}× {it.name}</li>
        ))}
      </ul>
      {row.notes && String(row.notes).trim() !== '' && (
        <div className={styles.cardNote}>
          📝 {String(row.notes).trim()}
        </div>
      )}
      <div className={styles.totalRow}>
        <span>Total</span>
        <span className={styles.total}>{fmt(Number(row.total) || 0)}</span>
      </div>
      <div className={styles.checks}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={underwayChecked}
            disabled={isComplete}
            onChange={(e) => onUnderwayChange(row, e.target.checked)}
          />
          Order underway
        </label>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={completeChecked}
            onChange={(e) => onCompleteChange(row, e.target.checked)}
          />
          Order complete
        </label>
      </div>
    </div>
  )
}
