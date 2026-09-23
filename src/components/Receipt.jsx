import { fmt, lineAmount, saleLineText } from '../utils'
import { branding } from '../features'
import styles from './Receipt.module.css'

/**
 * The printable bill/receipt. Rendered once at the app root and normally invisible — App.jsx's
 * printBill() fills it in and calls window.print(); index.css hides everything else while printing.
 * bill: { title, items, discountOff, tip, total, payment, tenderedAmount, changeGiven, staff, covers, customer, paid }
 */
export default function Receipt({ bill }) {
  if (!bill) return null
  const { title, items = [], discountOff, tip, total, payment, tenderedAmount, changeGiven, staff, covers, customer, paid } = bill
  const now = new Date()

  return (
    <div className={`${styles.sheet} receiptPrint`}>
      <div className={styles.center}>
        <div className={styles.brand}>{branding.appTitle}</div>
        <div className={styles.small}>{now.toLocaleDateString('en-GB')} {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
        {title && <div className={styles.small}>{title}</div>}
        {customer && <div className={styles.small}>{customer}{covers != null ? ` · ${covers} covers` : ''}</div>}
      </div>

      <div className={styles.rule} />

      {items.map((it, i) => (
        <div key={i} className={styles.line}>
          <span className={styles.lineText}>{saleLineText(it)}</span>
          <span className={styles.lineAmt}>{fmt(lineAmount(it))}</span>
        </div>
      ))}

      <div className={styles.rule} />

      {discountOff > 0 && (
        <div className={styles.line}><span>Discount</span><span>−{fmt(discountOff)}</span></div>
      )}
      {tip > 0 && (
        <div className={styles.line}><span>Tip</span><span>{fmt(tip)}</span></div>
      )}
      <div className={`${styles.line} ${styles.total}`}>
        <span>{paid ? 'Total paid' : 'Total due'}</span><span>{fmt(total)}</span>
      </div>
      {payment && (
        <div className={styles.line}><span>Paid by</span><span>{payment === 'cash' ? 'Cash' : payment === 'card' ? 'Card' : 'Account'}</span></div>
      )}
      {typeof tenderedAmount === 'number' && (
        <>
          <div className={styles.line}><span>Cash tendered</span><span>{fmt(tenderedAmount)}</span></div>
          <div className={styles.line}><span>Change</span><span>{fmt(changeGiven || 0)}</span></div>
        </>
      )}

      <div className={styles.rule} />
      <div className={styles.center}>
        {staff && <div className={styles.small}>Served by {staff}</div>}
        <div className={styles.small}>Thank you</div>
      </div>
    </div>
  )
}
