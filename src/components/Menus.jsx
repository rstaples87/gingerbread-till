import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ManagerGate from './ManagerGate'
import MenuSheet from './MenuSheet'
import {
  MENU_ART, DIET_CODES, uid, blankDoc, ensureIds, docImageSrcs,
  newDish, newSection, newTextBlock, newImageBlock, newLogoBlock, newRow, itemPriceText, formatMenuPrice,
} from '../menuDoc'
import { fmt } from '../utils'
import { POS_FOOD_CATEGORIES, POS_EXTRA_CATEGORIES } from '../data'
import { haywainMenuSeeds } from '../menuSeeds'
import styles from './Menus.module.css'

const MM_PX = 96 / 25.4

function findBlock(doc, id) {
  for (let r = 0; r < doc.rows.length; r++) {
    for (let c = 0; c < doc.rows[r].cols.length; c++) {
      const i = doc.rows[r].cols[c].findIndex(b => b.id === id)
      if (i >= 0) return { r, c, i, block: doc.rows[r].cols[c][i] }
    }
  }
  return null
}

function ProductPicker({ products, onPick, onClose }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    const map = new Map()
    for (const p of products) {
      if (term && !p.name.toLowerCase().includes(term) && !String(p.category).toLowerCase().includes(term)) continue
      if (!map.has(p.category)) map.set(p.category, [])
      map.get(p.category).push(p)
    }
    return [...map.entries()]
  }, [products, q])
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.picker} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHead}>
          <strong>Pick a till item</strong>
          <button type="button" className={styles.linkBtn} onClick={onClose}>Close</button>
        </div>
        <input className={styles.input} autoFocus placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        <div className={styles.pickerList}>
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className={styles.pickerCat}>{cat}</div>
              {list.map(p => (
                <button key={p.id} type="button" className={styles.pickerItem} onClick={() => onPick(p)}>
                  <span>{p.name}</span><span>{fmt(p.price)}</span>
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <div className={styles.muted}>Nothing matches.</div>}
        </div>
      </div>
    </div>
  )
}

function ItemRow({ item, block, idx, count, layoutMode, doc, productById, patch, move, remove, openLink }) {
  const linked = item.productId != null && productById.get(Number(item.productId))
  const toggleDiet = (code) => {
    const has = (item.diet || []).includes(code)
    patch({ diet: has ? item.diet.filter(c => c !== code) : [...(item.diet || []), code] })
  }
  const arrows = (
    <span className={styles.arrows}>
      <button type="button" disabled={idx === 0} onClick={() => move(-1)} aria-label="Move up">▲</button>
      <button type="button" disabled={idx === count - 1} onClick={() => move(1)} aria-label="Move down">▼</button>
      <button type="button" className={styles.del} onClick={remove} aria-label="Remove">✕</button>
    </span>
  )
  if (item.kind === 'heading') {
    return (
      <div className={styles.itemRow}>
        <span className={styles.kind}>Sub-heading</span>
        <input className={styles.input} value={item.name} onChange={e => patch({ name: e.target.value })} />
        {arrows}
      </div>
    )
  }
  if (item.kind === 'note') {
    return (
      <div className={styles.itemRow}>
        <span className={styles.kind}>Text</span>
        <textarea className={styles.input} rows={2} value={item.desc} onChange={e => patch({ desc: e.target.value })} />
        {arrows}
      </div>
    )
  }
  return (
    <div className={styles.itemRow}>
      <div className={styles.itemMain}>
        <div className={styles.itemLine}>
          <input className={`${styles.input} ${styles.grow}`} placeholder="Dish name" value={item.name} onChange={e => patch({ name: e.target.value })} />
          {linked ? (
            <span className={styles.linked} title="Price comes from the till">
              🔗 {itemPriceText(item, productById, doc.priceFormat)}
              <button type="button" className={styles.linkBtn} onClick={() => patch({ productId: null, price: formatMenuPrice(linked.price, doc.priceFormat) })}>unlink</button>
            </span>
          ) : (
            <>
              <input className={`${styles.input} ${styles.price}`} placeholder="Price" value={item.price || ''} onChange={e => patch({ price: e.target.value })} />
              <button type="button" className={styles.linkBtn} onClick={openLink}>🔗 link to till</button>
            </>
          )}
          {arrows}
        </div>
        <textarea className={styles.input} rows={item.desc && item.desc.length > 60 ? 2 : 1} placeholder="Description (optional)" value={item.desc || ''} onChange={e => patch({ desc: e.target.value })} />
        <div className={styles.dietRow}>
          {DIET_CODES.map(code => (
            <button key={code} type="button" className={`${styles.chip} ${(item.diet || []).includes(code) ? styles.chipOn : ''}`} onClick={() => toggleDiet(code)}>{code}</button>
          ))}
          {layoutMode && (
            <label className={styles.check}>
              <input type="checkbox" checked={!!item.plain} onChange={e => patch({ plain: e.target.checked })} /> not bold
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

const NEW_DISH_CATEGORIES = [...POS_FOOD_CATEGORIES, ...POS_EXTRA_CATEGORIES, 'Hot Drinks']

function NewDishSheet({ form, setForm, onSave, onClose }) {
  const toggleDiet = (code) => setForm(f => ({ ...f, diet: f.diet.includes(code) ? f.diet.filter(c => c !== code) : [...f.diet, code] }))
  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.picker} onClick={e => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave() }}>
        <div className={styles.pickerHead}><strong>New dish</strong><button type="button" className={styles.linkBtn} onClick={onClose}>Cancel</button></div>
        <input className={styles.input} autoFocus placeholder="Dish name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <textarea className={styles.input} rows={2} placeholder="Description (optional)" value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} />
        <div className={styles.dietRow}>
          {DIET_CODES.map(code => (
            <button key={code} type="button" className={`${styles.chip} ${form.diet.includes(code) ? styles.chipOn : ''}`} onClick={() => toggleDiet(code)}>{code}</button>
          ))}
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={form.alsoTill} onChange={e => setForm(f => ({ ...f, alsoTill: e.target.checked }))} />
          Also add it to the till (so it can be sold)
        </label>
        <div className={styles.itemLine}>
          <input className={`${styles.input} ${styles.price}`} type="number" min="0" step="0.01" placeholder="Price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          {form.alsoTill && (
            <select className={`${styles.input} ${styles.grow}`} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {NEW_DISH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div className={styles.muted}>
          {form.alsoTill
            ? 'It appears on the till under the category above, and the menu takes its price from the till.'
            : 'Menu only — it will print, but it can\'t be rung through the till.'}
        </div>
        <button type="submit" className={styles.primary}>Add dish</button>
      </form>
    </div>
  )
}

export default function Menus({
  menuDocs = [], saveMenuDoc, deleteMenuDoc, products = [], saveProduct,
  managerUnlocked, verifyManagerPin, unlockManager,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null) // { id, name, sort, doc }
  const [wantLayout, setWantLayout] = useState(false)
  const [newDishForm, setNewDishForm] = useState(null) // { blockId, name, desc, price, category, diet, alsoTill }
  const [picker, setPicker] = useState(null) // { mode: 'item'|'link'|'heading', blockId, itemId? }
  const [saveNote, setSaveNote] = useState('')
  const [printing, setPrinting] = useState(false)
  const [overBy, setOverBy] = useState(0)
  const [scale, setScale] = useState(0.6)

  const dirtyRef = useRef(false)
  const timerRef = useRef(null)
  const pendingRef = useRef(null)
  const stageRef = useRef(null)
  const sheetRef = useRef(null)
  const draftRef = useRef(null)

  draftRef.current = draft
  const layoutMode = wantLayout && managerUnlocked
  const productById = useMemo(() => new Map(products.map(p => [Number(p.id), p])), [products])

  const flush = useCallback(() => {
    clearTimeout(timerRef.current)
    if (pendingRef.current) {
      saveMenuDoc(pendingRef.current)
      pendingRef.current = null
      dirtyRef.current = false
      setSaveNote('Saved')
    }
  }, [saveMenuDoc])

  useEffect(() => () => flush(), [flush])

  useEffect(() => {
    if (!menuDocs.length) return
    if (!selectedId || !menuDocs.some(m => m.id === selectedId)) setSelectedId(menuDocs[0].id)
  }, [menuDocs, selectedId])

  useEffect(() => {
    if (dirtyRef.current) return
    const entry = menuDocs.find(m => m.id === selectedId)
    setDraft(entry ? { ...entry, doc: ensureIds(entry.doc?.rows ? entry.doc : blankDoc()) } : null)
  }, [menuDocs, selectedId])

  const commit = useCallback((next) => {
    setDraft(next)
    dirtyRef.current = true
    pendingRef.current = next
    setSaveNote('Saving…')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flush(), 900)
  }, [flush])

  const edit = (fn) => {
    const next = structuredClone(draft)
    fn(next.doc, next)
    commit(next)
  }

  const selectMenu = (id) => { flush(); dirtyRef.current = false; setSelectedId(id) }

  const createMenu = (source) => {
    flush()
    const name = window.prompt('Name for the new menu?', source ? `${source.name} copy` : 'New menu')
    if (!name || !name.trim()) return
    const doc = source ? ensureIds(structuredClone(source.doc)) : blankDoc()
    if (source) {
      // A copy needs fresh ids so both menus can be edited independently.
      doc.rows = doc.rows.map(r => ({ ...r, id: uid(), cols: r.cols.map(col => col.map(b => ({ ...b, id: uid(), ...(b.items ? { items: b.items.map(it => ({ ...it, id: uid() })) } : {}) }))) }))
    }
    const saved = saveMenuDoc({ name: name.trim(), sort: (menuDocs.at(-1)?.sort ?? 0) + 1, doc })
    dirtyRef.current = false
    setSelectedId(saved.id)
  }

  // --- structural edits (layout mode) -------------------------------------------------
  const withBlock = (id, fn) => edit(doc => { const f = findBlock(doc, id); if (f) fn(f.block, f, doc) })
  const moveBlock = (id, dir) => edit(doc => {
    const f = findBlock(doc, id); if (!f) return
    const col = doc.rows[f.r].cols[f.c]
    const j = f.i + dir
    if (j < 0 || j >= col.length) return
    ;[col[f.i], col[j]] = [col[j], col[f.i]]
  })
  const shiftBlock = (id, dir) => edit(doc => {
    const f = findBlock(doc, id); if (!f) return
    const row = doc.rows[f.r]
    const to = f.c + dir
    if (to < 0 || to >= row.cols.length) return
    row.cols[f.c].splice(f.i, 1)
    row.cols[to].push(f.block)
  })
  const removeBlock = (id) => {
    if (!window.confirm('Remove this block from the menu?')) return
    edit(doc => { const f = findBlock(doc, id); if (f) doc.rows[f.r].cols[f.c].splice(f.i, 1) })
  }
  const addBlock = (r, c, maker) => edit(doc => { doc.rows[r].cols[c].push(maker()) })
  const moveRow = (r, dir) => edit(doc => {
    const j = r + dir
    if (j < 0 || j >= doc.rows.length) return
    ;[doc.rows[r], doc.rows[j]] = [doc.rows[j], doc.rows[r]]
  })
  const setRowCols = (r, n) => edit(doc => {
    const row = doc.rows[r]
    while (row.cols.length < n) row.cols.push([])
    while (row.cols.length > n) { const extra = row.cols.pop(); row.cols[row.cols.length - 1].push(...extra) }
  })
  const removeRow = (r) => {
    if (!window.confirm('Remove this whole row and everything in it?')) return
    edit(doc => { doc.rows.splice(r, 1) })
  }

  // --- item edits -------------------------------------------------------------------------
  const patchItem = (blockId, itemId, patch) => withBlock(blockId, b => { const it = b.items.find(x => x.id === itemId); if (it) Object.assign(it, patch) })
  const moveItem = (blockId, idx, dir) => withBlock(blockId, b => {
    const j = idx + dir
    if (j < 0 || j >= b.items.length) return
    ;[b.items[idx], b.items[j]] = [b.items[j], b.items[idx]]
  })
  const removeItem = (blockId, idx) => withBlock(blockId, b => { b.items.splice(idx, 1) })
  const addItem = (blockId, item) => withBlock(blockId, b => { b.items.push(item) })

  const openNewDish = (block) => {
    const guess = NEW_DISH_CATEGORIES.find(c => c.toLowerCase() === String(block.title || '').trim().toLowerCase())
    setNewDishForm({ blockId: block.id, name: '', desc: '', price: '', category: guess || NEW_DISH_CATEGORIES[1], diet: [], alsoTill: !!saveProduct })
  }
  const saveNewDish = () => {
    const f = newDishForm
    const name = f.name.trim()
    if (!name) return
    if (f.alsoTill) {
      const price = Number(f.price)
      if (f.price === '' || Number.isNaN(price) || price < 0) return
      const id = Math.max(0, ...products.map(p => Number(p.id) || 0)) + 1
      saveProduct({ id, name, price, category: f.category, stock: 0, vatRate: 20, group: 'food' }, null)
      addItem(f.blockId, newDish({ name, desc: f.desc.trim(), diet: f.diet, productId: id }))
    } else {
      addItem(f.blockId, newDish({ name, desc: f.desc.trim(), diet: f.diet, price: f.price.trim() }))
    }
    setNewDishForm(null)
  }

  const onPick = (p) => {
    if (!picker) return
    if (picker.mode === 'item') addItem(picker.blockId, newDish({ name: p.name, productId: p.id }))
    else if (picker.mode === 'link') patchItem(picker.blockId, picker.itemId, { productId: p.id, price: '' })
    else if (picker.mode === 'heading') withBlock(picker.blockId, b => { b.headingPriceProductId = p.id; b.headingPrice = '' })
    setPicker(null)
  }

  // --- preview scale + "fits one page" check --------------------------------------------------
  const landscape = draft?.doc?.orientation === 'landscape'
  const sheetW = (landscape ? 297 : 210) * MM_PX
  const pageH = (landscape ? 210 : 297) * MM_PX
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setScale(Math.min(1, Math.max(0.3, (el.clientWidth - 8) / sheetW))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheetW, draft?.id])
  useLayoutEffect(() => {
    const el = sheetRef.current
    if (el) setOverBy(Math.max(0, Math.round(el.scrollHeight - pageH)))
  }, [draft, pageH, products])

  // --- printing ---------------------------------------------------------------------------------------
  useEffect(() => {
    if (!printing || !draftRef.current) return undefined
    let cancelled = false
    const srcs = docImageSrcs(draftRef.current.doc)
    const finish = () => {
      document.body.classList.remove('printing-menu')
      setPrinting(false)
    }
    Promise.race([
      Promise.all(srcs.map(src => new Promise(res => { const im = new Image(); im.onload = im.onerror = res; im.src = src }))),
      new Promise(res => setTimeout(res, 2500)),
    ]).then(() => {
      if (cancelled) return
      document.body.classList.add('printing-menu')
      window.addEventListener('afterprint', finish, { once: true })
      setTimeout(() => window.print(), 60)
    })
    return () => { cancelled = true; window.removeEventListener('afterprint', finish) }
  }, [printing])

  const doPrint = () => { flush(); setPrinting(true) }

  const doc = draft?.doc

  if (!menuDocs.length) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <p>No menus yet.</p>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.primary} onClick={() => { haywainMenuSeeds().forEach(m => saveMenuDoc(m)) }}>Load the Haywain menus</button>
            <button type="button" className={styles.addBtn} onClick={() => createMenu(null)}>Start a blank menu</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <div className={styles.menuTabs}>
          {menuDocs.map(m => (
            <button key={m.id} type="button" className={`${styles.menuTab} ${m.id === selectedId ? styles.menuTabOn : ''}`} onClick={() => selectMenu(m.id)}>{m.name}</button>
          ))}
        </div>
        <div className={styles.topActions}>
          <span className={styles.saveNote}>{saveNote}</span>
          <label className={styles.check}>
            <input type="checkbox" checked={wantLayout} onChange={e => setWantLayout(e.target.checked)} /> Edit layout
          </label>
          <button type="button" className={styles.primary} onClick={doPrint} disabled={!draft}>🖨 Print</button>
        </div>
      </div>

      {wantLayout && !managerUnlocked && (
        <div className={styles.gateBox}>
          <ManagerGate unlocked={false} verifyPin={verifyManagerPin} onUnlock={unlockManager} title="Manager PIN: edit menu layout" />
          <button type="button" className={styles.linkBtn} onClick={() => setWantLayout(false)}>Cancel</button>
        </div>
      )}

      {draft && doc && (
        <div className={styles.split}>
          <div className={styles.editor}>
            {layoutMode && (
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <input className={`${styles.input} ${styles.grow}`} value={draft.name} onChange={e => { const next = structuredClone(draft); next.name = e.target.value; commit(next) }} aria-label="Menu name" />
                  <button type="button" className={styles.linkBtn} onClick={() => createMenu(draft)}>Duplicate</button>
                  <button type="button" className={`${styles.linkBtn} ${styles.danger}`} onClick={() => { if (window.confirm(`Delete the ${draft.name} menu?`)) { dirtyRef.current = false; pendingRef.current = null; deleteMenuDoc(draft.id) } }}>Delete</button>
                </div>
                <div className={styles.settings}>
                  <label>Paper
                    <select className={styles.input} value={doc.orientation} onChange={e => edit(d => { d.orientation = e.target.value })}>
                      <option value="portrait">A4 portrait</option>
                      <option value="landscape">A4 landscape</option>
                    </select>
                  </label>
                  <label>Text size (pt)
                    <input className={styles.input} type="number" min="7" max="16" step="0.5" value={doc.fontSize} onChange={e => edit(d => { d.fontSize = Number(e.target.value) || 10.5 })} />
                  </label>
                  <label>Prices
                    <select className={styles.input} value={doc.priceFormat} onChange={e => edit(d => { d.priceFormat = e.target.value })}>
                      <option value="trim">8.5, 20</option>
                      <option value="2dp">8.50, 20</option>
                    </select>
                  </label>
                  <label>Dietary tags
                    <select className={styles.input} value={doc.dietaryStyle} onChange={e => edit(d => { d.dietaryStyle = e.target.value })}>
                      <option value="colour">Coloured</option>
                      <option value="muted">Small grey</option>
                    </select>
                  </label>
                  <label>Logo
                    <select className={styles.input} value={doc.header.logo} onChange={e => edit(d => { d.header.logo = e.target.value })}>
                      <option value="center">Centre</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                  <label>Title style
                    <select className={styles.input} value={doc.header.titleStyle} onChange={e => edit(d => { d.header.titleStyle = e.target.value })}>
                      <option value="plain">Plain</option>
                      <option value="hand">Handwritten</option>
                    </select>
                  </label>
                </div>
                <label className={styles.stack}>Title (top of page)
                  <textarea className={styles.input} rows={2} value={doc.header.title} onChange={e => edit(d => { d.header.title = e.target.value })} />
                </label>
                <label className={styles.stack}>Header text (beside the logo)
                  <textarea className={styles.input} rows={3} value={doc.header.text} onChange={e => edit(d => { d.header.text = e.target.value })} />
                </label>
              </div>
            )}

            <div className={styles.card}>
              <label className={styles.stack}>Footer text
                <textarea className={styles.input} rows={2} value={doc.footer} onChange={e => edit(d => { d.footer = e.target.value })} />
              </label>
            </div>

            {doc.rows.map((row, r) => (
              <div key={row.id} className={styles.rowBox}>
                {layoutMode && (
                  <div className={styles.rowHead}>
                    <strong>Row {r + 1}</strong>
                    <label className={styles.check}>Columns
                      <select className={styles.input} value={row.cols.length} onChange={e => setRowCols(r, Number(e.target.value))}>
                        <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                      </select>
                    </label>
                    <span className={styles.arrows}>
                      <button type="button" disabled={r === 0} onClick={() => moveRow(r, -1)}>▲</button>
                      <button type="button" disabled={r === doc.rows.length - 1} onClick={() => moveRow(r, 1)}>▼</button>
                      <button type="button" className={styles.del} onClick={() => removeRow(r)}>✕</button>
                    </span>
                  </div>
                )}
                <div className={styles.cols}>
                  {row.cols.map((col, c) => (
                    <div key={c} className={styles.colBox}>
                      {layoutMode && row.cols.length > 1 && <div className={styles.colLabel}>Column {c + 1}</div>}
                      {col.map((b, i) => (
                        <div key={b.id} className={styles.card}>
                          {layoutMode && (
                            <div className={styles.blockTools}>
                              <button type="button" disabled={c === 0} onClick={() => shiftBlock(b.id, -1)} aria-label="Move to left column">◀</button>
                              <button type="button" disabled={c === row.cols.length - 1} onClick={() => shiftBlock(b.id, 1)} aria-label="Move to right column">▶</button>
                              <button type="button" disabled={i === 0} onClick={() => moveBlock(b.id, -1)}>▲</button>
                              <button type="button" disabled={i === col.length - 1} onClick={() => moveBlock(b.id, 1)}>▼</button>
                              <button type="button" className={styles.del} onClick={() => removeBlock(b.id)}>✕</button>
                            </div>
                          )}
                          {b.type === 'section' && (
                            <>
                              <div className={styles.itemLine}>
                                <input className={`${styles.input} ${styles.grow} ${styles.sectionTitle}`} placeholder="Section title" value={b.title} onChange={e => withBlock(b.id, x => { x.title = e.target.value })} />
                                {b.headingPriceProductId != null && productById.get(Number(b.headingPriceProductId)) ? (
                                  <span className={styles.linked}>🔗 {formatMenuPrice(productById.get(Number(b.headingPriceProductId)).price, doc.priceFormat)}
                                    <button type="button" className={styles.linkBtn} onClick={() => withBlock(b.id, x => { x.headingPrice = formatMenuPrice(productById.get(Number(x.headingPriceProductId))?.price, doc.priceFormat); x.headingPriceProductId = null })}>unlink</button>
                                  </span>
                                ) : (
                                  <>
                                    <input className={`${styles.input} ${styles.price}`} placeholder="Heading price" value={b.headingPrice || ''} onChange={e => withBlock(b.id, x => { x.headingPrice = e.target.value })} />
                                    <button type="button" className={styles.linkBtn} onClick={() => setPicker({ mode: 'heading', blockId: b.id })}>🔗</button>
                                  </>
                                )}
                              </div>
                              <textarea className={styles.input} rows={1} placeholder="Intro line under the title (optional)" value={b.note || ''} onChange={e => withBlock(b.id, x => { x.note = e.target.value })} />
                              {layoutMode && (
                                <div className={styles.styleRow}>
                                  <label className={styles.check}><input type="checkbox" checked={!!b.boxed} onChange={e => withBlock(b.id, x => { x.boxed = e.target.checked })} /> Box</label>
                                  <label className={styles.check}><input type="checkbox" checked={b.align === 'center'} onChange={e => withBlock(b.id, x => { x.align = e.target.checked ? 'center' : 'left' })} /> Centred</label>
                                  <label className={styles.check}><input type="checkbox" checked={b.priceLayout === 'right'} onChange={e => withBlock(b.id, x => { x.priceLayout = e.target.checked ? 'right' : 'inline' })} /> Prices on right</label>
                                  <label className={styles.check}><input type="checkbox" checked={!!b.sideTitle} onChange={e => withBlock(b.id, x => { x.sideTitle = e.target.checked })} /> Title down the side</label>
                                </div>
                              )}
                              {b.items.map((it, idx) => (
                                <ItemRow
                                  key={it.id}
                                  item={it}
                                  block={b}
                                  idx={idx}
                                  count={b.items.length}
                                  layoutMode={layoutMode}
                                  doc={doc}
                                  productById={productById}
                                  patch={(p) => patchItem(b.id, it.id, p)}
                                  move={(d) => moveItem(b.id, idx, d)}
                                  remove={() => removeItem(b.id, idx)}
                                  openLink={() => setPicker({ mode: 'link', blockId: b.id, itemId: it.id })}
                                />
                              ))}
                              <div className={styles.addRow}>
                                <button type="button" className={styles.addBtn} onClick={() => setPicker({ mode: 'item', blockId: b.id })}>+ Dish from till</button>
                                <button type="button" className={styles.addBtn} onClick={() => openNewDish(b)}>+ New dish</button>
                                <button type="button" className={styles.addBtn} onClick={() => addItem(b.id, { id: uid(), kind: 'heading', name: 'Sub-heading' })}>+ Sub-heading</button>
                                <button type="button" className={styles.addBtn} onClick={() => addItem(b.id, { id: uid(), kind: 'note', desc: '' })}>+ Text line</button>
                              </div>
                            </>
                          )}
                          {b.type === 'text' && (
                            <>
                              <textarea className={styles.input} rows={3} value={b.text} onChange={e => withBlock(b.id, x => { x.text = e.target.value })} />
                              {layoutMode && (
                                <div className={styles.styleRow}>
                                  <label className={styles.check}><input type="checkbox" checked={!!b.boxed} onChange={e => withBlock(b.id, x => { x.boxed = e.target.checked })} /> Box</label>
                                  <label className={styles.check}><input type="checkbox" checked={b.align === 'center'} onChange={e => withBlock(b.id, x => { x.align = e.target.checked ? 'center' : 'left' })} /> Centred</label>
                                  <label className={styles.check}><input type="checkbox" checked={!!b.bold} onChange={e => withBlock(b.id, x => { x.bold = e.target.checked })} /> Bold</label>
                                </div>
                              )}
                            </>
                          )}
                          {b.type === 'image' && (
                            <div className={styles.itemLine}>
                              <span className={styles.kind}>Picture</span>
                              <select className={styles.input} value={b.art} onChange={e => withBlock(b.id, x => { x.art = e.target.value })}>
                                {Object.entries(MENU_ART).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
                              </select>
                              <label className={styles.check}>Width %
                                <input className={`${styles.input} ${styles.price}`} type="number" min="10" max="100" value={b.width ?? 100} onChange={e => withBlock(b.id, x => { x.width = Number(e.target.value) || 100 })} />
                              </label>
                            </div>
                          )}
                          {b.type === 'logo' && (
                            <div className={styles.itemLine}>
                              <span className={styles.kind}>Logo</span>
                              <label className={styles.check}>Width %
                                <input className={`${styles.input} ${styles.price}`} type="number" min="10" max="100" value={b.width ?? 100} onChange={e => withBlock(b.id, x => { x.width = Number(e.target.value) || 100 })} />
                              </label>
                            </div>
                          )}
                        </div>
                      ))}
                      {layoutMode && (
                        <div className={styles.addRow}>
                          <button type="button" className={styles.addBtn} onClick={() => addBlock(r, c, newSection)}>+ Section</button>
                          <button type="button" className={styles.addBtn} onClick={() => addBlock(r, c, newTextBlock)}>+ Text</button>
                          <button type="button" className={styles.addBtn} onClick={() => addBlock(r, c, newImageBlock)}>+ Picture</button>
                          <button type="button" className={styles.addBtn} onClick={() => addBlock(r, c, newLogoBlock)}>+ Logo</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {layoutMode && (
              <button type="button" className={styles.addBtn} onClick={() => edit(d => { d.rows.push(newRow(1)) })}>+ Add a row</button>
            )}
          </div>

          <div className={styles.previewPane}>
            <div className={styles.fit}>
              {overBy > 6
                ? <span className={styles.over}>⚠ Runs over one page — make the text size smaller{layoutMode ? '' : ' (Edit layout)'} or remove something</span>
                : <span className={styles.ok}>✓ Fits on one A4 page</span>}
            </div>
            <div ref={stageRef} className={styles.stage}>
              <div style={{ width: sheetW * scale, height: Math.max(pageH, sheetRef.current?.scrollHeight ?? pageH) * scale }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: sheetW }}>
                  <div className={styles.paper}><MenuSheet doc={doc} products={products} sheetRef={sheetRef} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {newDishForm && <NewDishSheet form={newDishForm} setForm={setNewDishForm} onSave={saveNewDish} onClose={() => setNewDishForm(null)} />}
      {picker && <ProductPicker products={products} onPick={onPick} onClose={() => setPicker(null)} />}

      {printing && draft && createPortal(
        <div className={`menuPrintRoot ${landscape ? 'menuPageLandscape' : 'menuPagePortrait'}`}>
          <MenuSheet doc={doc} products={products} />
        </div>,
        document.body,
      )}
    </div>
  )
}
