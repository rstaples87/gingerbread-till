import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../supabase'
import styles from './DebugDiagnostic.module.css'

const SUPABASE_URL_PREVIEW = (import.meta.env.VITE_SUPABASE_URL || '').slice(0, 30) || '(not set)'

const TEST_DEFINITIONS = [
  { id: 'read_till_stock', label: 'Can read from till_stock? (select 1 row)', kind: 'read', table: 'till_stock' },
  { id: 'read_tabs', label: 'Can read from tabs?', kind: 'read', table: 'tabs' },
  { id: 'read_transactions', label: 'Can read from transactions?', kind: 'read', table: 'transactions' },
  { id: 'read_bar_orders', label: 'Can read from bar_orders?', kind: 'read', table: 'bar_orders' },
  { id: 'write_till_stock', label: 'Can write to till_stock? (upsert product_id 999, qty 0, then delete)', kind: 'write_till_stock' },
  { id: 'write_tabs', label: 'Can write to tabs? (insert a test row then delete it)', kind: 'write_tabs' },
  { id: 'write_transactions', label: 'Can write to transactions? (insert a test row then delete it)', kind: 'write_transactions' },
]

function formatError(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  const parts = [err.message, err.details, err.hint, err.code].filter(Boolean)
  return parts.length ? parts.join(' — ') : String(err)
}

async function runReadTest(table) {
  if (!supabase) throw new Error('Supabase client not configured (check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)')
  const { error } = await supabase.from(table).select('*').limit(1)
  if (error) throw error
}

async function runWriteTillStockTest() {
  if (!supabase) throw new Error('Supabase client not configured')
  const product_id = 999
  const { error: upsertError } = await supabase
    .from('till_stock')
    .upsert({ product_id, qty: 0 }, { onConflict: 'product_id' })
  if (upsertError) throw upsertError
  const { error: deleteError } = await supabase.from('till_stock').delete().eq('product_id', product_id)
  if (deleteError) throw deleteError
}

async function runWriteTabsTest() {
  if (!supabase) throw new Error('Supabase client not configured')
  const id = `debug_test_${Date.now()}`
  const row = {
    id,
    name: '__debug_test__',
    items: [],
    opened_at: new Date().toISOString(),
  }
  const { error: insertError } = await supabase.from('tabs').insert(row)
  if (insertError) throw insertError
  const { error: deleteError } = await supabase.from('tabs').delete().eq('id', id)
  if (deleteError) throw deleteError
}

async function runWriteTransactionsTest() {
  if (!supabase) throw new Error('Supabase client not configured')
  const id = Date.now()
  const row = {
    id,
    time: new Date().toISOString(),
    total: 0,
    items: [],
    voided: false,
  }
  const { error: insertError } = await supabase.from('transactions').insert(row)
  if (insertError) throw insertError
  const { error: deleteError } = await supabase.from('transactions').delete().eq('id', id)
  if (deleteError) throw deleteError
}

async function runSingleTest(def) {
  switch (def.kind) {
    case 'read':
      await runReadTest(def.table)
      break
    case 'write_till_stock':
      await runWriteTillStockTest()
      break
    case 'write_tabs':
      await runWriteTabsTest()
      break
    case 'write_transactions':
      await runWriteTransactionsTest()
      break
    default:
      throw new Error(`Unknown test kind: ${def.kind}`)
  }
}

function initialResults() {
  return Object.fromEntries(
    TEST_DEFINITIONS.map((d) => [d.id, { status: 'pending', error: null }]),
  )
}

export default function DebugDiagnostic() {
  const [results, setResults] = useState(initialResults)
  const [running, setRunning] = useState(true)
  const runIdRef = useRef(0)

  const runAllTests = useCallback(async () => {
    const runId = ++runIdRef.current
    setRunning(true)
    setResults(initialResults())

    if (!isSupabaseConfigured) {
      const msg = 'Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
      const failed = Object.fromEntries(
        TEST_DEFINITIONS.map((d) => [d.id, { status: 'fail', error: msg }]),
      )
      setResults(failed)
      setRunning(false)
      return
    }

    for (const def of TEST_DEFINITIONS) {
      if (runId !== runIdRef.current) return
      try {
        await runSingleTest(def)
        if (runId !== runIdRef.current) return
        setResults((prev) => ({
          ...prev,
          [def.id]: { status: 'pass', error: null },
        }))
      } catch (err) {
        if (runId !== runIdRef.current) return
        setResults((prev) => ({
          ...prev,
          [def.id]: { status: 'fail', error: formatError(err) },
        }))
      }
    }

    if (runId === runIdRef.current) setRunning(false)
  }, [])

  useEffect(() => {
    runAllTests()
  }, [runAllTests])

  const passCount = TEST_DEFINITIONS.filter((d) => results[d.id]?.status === 'pass').length
  const failCount = TEST_DEFINITIONS.filter((d) => results[d.id]?.status === 'fail').length

  return (
    <div className={styles.wrap}>
      <div className={styles.banner}>
        Diagnostic page — not for production use
      </div>
      <h1 className={styles.title}>Supabase diagnostics</h1>
      <p className={styles.meta}>
        <strong>Supabase URL:</strong> {SUPABASE_URL_PREVIEW}
        {!import.meta.env.VITE_SUPABASE_URL && ' — environment variable missing'}
      </p>

      <ul className={styles.list}>
        {TEST_DEFINITIONS.map((def) => {
          const r = results[def.id] || { status: 'pending', error: null }
          const statusClass =
            r.status === 'pass' ? styles.pass
              : r.status === 'fail' ? styles.fail
                : styles.pending
          const statusText =
            r.status === 'pass' ? 'PASS ✅'
              : r.status === 'fail' ? 'FAIL ❌'
                : 'Running…'

          return (
            <li key={def.id} className={styles.item}>
              <div className={styles.itemLabel}>{def.label}</div>
              <div className={`${styles.itemStatus} ${statusClass}`}>{statusText}</div>
              {r.status === 'fail' && r.error && (
                <div className={styles.error}>{r.error}</div>
              )}
            </li>
          )
        })}
      </ul>

      <p className={styles.summary}>
        {running
          ? 'Tests in progress…'
          : `${passCount} passed, ${failCount} failed (${TEST_DEFINITIONS.length} total)`}
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.btnPrimary} disabled={running} onClick={runAllTests}>
          Re-run tests
        </button>
        <button type="button" className={styles.btn} onClick={() => { window.location.href = '/' }}>
          Back to till
        </button>
      </div>
    </div>
  )
}
