import { useState } from 'react'
import { STOCK_ITEMS } from '../data'
import { fmt, formatStockItemQuantity } from '../utils'
import styles from './Stock.module.css'

const STOCK_CATS = ['Lager', 'Ale', '0% Beer', 'Cider', 'Mixers', 'House Spirits', 'Premium Spirits', 'Other Spirits', 'Wine', 'Soft Drinks']

function formatBottles(v) {
  const rounded = Math.round((v ?? 0) * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function getPortionLabel(product) {
  return product.portionSize >= 100 ? 'glasses' : 'measures'
}

export default function Stock({ products, stock, updateStock, stockItems, setStockItems }) {
  const [tab, setTab] = useState('till')

  const changeStockItem = (id, delta) => {
    setStockItems(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div className={styles.topTabs}>
          <button className={`${styles.topTab} ${tab === 'till' ? styles.topTabActive : ''}`} onClick={() => setTab('till')}>
            Till products
          </button>
          <button className={`${styles.topTab} ${tab === 'take' ? styles.topTabActive : ''}`} onClick={() => setTab('take')}>
            Stock take
          </button>
        </div>

        {tab === 'till' && products.map(p => {
          const s = stock[p.id] ?? 0
          const portions = p.bottleYield ? Math.floor(s * p.bottleYield) : s
          const isOut = p.bottleYield ? portions < 1 : s === 0
          const isLow = p.bottleYield ? portions > 0 && portions <= 5 : s > 0 && s <= 5
          const badgeClass = isOut ? styles.badgeOut : isLow ? styles.badgeLow : styles.badgeOk
          const badgeText = isOut ? 'Out' : isLow ? 'Low' : 'OK'
          const portionLabel = p.bottleYield ? getPortionLabel(p) : ''
          return (
            <div key={p.id} className={styles.item}>
              <div className={styles.info}>
                <div className={styles.name}>
                  {p.name}
                  <span className={`${styles.badge} ${badgeClass}`}>{badgeText}</span>
                </div>
                <div className={styles.meta}>
                  {p.category} · {fmt(p.price)}
                  {p.bottleYield && (
                    <span className={styles.portionMeta}> · {portions} {portionLabel} available</span>
                  )}
                </div>
              </div>
              <div className={styles.controls}>
                <button className={styles.qtyBtn} onClick={() => updateStock(p.id, -1)}>−</button>
                <span className={styles.qty}>{p.bottleYield ? `${formatBottles(s)} bottles` : s}</span>
                <button className={styles.qtyBtn} onClick={() => updateStock(p.id, 1)}>+</button>
              </div>
            </div>
          )
        })}

        {tab === 'take' && STOCK_CATS.map(cat => {
          const items = STOCK_ITEMS.filter(i => i.category === cat)
          if (!items.length) return null
          return (
            <div key={cat}>
              <div className={styles.groupTitle}>{cat}</div>
              {items.map(item => {
                const qty = stockItems?.[item.id] ?? 0
                const portions = item.bottleYield ? Math.floor(qty * item.bottleYield) : null
                const isMixer = item.category === 'Mixers' && item.bottleYield
                const portionLabel = item.bottleYield && !isMixer
                  ? (item.category === 'Wine' ? 'glasses' : 'measures')
                  : item.unit
                const metaLine = isMixer
                  ? (portions < 1 ? 'Out of stock' : `${portions} serves remaining`)
                  : item.bottleYield
                    ? `${portions} ${portionLabel}`
                    : formatStockItemQuantity(qty, item)
                return (
                  <div key={item.id} className={styles.item}>
                    <div className={styles.info}>
                      <div className={styles.name}>{item.name}</div>
                      <div className={`${styles.meta} ${isMixer ? styles.mixerServeMeta : ''}`}>
                        {metaLine}
                      </div>
                    </div>
                    <div className={styles.controls}>
                      <button className={styles.qtyBtn} onClick={() => changeStockItem(item.id, -1)}>−</button>
                      <span className={styles.qty}>{item.bottleYield ? formatBottles(qty) : qty}</span>
                      <button className={styles.qtyBtn} onClick={() => changeStockItem(item.id, 1)}>+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
