import { useState } from 'react'
import { fmt } from '../utils'
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

/** A typed-count row, shared by both halves of the stock take. */
function CountRow({ name, meta, value, unit, onCommit, mixerMeta }) {
  return (
    <div className={styles.item}>
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        {meta && <div className={`${styles.meta} ${mixerMeta ? styles.mixerServeMeta : ''}`}>{meta}</div>}
      </div>
      <div className={styles.controls}>
        <input
          type="number"
          min="0"
          step="0.01"
          className={styles.takeInput}
          defaultValue={formatBottles(value)}
          onBlur={e => {
            const val = Number(e.target.value)
            if (Number.isFinite(val)) onCommit(val)
            else e.target.value = formatBottles(value)
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          aria-label={`Counted stock for ${name}`}
        />
        <span className={styles.takeUnit}>{unit}</span>
      </div>
    </div>
  )
}

export default function Stock({
  products, stock, adjustTillStock, setStockValue, setStockItemValue, stockItems, stockDefinitions, stockCategories,
  tillCategories, productVariants = {},
}) {
  const [tab, setTab] = useState('till')

  // A wine or spirit sold in several sizes (e.g. 175ml/125ml/Bottle, or Single/Double) shares one physical
  // bottle's stock — its products carry a variant pointing at a stock_items row instead of their own count.
  const poolCats = [...new Set(stockDefinitions.map(i => i.category))]
  const soloCats = (tillCategories?.length ? tillCategories : [...new Set(products.map(p => p.category))])
    .filter(cat => products.some(p => p.category === cat && p.group !== 'food' && !productVariants[p.id]))

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

        {tab === 'take' && (
          <>
            {stockDefinitions.length > 0 && (
              <>
                <div className={styles.groupTitle}>Shared bottles (sold in more than one size)</div>
                {(stockCategories?.length ? stockCategories : STOCK_CATS).concat(poolCats).filter((c, i, a) => a.indexOf(c) === i).map(cat => {
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
                        const meta = isMixer
                          ? (portions < 1 ? 'Out of stock' : `${portions} serves remaining`)
                          : item.bottleYield
                            ? `${portions} ${portionLabel}`
                            : null
                        return (
                          <CountRow
                            key={item.id}
                            name={item.name}
                            meta={meta}
                            mixerMeta={isMixer}
                            value={qty}
                            unit={item.unit || 'bottles'}
                            onCommit={val => setStockItemValue(item.id, val)}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </>
            )}

            {soloCats.length > 0 && (
              <>
                <div className={styles.groupTitle}>Everything else</div>
                {soloCats.map(cat => (
                  <div key={cat}>
                    <div className={styles.groupTitle}>{cat}</div>
                    {products.filter(p => p.category === cat && p.group !== 'food' && !productVariants[p.id]).map(p => {
                      const s = stock[p.id] ?? 0
                      const portions = p.bottleYield ? Math.floor(s * p.bottleYield) : s
                      const portionLabel = p.bottleYield ? getPortionLabel(p) : ''
                      return (
                        <CountRow
                          key={p.id}
                          name={p.name}
                          meta={p.bottleYield ? `${portions} ${portionLabel} available` : `${s} in stock`}
                          value={s}
                          unit={p.bottleYield ? getStockUnit(p) : 'units'}
                          onCommit={val => setStockValue(p.id, val)}
                        />
                      )
                    })}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
