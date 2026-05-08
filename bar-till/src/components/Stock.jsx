import { fmt } from '../utils'
import styles from './Stock.module.css'

export default function Stock({ products, stock, updateStock }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {products.map(p => {
          const s = stock[p.id]
          const badgeClass = s === 0 ? styles.badgeOut : s <= 5 ? styles.badgeLow : styles.badgeOk
          const badgeText = s === 0 ? 'Out' : s <= 5 ? 'Low' : 'OK'
          return (
            <div key={p.id} className={styles.item}>
              <div className={styles.info}>
                <div className={styles.name}>
                  {p.name}
                  <span className={`${styles.badge} ${badgeClass}`}>{badgeText}</span>
                </div>
                <div className={styles.meta}>{p.category} · {fmt(p.price)}</div>
              </div>
              <div className={styles.controls}>
                <button className={styles.qtyBtn} onClick={() => updateStock(p.id, -1)}>−</button>
                <span className={styles.qty}>{s}</span>
                <button className={styles.qtyBtn} onClick={() => updateStock(p.id, 1)}>+</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
