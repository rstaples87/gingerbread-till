import { useCallback, useEffect, useRef, useState } from 'react'
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

function ageMinutes(sentAt, now) {
  const t = new Date(sentAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60000))
}

const TITLES = { kitchen: 'Kitchen Display', bar: 'Bar Display' }

/** Short two-tone chime for a new ticket (only after the user has switched sound on with a tap). */
function chime(ctxRef) {
  try {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.18)
      osc.stop(now + i * 0.18 + 0.18)
    })
  } catch {}
}

/**
 * Order display. With no `station` it behaves as the original single Bar Display System (all orders).
 * In the POS build it is used twice: station="kitchen" (food) and station="bar" (drinks).
 */
export default function BarView({ showToast, station = null }) {
  const [rows, setRows] = useState([])
  const [sessionDate, setSessionDate] = useState(() => localSessionDateString())
  const [now, setNow] = useState(() => Date.now())
  const soundKey = `bt_display_sound_${station || 'all'}`
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem(soundKey) === '1' } catch { return false }
  })
  const audioRef = useRef(null)
  const soundOnRef = useRef(soundOn)
  soundOnRef.current = soundOn

  // The display can stay open all night and past the 06:00 trading-day rollover: keep the date current
  // (a new date re-runs the load and realtime subscription below, so old orders drop off).
  useEffect(() => {
    const refreshSessionDate = () => setSessionDate(localSessionDateString())
    const timer = setInterval(refreshSessionDate, 60_000)
    window.addEventListener('focus', refreshSessionDate)
    document.addEventListener('visibilitychange', refreshSessionDate)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refreshSessionDate)
      document.removeEventListener('visibilitychange', refreshSessionDate)
    }
  }, [])

  // Ticket ages tick every 30 seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const toggleSound = () => {
    const next = !soundOn
    if (next) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx && !audioRef.current) audioRef.current = new Ctx()
        audioRef.current?.resume?.()
        chime(audioRef)
      } catch {}
    }
    setSoundOn(next)
    try { localStorage.setItem(soundKey, next ? '1' : '0') } catch {}
  }

  const loadOrders = useCallback(async () => {
    if (!supabase) return
    const base = () => {
      let q = supabase
        .from('bar_orders')
        .select('*')
        .eq('session_date', sessionDate)
        .eq('archived', false)
      if (station) q = q.eq('station', station)
      return q
    }
    let { data, error } = await base().order('sent_at', { ascending: false })
    if (error) {
      const fb = await base()
      data = fb.data
      error = fb.error
    }
    if (error) {
      console.warn('Bar orders load:', error.message)
      showToast?.('Could not load orders')
      return
    }
    setRows(data || [])
  }, [sessionDate, station, showToast])

  useEffect(() => {
    if (!supabase) return undefined
    loadOrders()

    // Realtime: bar_orders must be in publication supabase_realtime (see migrations/20260213120000_bar_orders.sql).
    const onRealtimeChange = (payload) => {
      setRows((prev) => {
        const next = mergeBarOrdersRealtime(prev, payload, sessionDate, station)
        const type = payload.eventType || payload.event
        if (type === 'INSERT' && next.length > prev.length && soundOnRef.current) chime(audioRef)
        return next
      })
    }

    const channel = supabase
      .channel(`bar_orders_display_${station || 'all'}`)
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

    // Safety net: if a live update is ever missed, a refetch every minute puts the screen right.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) loadOrders()
    }, 60_000)

    return () => {
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [loadOrders, sessionDate, station])

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
    let q = supabase
      .from('bar_orders')
      .update({ archived: true })
      .eq('session_date', sessionDate)
      .eq('status', 'complete')
      .eq('archived', false)
    if (station) q = q.eq('station', station)
    const { error } = await q
    logSupabaseWrite('bar_orders', 'update', error)
    if (error) {
      showToast?.('Could not archive orders')
      return
    }
    showToast?.('Completed orders cleared')
  }

  // Station screens work oldest-first (what has waited longest is at the top); the original screen is newest-first.
  const byTime = (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  const active = rows.filter((r) => r.status !== 'complete').sort(station ? byTime : () => 0)
  const completed = rows.filter((r) => r.status === 'complete')
  const hasCompleted = completed.length > 0

  if (!supabase) {
    return (
      <div className={styles.wrap}>
        <p className={styles.missing}>Display needs Supabase (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{TITLES[station] || 'Bar Display System'}</h1>
        <p className={styles.sub}>
          {sessionDate}
          {station && (
            <button type="button" className={styles.soundBtn} onClick={toggleSound}>
              {soundOn ? '🔔 Sound on' : '🔕 Sound off'}
            </button>
          )}
        </p>
      </div>
      <div className={styles.scroll}>
        {active.length === 0 && completed.length === 0 && (
          <p className={styles.empty}>No orders for today yet.</p>
        )}
        {active.map((row) => (
          <OrderCard
            key={row.id}
            row={row}
            now={now}
            station={station}
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
                now={now}
                station={station}
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

function OrderCard({ row, now, station, onUnderwayChange, onCompleteChange }) {
  const isComplete = row.status === 'complete'
  const isUnderway = row.status === 'underway' || isComplete
  const borderClass = isComplete ? styles.cardComplete : isUnderway ? styles.cardUnderway : styles.card

  const underwayChecked = isUnderway
  const completeChecked = isComplete
  const age = ageMinutes(row.sent_at, now)
  const ageClass = isComplete ? '' : age >= 20 ? styles.ageLate : age >= 10 ? styles.ageWarn : ''

  return (
    <div className={borderClass}>
      <div className={styles.tabName}>
        {row.tab_name}
        {row.covers != null && <span className={styles.covers}> · {row.covers} {Number(row.covers) === 1 ? 'cover' : 'covers'}</span>}
      </div>
      <div className={styles.meta}>
        <span>{formatSentTime(row.sent_at)}{!isComplete && <span className={`${styles.age} ${ageClass}`}> · {age}m</span>}</span>
        <span className={styles.staff}>{row.staff_name || '—'}</span>
      </div>
      <ul className={styles.items}>
        {parseItems(row.items).map((it, idx) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={idx}>
            {it.qty}× {it.name}
            {it.options && <div className={styles.itemOpts}>{it.options}</div>}
            {it.note && <div className={styles.itemNote}>“{it.note}”</div>}
          </li>
        ))}
      </ul>
      {row.notes && String(row.notes).trim() !== '' && (
        <div className={styles.cardNote}>
          📝 {String(row.notes).trim()}
        </div>
      )}
      {!station && (
        <div className={styles.totalRow}>
          <span>Total</span>
          <span className={styles.total}>{fmt(Number(row.total) || 0)}</span>
        </div>
      )}
      <div className={styles.checks}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={underwayChecked}
            disabled={isComplete}
            onChange={(e) => onUnderwayChange(row, e.target.checked)}
          />
          {station === 'kitchen' ? 'Cooking' : 'Order underway'}
        </label>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={completeChecked}
            onChange={(e) => onCompleteChange(row, e.target.checked)}
          />
          {station === 'kitchen' ? 'Ready' : 'Order complete'}
        </label>
      </div>
    </div>
  )
}
