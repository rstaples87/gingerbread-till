import { useRef, useState } from 'react'
import styles from './FloorPlan.module.css'

// The plan is a canvas 100 units wide and 75 tall (4:3). Table positions and sizes are stored in those units,
// so the same plan looks right on any screen.
export const PLAN_W = 100
export const PLAN_H = 75

export const SHAPES = {
  square: { label: 'Square', w: 10, h: 10 },
  round: { label: 'Round', w: 10, h: 10 },
  rect: { label: 'Rectangle', w: 20, h: 9 },
  oval: { label: 'Oval', w: 20, h: 11 },
}

/** Where a table sits. Tables that have never been placed are laid out in a neat grid until someone edits the plan. */
export function layoutOf(table, index) {
  if (table.x != null && table.y != null) {
    const shape = SHAPES[table.shape] ? table.shape : 'square'
    return { x: Number(table.x), y: Number(table.y), w: Number(table.w) || SHAPES[shape].w, h: Number(table.h) || SHAPES[shape].h, shape }
  }
  const cols = 7
  return { x: 3 + (index % cols) * 13.6, y: 3 + Math.floor(index / cols) * 12.5, w: 11.5, h: 10, shape: 'square' }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const snap = v => Math.round(v * 2) / 2

/**
 * Draws one area's tables at their positions.
 * view mode: tiles are buttons (onTap). edit mode: tiles can be dragged (onMove) and selected (onSelect).
 */
export default function FloorPlan({ tables, mode = 'view', selectedId = null, onSelect, onTap, onMove, renderTile }) {
  const ref = useRef(null)
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null) // { id, x, y }
  const editing = mode === 'edit'

  const start = (e, table, lay) => {
    if (!editing) return
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* pointer already released */ }
    dragRef.current = { id: table.id, sx: e.clientX, sy: e.clientY, ox: lay.x, oy: lay.y, w: lay.w, h: lay.h, moved: false }
    onSelect?.(table.id)
  }

  const move = (e) => {
    const d = dragRef.current
    if (!d || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const dx = ((e.clientX - d.sx) / rect.width) * PLAN_W
    const dy = ((e.clientY - d.sy) / rect.height) * PLAN_H
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.6) return
    d.moved = true
    setDrag({ id: d.id, x: clamp(d.ox + dx, 0, PLAN_W - d.w), y: clamp(d.oy + dy, 0, PLAN_H - d.h) })
  }

  const end = (table) => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved && drag && drag.id === table.id) onMove?.(table, snap(drag.x), snap(drag.y))
    setDrag(null)
  }

  return (
    <div className={styles.scroller}>
      <div ref={ref} className={`${styles.canvas} ${editing ? styles.canvasEdit : ''}`}>
        {tables.map((table, i) => {
          const lay = layoutOf(table, i)
          const pos = drag?.id === table.id ? { x: drag.x, y: drag.y } : { x: lay.x, y: lay.y }
          const round = lay.shape === 'round' || lay.shape === 'oval'
          const content = renderTile(table)
          return (
            <button
              key={table.id}
              type="button"
              className={`${styles.tile} ${content.className || ''} ${round ? styles.round : ''} ${editing ? styles.editTile : ''} ${selectedId === table.id ? styles.selected : ''}`}
              style={{
                left: `${(pos.x / PLAN_W) * 100}%`,
                top: `${(pos.y / PLAN_H) * 100}%`,
                width: `${(lay.w / PLAN_W) * 100}%`,
                height: `${(lay.h / PLAN_H) * 100}%`,
              }}
              onClick={() => { if (!editing) onTap?.(table) }}
              onPointerDown={e => start(e, table, lay)}
              onPointerMove={move}
              onPointerUp={() => end(table)}
              onPointerCancel={() => end(table)}
            >
              {content.node}
            </button>
          )
        })}
      </div>
    </div>
  )
}
