import { useState } from 'react'
import { fmt, formatStockItemQuantity } from '../utils'
import styles from './Stock.module.css'

const STOCK_CATS = ['Lager', 'Ale', '0% Beer', 'Cider', 'Mixers', 'House Spirits', 'Premium Spirits', 'Other Spirits', 'Wine', 'Soft Drinks']

function formatBottles(v) {
  const rounded = Math.round((v ?? 0) * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function getPortionLabel(product) {
  if (product.portionSize === 'pint') return 'pints'
  return product.portionSize >= 100 ? 'glasses' : 'measures'
}

/** The unit staff count in when they do a stock take — a keg for draught, otherwise a bottle. */
function getStockUnit(product) {
  return product.portionSize === 'pint' ? 'kegs' : 'bottles'
}

export default function Stock({ products, stock, adjustTillStock, setStockValue, adjustStockItem, stockItems, stockDefinitions, stockCategories, tillCategories }) {
  const [tab, setTab] = useState('till')
  // The old stock take (stockDefinitions/stockItems) is for the shared-bottle-pool system the events
  // Till uses. The POS never populates that table — every drink is its own product with its own stock —
  // so when it's empty, do the stock take against the products list instead (grouped, typed counts).
  const hasStockDefinitions = stockDefinitions?.length > 0

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

        {tab === 'till' && products.filter(p => p.group !== 'food').map(p => {
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
                <button className={styles.qtyBtn} onClick={() => adjustTillStock(p.id, -1)}>−</button>
                <span className={styles.qty}>{p.bottleYield ? `${formatBottles(s)} ${getStockUnit(p)}` : s}</span>
                <button className={styles.qtyBtn} onClick={() => adjustTillStock(p.id, 1)}>+</button>
              </div>
            </div>
          )
        })}

        {tab === 'take' && !hasStockDefinitions && (() => {
          const cats = (tillCategories?.length ? tillCategories : [...new Set(products.map(p => p.category))])
            .filter(cat => products.some(p => p.category === cat && p.group !== 'food'))
          return cats.map(cat => (
            <div key={cat}>
              <div className={styles.groupTitle}>{cat}</div>
              {products.filter(p => p.category === cat && p.group !== 'food').map(p => {
                const s = stock[p.id] ?? 0
                const portions = p.bottleYield ? Math.floor(s * p.bottleYield) : s
                const portionLabel = p.bottleYield ? getPortionLabel(p) : ''
                return (
                  <div key={p.id} className={styles.item}>
                    <div className={styles.info}>
                      <div className={styles.name}>{p.name}</div>
                      <div className={styles.meta}>
                        {p.bottleYield ? `${portions} ${portionLabel} available` : `${s} in stock`}
                      </div>
                    </div>
                    <div className={styles.controls}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={styles.takeInput}
                        defaultValue={formatBottles(s)}
                        onBlur={e => {
                          const val = Number(e.target.value)
                          if (Number.isFinite(val)) setStockValue(p.id, val)
                          else e.target.value = formatBottles(s)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                        aria-label={`Counted stock for ${p.name}`}
                      />
                      <span className={styles.takeUnit}>{p.bottleYield ? getStockUnit(p) : 'units'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        })()}

        {tab === 'take' && hasStockDefinitions && (stockCategories?.length ? stockCategories : STOCK_CATS).map(cat => {
          const items = stockDefinitions.filter(i => i.category === cat)
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
                      <button className={styles.qtyBtn} onClick={() => adjustStockItem(item.id, -1)}>−</button>
                      <span className={styles.qty}>{item.bottleYield ? formatBottles(qty) : qty}</span>
                      <button className={styles.qtyBtn} onClick={() => adjustStockItem(item.id, 1)}>+</button>
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
