import { useEffect, useState } from 'react'
import { fmt, tabTotal, tabLabel, takeItemsPart, takeEvenShare, saleLineText, fmtQty } from '../utils'
import TipPicker from './TipPicker'
import styles from './SplitBill.module.css'

/**
 * Split a table's bill: pick items for each person/couple to pay, or split evenly.
 * Each payment is a separate sale; what's left stays on the table until it's all paid.
 */
export default function SplitBill({ tab, hasPending, onPay, onClose }) {
  const [mode, setMode] = useState('items') // 'items' | 'even'
  const [payment, setPayment] = useState('card')
  const [picks, setPicks] = useState({}) // { lineIndex: qty }
  const [people, setPeople] = useState(2)
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState(0)

  // Whatever was just paid is gone from the table, so clear the picks.
  useEffect(() => { setPicks({}) }, [tab?.items?.length, tabTotal(tab || { items: [] })])

  if (!tab) return null
  const total = tabTotal(tab)
  const selected = takeItemsPart(tab.items, picks)
  const share = takeEvenShare(tab.items, people)
  const lastPerson = people <= 1

  const step = (idx, delta) => {
    const it = tab.items[idx]
    setPicks(p => {
      const cur = Number(p[idx]) || 0
      const next = delta > 0 ? Math.min(it.qty, cur + 1) : Math.max(0, cur - 1)
      return { ...p, [idx]: next }
    })
  }
  const selectAll = () => setPicks(Object.fromEntries(tab.items.map((it, i) => [i, it.qty])))

  const pay = async (spec) => {
    setBusy(true)
    const r = await onPay(spec, payment, tip)
    setBusy(false)
    if (r?.closed) onClose()
    else if (r?.ok && spec.kind === 'even') setPeople(p => Math.max(1, p - 1))
  }

  const payToggle = (
    <div className={styles.seg}>
      <button type="button" className={`${styles.segBtn} ${payment === 'card' ? styles.segOn : ''}`} onClick={() => setPayment('card')}>💳 Card</button>
      <button type="button" className={`${styles.segBtn} ${payment === 'cash' ? styles.segOn : ''}`} onClick={() => setPayment('cash')}>💵 Cash</button>
    </div>
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.title}>Split bill — {tabLabel(tab)}</div>
        <div className={styles.remaining}>Left to pay <strong>{fmt(total)}</strong>{tab.covers != null ? ` · ${tab.covers} covers` : ''}</div>

        {hasPending ? (
          <div className={styles.warn}>This table has items that haven't been added to its bill yet. Add them first (Open order → Add items), then split.</div>
        ) : (
          <>
            <div className={styles.seg}>
              <button type="button" className={`${styles.segBtn} ${mode === 'items' ? styles.segOn : ''}`} onClick={() => setMode('items')}>Pick items</button>
              <button type="button" className={`${styles.segBtn} ${mode === 'even' ? styles.segOn : ''}`} onClick={() => setMode('even')}>Split evenly</button>
            </div>
            {payToggle}

            {mode === 'items' && (
              <>
                <div className={styles.hint}>Tick what this person or couple is paying for. Everything else stays on the table.</div>
                <div className={styles.list}>
                  {tab.items.map((it, idx) => {
                    const n = Number(picks[idx]) || 0
                    return (
                      <div key={idx} className={`${styles.row} ${n > 0 ? styles.rowOn : ''}`}>
                        <div className={styles.rowText}>
                          <div>{saleLineText({ ...it, qty: it.qty })}</div>
                          <div className={styles.each}>{fmt(it.price)} each</div>
                        </div>
                        <div className={styles.stepper}>
                          <button type="button" className={styles.stepBtn} onClick={() => step(idx, -1)} disabled={n <= 0}>−</button>
                          <span className={styles.stepVal}>{fmtQty(n)}</span>
                          <button type="button" className={styles.stepBtn} onClick={() => step(idx, 1)} disabled={n >= it.qty}>+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.linkBtn} onClick={selectAll}>Select everything</button>
                  <button type="button" className={styles.linkBtn} onClick={() => setPicks({})} disabled={!selected.lines.length}>Clear</button>
                </div>
                <TipPicker bill={selected.amount} onChange={setTip} />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !selected.lines.length}
                  onClick={() => pay({ kind: 'items', picks })}
                >
                  Pay selected {fmt(selected.amount)} by {payment}
                </button>
              </>
            )}

            {mode === 'even' && (
              <>
                <div className={styles.hint}>How many people are still to pay? Each pays an equal share of what's left.</div>
                <div className={styles.bigStepper}>
                  <button type="button" className={styles.bigBtn} onClick={() => setPeople(p => Math.max(1, p - 1))}>−</button>
                  <div className={styles.bigVal}>{people}<span>{people === 1 ? 'person' : 'people'}</span></div>
                  <button type="button" className={styles.bigBtn} onClick={() => setPeople(p => Math.min(30, p + 1))}>+</button>
                </div>
                <div className={styles.share}>
                  {lastPerson ? 'The last person pays' : 'Each pays about'} <strong>{fmt(share.amount)}</strong>
                </div>
                {!lastPerson && <div className={styles.hint}>Pennies are shared out so the shares add up exactly. The last person pays whatever is left.</div>}
                <TipPicker bill={share.amount} onChange={setTip} />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || total <= 0}
                  onClick={() => pay({ kind: 'even', people })}
                >
                  {lastPerson ? 'Pay the rest' : 'Pay one share'} {fmt(share.amount)} by {payment}
                </button>
              </>
            )}
          </>
        )}

        <button type="button" className={styles.cancel} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
