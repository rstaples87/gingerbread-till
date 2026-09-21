import { useEffect, useState } from 'react'
import { fmt } from '../utils'
import { TIP_PERCENTS } from '../features'
import styles from './TipPicker.module.css'

/**
 * Optional tip, chosen on the final payment step only. It is never part of the bill:
 * it is reported on its own and stays out of sales, VAT and item figures.
 * bill: the amount being paid; onChange(tip) is called with the tip in pounds (0 = none).
 */
export default function TipPicker({ bill, onChange }) {
  const [sel, setSel] = useState('none') // 'none' | a percent | 'custom'
  const [custom, setCustom] = useState('')

  let tip = 0
  if (sel === 'custom') tip = Number(custom)
  else if (sel !== 'none') tip = (Number(bill) * sel) / 100
  tip = Number.isFinite(tip) && tip > 0 ? Math.round(tip * 100) / 100 : 0

  useEffect(() => { onChange(tip) }, [tip, onChange])

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>Tip (optional)</div>
      <div className={styles.chips}>
        <button type="button" className={`${styles.chip} ${sel === 'none' ? styles.on : ''}`} onClick={() => setSel('none')}>No tip</button>
        {TIP_PERCENTS.map(p => (
          <button key={p} type="button" className={`${styles.chip} ${sel === p ? styles.on : ''}`} onClick={() => setSel(p)}>{p}%</button>
        ))}
        <button type="button" className={`${styles.chip} ${sel === 'custom' ? styles.on : ''}`} onClick={() => setSel('custom')}>£ Amount</button>
        {sel === 'custom' && (
          <input
            className={styles.input}
            type="number"
            min="0"
            step="0.01"
            autoFocus
            placeholder="0.00"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            aria-label="Tip amount"
          />
        )}
      </div>
      {tip > 0 && <div className={styles.total}>Tip {fmt(tip)} → customer pays <strong>{fmt(Number(bill) + tip)}</strong></div>}
    </div>
  )
}
