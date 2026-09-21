import { useEffect, useState } from 'react'
import FloorPlan, { SHAPES, STRUCTURE_STYLES, layoutOf, PLAN_W, PLAN_H } from './FloorPlan'
import fp from './FloorPlan.module.css'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pill = (on) => ({ padding: '7px 12px', borderRadius: 14, border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--white)' })

/** Drag tables and structures (walls, bar...) into place, pick shapes and sizes. Used from Settings → Tables. */
export default function FloorPlanEditor({ areaId, tables, structures = [], saveFloorTable, saveFloorShape, deleteFloorShape, showToast }) {
  const [sel, setSel] = useState(null) // { id, kind: 'table' | 'structure' }
  const ordered = [...tables].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
  const table = sel?.kind === 'table' ? ordered.find(t => t.id === sel.id) : null
  const tableIndex = table ? ordered.indexOf(table) : -1
  const structure = sel?.kind === 'structure' ? structures.find(s => s.id === sel.id) : null

  const [labelDraft, setLabelDraft] = useState('')
  useEffect(() => { setLabelDraft(structure?.label || '') }, [structure?.id, structure?.label])

  // ---- tables ----
  const place = (t, index, patch) => {
    const lay = layoutOf(t, index)
    saveFloorTable({ ...t, x: lay.x, y: lay.y, w: lay.w, h: lay.h, shape: lay.shape, ...patch })
  }
  const setShape = (shape) => {
    if (!table) return
    const { w, h } = SHAPES[shape]
    const lay = layoutOf(table, tableIndex)
    place(table, tableIndex, { shape, w, h, x: clamp(lay.x, 0, PLAN_W - w), y: clamp(lay.y, 0, PLAN_H - h) })
  }
  const scale = (factor) => {
    if (!table) return
    const lay = layoutOf(table, tableIndex)
    const w = clamp(Math.round(lay.w * factor * 2) / 2, 6, 40)
    const h = clamp(Math.round(lay.h * factor * 2) / 2, 5, 30)
    place(table, tableIndex, { w, h, x: clamp(lay.x, 0, PLAN_W - w), y: clamp(lay.y, 0, PLAN_H - h) })
  }
  const tidy = () => {
    if (!window.confirm('Put every table in this area back into a neat grid? Your table positions will be lost (walls stay).')) return
    ordered.forEach((t, i) => {
      const cols = 7
      saveFloorTable({ ...t, x: 3 + (i % cols) * 13.6, y: 3 + Math.floor(i / cols) * 12.5, w: 11.5, h: 10, shape: 'square' })
    })
    showToast?.('Tables tidied into a grid')
  }

  // ---- structures ----
  const addStructure = () => {
    const row = saveFloorShape({ areaId, x: 30, y: 30, w: 24, h: 2, label: '', style: 'wall' })
    if (row) setSel({ id: row.id, kind: 'structure' })
  }
  const resize = (dw, dh) => {
    if (!structure) return
    const w = clamp(Number(structure.w) + dw, 1, PLAN_W - Number(structure.x))
    const h = clamp(Number(structure.h) + dh, 1, PLAN_H - Number(structure.y))
    saveFloorShape({ ...structure, w, h })
  }
  const commitLabel = () => {
    if (structure && labelDraft !== (structure.label || '')) saveFloorShape({ ...structure, label: labelDraft.trim() })
  }

  return (
    <div style={{ margin: '8px 0 16px' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        Drag to move. Tap a table or a wall to change it. A selected wall has a square handle in its corner: drag it to resize.
      </div>
      <FloorPlan
        tables={ordered}
        structures={structures}
        mode="edit"
        selectedId={sel?.id}
        onSelect={(id, kind) => setSel({ id, kind })}
        onMove={(t, x, y) => place(t, ordered.indexOf(t), { x, y })}
        onMoveStructure={(st, x, y) => saveFloorShape({ ...st, x, y })}
        onResizeStructure={(st, w, h) => saveFloorShape({ ...st, w, h })}
        renderTile={(t) => ({ node: <div className={fp.name}>{t.name}</div> })}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {table && (
          <>
            <strong style={{ marginRight: 6 }}>Table {table.name}</strong>
            {Object.entries(SHAPES).map(([key, s]) => (
              <button key={key} type="button" onClick={() => setShape(key)} style={pill(layoutOf(table, tableIndex).shape === key)}>{s.label}</button>
            ))}
            <button type="button" onClick={() => scale(0.87)} style={pill(false)}>Smaller</button>
            <button type="button" onClick={() => scale(1.15)} style={pill(false)}>Bigger</button>
          </>
        )}
        {structure && (
          <>
            <strong style={{ marginRight: 6 }}>Wall / structure</strong>
            {Object.entries(STRUCTURE_STYLES).map(([key, label]) => (
              <button key={key} type="button" onClick={() => saveFloorShape({ ...structure, style: key })} style={pill(structure.style === key)}>{label}</button>
            ))}
            <button type="button" onClick={() => resize(2, 0)} style={pill(false)}>Wider</button>
            <button type="button" onClick={() => resize(-2, 0)} style={pill(false)}>Narrower</button>
            <button type="button" onClick={() => resize(0, 1)} style={pill(false)}>Taller</button>
            <button type="button" onClick={() => resize(0, -1)} style={pill(false)}>Shorter</button>
            <input
              value={labelDraft}
              onChange={e => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitLabel() } }}
              placeholder="Label (optional, e.g. Bar)"
              maxLength={30}
              style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 10, minWidth: 160 }}
            />
            <button
              type="button"
              onClick={() => { deleteFloorShape(structure.id); setSel(null) }}
              style={{ ...pill(false), color: 'var(--red)' }}
            >
              Delete
            </button>
          </>
        )}
        {!table && !structure && <span style={{ fontSize: 13, opacity: 0.7 }}>Nothing selected.</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" onClick={addStructure} style={pill(false)}>+ Wall / structure</button>
          <button type="button" onClick={tidy} style={pill(false)}>Tidy tables into grid</button>
        </span>
      </div>
    </div>
  )
}
