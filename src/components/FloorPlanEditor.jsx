import { useState } from 'react'
import FloorPlan, { SHAPES, layoutOf, PLAN_W, PLAN_H } from './FloorPlan'
import fp from './FloorPlan.module.css'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Drag tables into place, pick a shape and size. Used from Settings → Tables. */
export default function FloorPlanEditor({ tables, saveFloorTable, showToast }) {
  const [selectedId, setSelectedId] = useState(null)
  const ordered = [...tables].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
  const selected = ordered.find(t => t.id === selectedId) || null
  const selectedIndex = selected ? ordered.indexOf(selected) : -1

  const place = (table, index, patch) => {
    const lay = layoutOf(table, index)
    saveFloorTable({ ...table, x: lay.x, y: lay.y, w: lay.w, h: lay.h, shape: lay.shape, ...patch })
  }

  const setShape = (shape) => {
    if (!selected) return
    const { w, h } = SHAPES[shape]
    const lay = layoutOf(selected, selectedIndex)
    place(selected, selectedIndex, { shape, w, h, x: clamp(lay.x, 0, PLAN_W - w), y: clamp(lay.y, 0, PLAN_H - h) })
  }

  const scale = (factor) => {
    if (!selected) return
    const lay = layoutOf(selected, selectedIndex)
    const w = clamp(Math.round(lay.w * factor * 2) / 2, 6, 40)
    const h = clamp(Math.round(lay.h * factor * 2) / 2, 5, 30)
    place(selected, selectedIndex, { w, h, x: clamp(lay.x, 0, PLAN_W - w), y: clamp(lay.y, 0, PLAN_H - h) })
  }

  const tidy = () => {
    if (!window.confirm('Put every table in this area back into a neat grid? Your positions will be lost.')) return
    ordered.forEach((t, i) => {
      const cols = 7
      saveFloorTable({
        ...t, x: 3 + (i % cols) * 13.6, y: 3 + Math.floor(i / cols) * 12.5, w: 11.5, h: 10, shape: 'square',
      })
    })
    showToast?.('Tables tidied into a grid')
  }

  return (
    <div style={{ margin: '8px 0 16px' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        Drag a table to move it. Tap a table to change its shape or size.
      </div>
      <FloorPlan
        tables={ordered}
        mode="edit"
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={(table, x, y) => place(table, ordered.indexOf(table), { x, y })}
        renderTile={(t) => ({ node: <div className={fp.name}>{t.name}</div> })}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {selected ? (
          <>
            <strong style={{ marginRight: 6 }}>{selected.name}</strong>
            {Object.entries(SHAPES).map(([key, s]) => (
              <button
                key={key}
                type="button"
                onClick={() => setShape(key)}
                style={{ padding: '7px 12px', borderRadius: 14, border: '1px solid var(--border)', background: layoutOf(selected, selectedIndex).shape === key ? 'var(--accent)' : 'var(--white)' }}
              >
                {s.label}
              </button>
            ))}
            <button type="button" onClick={() => scale(0.87)} style={{ padding: '7px 12px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--white)' }}>Smaller</button>
            <button type="button" onClick={() => scale(1.15)} style={{ padding: '7px 12px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--white)' }}>Bigger</button>
          </>
        ) : (
          <span style={{ fontSize: 13, opacity: 0.7 }}>No table selected.</span>
        )}
        <button type="button" onClick={tidy} style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--white)' }}>Tidy into grid</button>
      </div>
    </div>
  )
}
