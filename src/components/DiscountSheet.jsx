import { useMemo, useState } from 'react'
import { fmt, lineAmount, allocateDiscount, saleLineText, DISCOUNT_REASONS } from '../utils'
import ManagerGate from './ManagerGate'
import styles from './DiscountSheet.module.css'

const PERCENTS = [5, 10, 15, 20, 25, 50]

/**
 * Apply a discount or a comp (free item) to a bill.
 * - Percent and £ discounts can be applied by anyone; a comp needs the manager PIN.
 * - A reason is always required.
 * items: the bill's lines. With allowLines the staff member can pick which lines; otherwise it is the whole bill.
 */
export default function DiscountSheet({
  title, items, allowLines = true, onApply, onClear, onClose,
  managerUnlocked, verifyManagerPin, unlockManager,
}) {
  const [kind, setKind] = useState('percent') // 'percent' | 'amount' | 'comp'
  const [percent, setPercent] = useState(10)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState(null) // null = whole bill, else Set of line indexes

  const lines = picked ? [...picked].sort((a, b) => a - b) : 'all'
  const value = kind === 'percent' ? Number(percent) : kind === 'amount' ? Number(amount) : 0
  const valid = Boolean(reason) && (kind === 'comp' || (Number.isFinite(value) && value > 0 && (kind !== 'percent' || value <= 100)))
  const spec = { kind, value, reason, lines }

  const preview = useMemo(() => {
    if (!valid) return null
    const after = allocateDiscount(items, spec)
    const before = items.reduce((s, i) => s + lineAmount(i), 0)
    const now = after.reduce((s, i) => s + lineAmount(i), 0)
    return { before, now, off: items.reduce((s, i) => s + i.price * i.qty, 0) - now }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spec is rebuilt from the values listed
  }, [valid, kind, percent, amount, reason, picked, items])

  const chosenIdx = picked ? [...picked] : items.map((_, i) => i)
  const anyDiscounted = chosenIdx.some(i => Number(items[i]?.discount) > 0)
  const toggleLine = (idx) => setPicked(prev => {
    const next = new Set(prev || [])
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    return next.size ? next : null
  })

  const needsPin = kind === 'comp' && !managerUnlocked

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.title}>{title || 'Discount / comp'}</div>

        {allowLines && (
          <>
            <div className={styles.label}>Applies to</div>
            <div className={styles.chips}>
              <button type="button" className={`${styles.chip} ${!picked ? styles.chipOn : ''}`} onClick={() => setPicked(null)}>Whole bill</button>
              <span className={styles.hint}>or tick lines:</span>
            </div>
            <div className={styles.list}>
              {items.map((it, idx) => (
                <label key={idx} className={`${styles.row} ${picked?.has(idx) ? styles.rowOn : ''}`}>
                  <input type="checkbox" checked={Boolean(picked?.has(idx))} onChange={() => toggleLine(idx)} />
                  <span className={styles.rowText}>{saleLineText(it)}</span>
                  <span className={styles.rowAmt}>{fmt(lineAmount(it))}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className={styles.seg}>
          <button type="button" className={`${styles.segBtn} ${kind === 'percent' ? styles.segOn : ''}`} onClick={() => setKind('percent')}>% off</button>
          <button type="button" className={`${styles.segBtn} ${kind === 'amount' ? styles.segOn : ''}`} onClick={() => setKind('amount')}>£ off</button>
          <button type="button" className={`${styles.segBtn} ${kind === 'comp' ? styles.segOn : ''}`} onClick={() => setKind('comp')}>Comp (free) 🔒</button>
        </div>

        {needsPin ? (
          <ManagerGate unlocked={false} verifyPin={verifyManagerPin} onUnlock={unlockManager} title="Manager PIN for a comp" />
        ) : (
          <>
            {kind === 'percent' && (
              <>
                <div className={styles.chips}>
                  {PERCENTS.map(p => (
                    <button key={p} type="button" className={`${styles.chip} ${Number(percent) === p ? styles.chipOn : ''}`} onClick={() => setPercent(p)}>{p}%</button>
                  ))}
                  <input
                    className={styles.input}
                    type="number"
                    min="1"
                    max="100"
                    value={percent}
                    onChange={e => setPercent(e.target.value)}
                    aria-label="Percent off"
                  />
                  <span className={styles.hint}>%</span>
                </div>
              </>
            )}
            {kind === 'amount' && (
              <div className={styles.chips}>
                <span className={styles.hint}>£</span>
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount off"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  aria-label="Amount off"
                />
              </div>
            )}
            {kind === 'comp' && <div className={styles.hint}>The chosen items become free.</div>}

            <div className={styles.label}>Reason (required)</div>
            <div className={styles.chips}>
              {DISCOUNT_REASONS.map(r => (
                <button key={r} type="button" className={`${styles.chip} ${reason === r ? styles.chipOn : ''}`} onClick={() => setReason(r)}>{r}</button>
              ))}
            </div>

            {preview && (
              <div className={styles.preview}>
                Takes <strong>{fmt(Math.max(0, preview.before - preview.now))}</strong> off → <strong>{fmt(preview.now)}</strong>
              </div>
            )}

            <button type="button" className={styles.primary} disabled={!valid} onClick={() => onApply(spec)}>
              {kind === 'comp' ? 'Comp these items' : 'Apply discount'}
            </button>
          </>
        )}

        {anyDiscounted && onClear && (
          <button type="button" className={styles.remove} onClick={() => onClear(lines)}>Remove the discount from {picked ? 'the ticked lines' : 'the whole bill'}</button>
        )}
        <button type="button" className={styles.cancel} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
