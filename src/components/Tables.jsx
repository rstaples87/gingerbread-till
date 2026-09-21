import { useEffect, useMemo, useState } from 'react'
import { fmt, tabTotal, saleLineText, tabLabel, tableLabel, lineAmount } from '../utils'
import FloorPlan from './FloorPlan'
import fp from './FloorPlan.module.css'
import styles from './Tables.module.css'

const STALE_HOURS = 12
const DRINKS = '__drinks_tabs__'

export { tableLabel }

function openFor(openedAt, now) {
  const mins = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60000))
  if (mins < 60) return { text: `${mins}m`, stale: false }
  const h = Math.floor(mins / 60)
  if (h < 48) return { text: `${h}h ${String(mins % 60).padStart(2, '0')}m`, stale: h >= STALE_HOURS }
  return { text: `${Math.floor(h / 24)}d ${h % 24}h`, stale: true }
}

export default function Tables({
  floorAreas = [], floorTables = [], floorShapes = [], openTabs = [],
  openNewTabEntry, updateTabDetails, moveTab, mergeTabs, openSplit, openDiscount, switchOrder, goToTill, showToast,
}) {
  const areas = useMemo(
    () => [...floorAreas].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name)),
    [floorAreas],
  )
  const [areaId, setAreaId] = useState(null)
  const [now, setNow] = useState(Date.now())
  // The pop-out card. mode: 'free' (open a table) | 'open' (a table with a tab) | 'drink' (a tab with no table)
  const [card, setCard] = useState(null)
  // Move / merge: pick a target on the plan. { kind: 'move' | 'merge', tabId }
  const [pick, setPick] = useState(null)

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

  // Tapping any table (free or open) shows its card; nothing happens until a button is pressed.
  const isValidTarget = (table) => {
    if (!pick) return false
    const tab = tabForTable(table)
    return pick.kind === 'move' ? !tab : Boolean(tab) && tab.id !== pick.tabId
  }

  const onTable = (table) => {
    const tab = tabForTable(table)
    if (pick) {
      if (!isValidTarget(table)) {
        showToast?.(pick.kind === 'move' ? 'Pick a free table' : 'Pick a table that is open')
        return
      }
      setCard({ mode: 'confirm', kind: pick.kind, tabId: pick.tabId, table })
      return
    }
    if (tab) {
      setCard({ mode: 'open', table, tabId: tab.id, customer: tab.customer || '', covers: tab.covers ?? null })
    } else {
      setCard({ mode: 'free', table, customer: '', covers: table.seats && table.seats <= 4 ? table.seats : 2 })
    }
  }

  const onDrinksTab = (tab) => {
    if (pick) { showToast?.('Pick a table on the plan'); return }
    setCard({ mode: 'drink', tabId: tab.id, name: tab.name })
  }

  const cardTab = card?.tabId ? openTabs.find(t => t.id === card.tabId) : null

  const saveCard = () => {
    if (!cardTab) return
    if (card.mode === 'drink') updateTabDetails(cardTab.id, { name: card.name })
    else updateTabDetails(cardTab.id, { customer: card.customer, covers: card.covers })
  }

  const openTable = (withCovers) => {
    const { table, covers, customer } = card
    openNewTabEntry(tableLabel(table), {
      tableId: table.id,
      ...(withCovers ? { covers } : {}),
      ...(customer.trim() ? { customer: customer.trim() } : {}),
    })
    setCard(null)
    goToTill()
  }

  const newDrinksTab = () => {
    const name = (window.prompt('Name for the drinks tab? (e.g. the customer\'s name)') || '').trim()
    if (!name) return
    openNewTabEntry(name)
    goToTill()
  }

  const confirmPick = () => {
    const ok = card.kind === 'move'
      ? moveTab(card.tabId, card.table)
      : mergeTabs(card.tabId, tabForTable(card.table).id)
    if (ok) setPick(null)
    setCard(null)
  }

  const goToOrder = () => {
    saveCard()
    switchOrder(card.tabId)
    setCard(null)
    goToTill()
  }

  const stepper = (value, onChange) => (
    <div className={styles.stepper}>
      <button type="button" className={styles.stepBtn} onClick={() => onChange(Math.max(1, (value ?? 1) - 1))}>−</button>
      <div className={styles.stepVal}>{value ?? '–'}</div>
      <button type="button" className={styles.stepBtn} onClick={() => onChange(Math.min(99, (value ?? 0) + 1))}>+</button>
    </div>
  )

  const t = cardTab ? openFor(cardTab.openedAt, now) : null

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

      {pick && (
        <div className={styles.pickBar}>
          <span>
            {pick.kind === 'move' ? 'Moving' : 'Merging'} <strong>{tabLabel(openTabs.find(t => t.id === pick.tabId))}</strong>
            {pick.kind === 'move' ? ': tap the free table to move to.' : ': tap the open table to merge into.'}
          </span>
          <button type="button" className={styles.pickCancel} onClick={() => setPick(null)}>Cancel</button>
        </div>
      )}

      <div className={styles.scroll}>
        {activeArea === DRINKS ? (
          <>
            <div className={styles.grid}>
              {drinksTabs.map(tab => {
                const ot = openFor(tab.openedAt, now)
                return (
                  <button key={tab.id} type="button" className={`${styles.tile} ${styles.tileOpen} ${ot.stale ? styles.tileStale : ''}`} onClick={() => onDrinksTab(tab)}>
                    <div className={styles.tileName}>{tab.name}</div>
                    <div className={styles.tileMeta}>{fmt(tabTotal(tab))}</div>
                    <div className={styles.tileMeta}>{ot.text}</div>
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
                  const ot = tab ? openFor(tab.openedAt, now) : null
                  // Tiles stay small and readable (round ones especially): just the number and the running total.
                  // Everything else is in the pop-out when the table is tapped.
                  return {
                    className: `${tab ? `${fp.open} ${ot.stale ? fp.stale : ''}` : ''} ${isValidTarget(table) ? fp.target : ''} ${pick && pick.tabId === tab?.id ? fp.source : ''}`,
                    node: (
                      <>
                        <div className={fp.name}>{table.name}</div>
                        {tab ? <div className={fp.meta}>{fmt(tabTotal(tab))}</div> : null}
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

      {card && (
        <div className={styles.overlay} onClick={() => setCard(null)}>
          <div className={styles.sheet} onClick={e => e.stopPropagation()}>
            <div className={styles.sheetTitle}>
              {card.mode === 'confirm' ? (card.kind === 'move' ? 'Move table' : 'Merge tables') : card.mode === 'drink' ? (cardTab?.name || 'Tab') : tableLabel(card.table)}
              {card.mode !== 'confirm' && cardTab?.customer ? <span className={styles.titleSub}> · {cardTab.customer}</span> : null}
            </div>

            {card.mode === 'confirm' && cardTab && (() => {
              const target = card.kind === 'merge' ? tabForTable(card.table) : null
              return (
                <>
                  <div className={styles.sheetSub}>
                    {card.kind === 'move'
                      ? `Move ${tabLabel(cardTab)} to ${tableLabel(card.table)}?`
                      : `Merge ${tabLabel(cardTab)} into ${tabLabel(target)}?`}
                  </div>
                  <div className={styles.facts}>
                    <div><span>{card.kind === 'move' ? 'Bill' : 'Adding'}</span><strong>{fmt(tabTotal(cardTab))}</strong></div>
                    {cardTab.covers != null && <div><span>Covers</span><strong>{cardTab.covers}</strong></div>}
                    {target && <div><span>New total</span><strong>{fmt(tabTotal(cardTab) + tabTotal(target))}</strong></div>}
                  </div>
                  <div className={styles.sheetSub}>
                    {card.kind === 'move'
                      ? 'The order, customer name, covers and time open all go with it. Tickets already sent keep the old table name.'
                      : `Its items, covers and customer name are added to ${tabLabel(target)}, and ${cardTab.name} is closed.`}
                  </div>
                  <button type="button" className={styles.primary} onClick={confirmPick}>{card.kind === 'move' ? 'Move table' : 'Merge tables'}</button>
                </>
              )
            })()}

            {card.mode === 'free' && (
              <>
                <div className={styles.sheetSub}>Free{card.table.seats ? ` · seats ${card.table.seats}` : ''}</div>
                <label className={styles.field}>
                  <span>Customer name (optional)</span>
                  <input
                    className={styles.input}
                    value={card.customer}
                    maxLength={40}
                    placeholder="e.g. Smith party"
                    onChange={e => setCard(c => ({ ...c, customer: e.target.value }))}
                  />
                </label>
                <div className={styles.fieldLabel}>Covers</div>
                {stepper(card.covers, n => setCard(c => ({ ...c, covers: n })))}
                <div className={styles.quick}>
                  {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                    <button key={n} type="button" className={`${styles.chip} ${card.covers === n ? styles.chipOn : ''}`} onClick={() => setCard(c => ({ ...c, covers: n }))}>{n}</button>
                  ))}
                </div>
                <button type="button" className={styles.primary} onClick={() => openTable(true)}>Open table</button>
                <button type="button" className={styles.skip} onClick={() => openTable(false)}>Skip covers</button>
              </>
            )}

            {(card.mode === 'open' || card.mode === 'drink') && cardTab && (
              <>
                <div className={styles.facts}>
                  <div><span>Total</span><strong>{fmt(tabTotal(cardTab))}</strong></div>
                  <div><span>Open for</span><strong className={t.stale ? styles.staleText : ''}>{t.text}{t.stale ? ' ⚠' : ''}</strong></div>
                  <div><span>Items</span><strong>{cardTab.items.reduce((n, i) => n + i.qty, 0)}</strong></div>
                  {cardTab.staff ? <div><span>Server</span><strong>{cardTab.staff}</strong></div> : null}
                </div>

                {card.mode === 'drink' ? (
                  <label className={styles.field}>
                    <span>Tab name</span>
                    <input className={styles.input} value={card.name} maxLength={40} onChange={e => setCard(c => ({ ...c, name: e.target.value }))} />
                  </label>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span>Customer name</span>
                      <input
                        className={styles.input}
                        value={card.customer}
                        maxLength={40}
                        placeholder="e.g. Smith party"
                        onChange={e => setCard(c => ({ ...c, customer: e.target.value }))}
                      />
                    </label>
                    <div className={styles.fieldLabel}>
                      Covers {card.covers == null ? '(not set)' : ''}
                      {card.covers != null && (
                        <button type="button" className={styles.linkBtn} onClick={() => setCard(c => ({ ...c, covers: null }))}>clear</button>
                      )}
                    </div>
                    {stepper(card.covers, n => setCard(c => ({ ...c, covers: n })))}
                  </>
                )}

                <div className={styles.fieldLabel}>Order so far</div>
                <div className={styles.items}>
                  {cardTab.items.length
                    ? cardTab.items.map((i, idx) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={idx} className={styles.itemRow}>
                        <span>{saleLineText(i)}</span>
                        <span>{fmt(lineAmount(i))}</span>
                      </div>
                    ))
                    : <div className={styles.empty}>Nothing ordered yet.</div>}
                </div>

                <button type="button" className={styles.primary} onClick={goToOrder}>Open order</button>
                <button type="button" className={styles.skip} onClick={() => { saveCard(); showToast?.('Saved'); setCard(null) }}>Save changes</button>
                {card.mode === 'open' && (
                  <div className={styles.pair}>
                    <button type="button" className={styles.skip} onClick={() => { saveCard(); openSplit(card.tabId); setCard(null) }}>Split the bill</button>
                    <button type="button" className={styles.skip} onClick={() => { saveCard(); openDiscount(card.tabId); setCard(null) }}>Discount / comp</button>
                    <button type="button" className={styles.skip} onClick={() => { saveCard(); setPick({ kind: 'move', tabId: card.tabId }); setCard(null) }}>Move to another table</button>
                    <button type="button" className={styles.skip} onClick={() => { saveCard(); setPick({ kind: 'merge', tabId: card.tabId }); setCard(null) }}>Merge with another table</button>
                  </div>
                )}
              </>
            )}

            <button type="button" className={styles.cancel} onClick={() => setCard(null)}>{card.mode === 'confirm' ? 'Cancel' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
