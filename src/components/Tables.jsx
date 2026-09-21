import { useEffect, useMemo, useState } from 'react'
import { fmt, tabTotal } from '../utils'
import FloorPlan from './FloorPlan'
import fp from './FloorPlan.module.css'
import styles from './Tables.module.css'

const STALE_HOURS = 12
const DRINKS = '__drinks_tabs__'

export const tableLabel = (table) => (/^\d+$/.test(String(table?.name)) ? `Table ${table.name}` : String(table?.name ?? ''))

function openFor(openedAt, now) {
  const mins = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60000))
  if (mins < 60) return { text: `${mins}m`, stale: false }
  const h = Math.floor(mins / 60)
  if (h < 48) return { text: `${h}h ${String(mins % 60).padStart(2, '0')}m`, stale: h >= STALE_HOURS }
  return { text: `${Math.floor(h / 24)}d ${h % 24}h`, stale: true }
}

export default function Tables({
  floorAreas = [], floorTables = [], floorShapes = [], openTabs = [],
  openNewTabEntry, switchOrder, goToTill, showToast,
}) {
  const areas = useMemo(
    () => [...floorAreas].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name)),
    [floorAreas],
  )
  const [areaId, setAreaId] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [covers, setCovers] = useState(null) // { table, count }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const activeArea = areaId === DRINKS ? DRINKS : (areas.find(a => a.id === areaId)?.id ?? areas[0]?.id ?? DRINKS)

  const tablesHere = useMemo(
    () => floorTables
      .filter(t => t.areaId === activeArea)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true })),
    [floorTables, activeArea],
  )

  const structuresHere = floorShapes.filter(s => s.areaId === activeArea)
  const tabForTable = (table) => openTabs.find(t => t.tableId === table.id)
  const drinksTabs = openTabs.filter(t => !t.tableId)
  const openCountIn = (id) => floorTables.filter(t => t.areaId === id && tabForTable(t)).length

  const onTable = (table) => {
    const tab = tabForTable(table)
    if (tab) {
      switchOrder(tab.id)
      goToTill()
      return
    }
    setCovers({ table, count: table.seats && table.seats <= 4 ? table.seats : 2 })
  }

  const openTable = (withCovers) => {
    const { table, count } = covers
    openNewTabEntry(tableLabel(table), { tableId: table.id, ...(withCovers ? { covers: count } : {}) })
    setCovers(null)
    goToTill()
  }

  const newDrinksTab = () => {
    const name = (window.prompt('Name for the drinks tab?') || '').trim()
    if (!name) return
    openNewTabEntry(name)
    goToTill()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.areaBar}>
        {areas.map(a => {
          const n = openCountIn(a.id)
          return (
            <button key={a.id} type="button" className={`${styles.area} ${activeArea === a.id ? styles.areaOn : ''}`} onClick={() => setAreaId(a.id)}>
              {a.name}{n ? ` (${n})` : ''}
            </button>
          )
        })}
        <button type="button" className={`${styles.area} ${activeArea === DRINKS ? styles.areaOn : ''}`} onClick={() => setAreaId(DRINKS)}>
          Drinks Tabs{drinksTabs.length ? ` (${drinksTabs.length})` : ''}
        </button>
      </div>

      <div className={styles.scroll}>
        {activeArea === DRINKS ? (
          <>
            <div className={styles.grid}>
              {drinksTabs.map(tab => {
                const t = openFor(tab.openedAt, now)
                return (
                  <button key={tab.id} type="button" className={`${styles.tile} ${styles.tileOpen} ${t.stale ? styles.tileStale : ''}`} onClick={() => { switchOrder(tab.id); goToTill() }}>
                    <div className={styles.tileName}>{tab.name}</div>
                    <div className={styles.tileMeta}>{fmt(tabTotal(tab))}</div>
                    <div className={styles.tileMeta}>{t.text}</div>
                  </button>
                )
              })}
              <button type="button" className={`${styles.tile} ${styles.tileNew}`} onClick={newDrinksTab}>
                <div className={styles.tileName}>+ New tab</div>
              </button>
            </div>
            {!drinksTabs.length && <div className={styles.empty}>No drinks tabs open.</div>}
          </>
        ) : (
          <>
            {(tablesHere.length > 0 || structuresHere.length > 0) && (
              <FloorPlan
                tables={tablesHere}
                structures={structuresHere}
                mode="view"
                onTap={onTable}
                renderTile={(table) => {
                  const tab = tabForTable(table)
                  const t = tab ? openFor(tab.openedAt, now) : null
                  return {
                    className: tab ? `${fp.open} ${t.stale ? fp.stale : ''}` : '',
                    node: (
                      <>
                        <div className={fp.name}>{table.name}</div>
                        {tab ? (
                          <>
                            {tab.covers != null && <div className={fp.meta}>{tab.covers} {tab.covers === 1 ? 'cover' : 'covers'}</div>}
                            <div className={fp.meta}>{fmt(tabTotal(tab))}</div>
                            <div className={fp.meta}>{t.text}{t.stale ? ' ⚠' : ''}</div>
                          </>
                        ) : (table.seats ? <div className={fp.meta}>({table.seats})</div> : null)}
                      </>
                    ),
                  }
                }}
              />
            )}
            {!tablesHere.length && (
              <div className={styles.empty}>
                No tables in this area yet. Add them in Settings → Tables.
              </div>
            )}
          </>
        )}
      </div>

      {covers && (
        <div className={styles.overlay} onClick={() => setCovers(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>{tableLabel(covers.table)}</div>
            <div className={styles.sheetSub}>How many covers?</div>
            <div className={styles.stepper}>
              <button type="button" className={styles.stepBtn} onClick={() => setCovers(c => ({ ...c, count: Math.max(1, c.count - 1) }))}>−</button>
              <div className={styles.stepVal}>{covers.count}</div>
              <button type="button" className={styles.stepBtn} onClick={() => setCovers(c => ({ ...c, count: Math.min(99, c.count + 1) }))}>+</button>
            </div>
            <div className={styles.quick}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                <button key={n} type="button" className={`${styles.chip} ${covers.count === n ? styles.chipOn : ''}`} onClick={() => setCovers(c => ({ ...c, count: n }))}>{n}</button>
              ))}
            </div>
            <button type="button" className={styles.primary} onClick={() => openTable(true)}>Open table</button>
            <button type="button" className={styles.skip} onClick={() => openTable(false)}>Skip covers</button>
            <button type="button" className={styles.cancel} onClick={() => { setCovers(null); showToast?.('Cancelled') }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
