import { useRef, useState } from 'react'
import styles from './FloorPlan.module.css'

// The plan is a canvas 100 units wide and 75 tall (4:3). Positions and sizes are stored in those units,
// so the same plan looks right on any screen.
export const PLAN_W = 100
export const PLAN_H = 75

export const SHAPES = {
  square: { label: 'Square', w: 10, h: 10 },
  round: { label: 'Round', w: 10, h: 10 },
  rect: { label: 'Rectangle', w: 20, h: 9 },
  oval: { label: 'Oval', w: 20, h: 11 },
}

/** Walls and simple structures drawn behind the tables. */
export const STRUCTURE_STYLES = {
  wall: 'Wall',
  bar: 'Bar / counter',
  outline: 'Outline',
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
const pct = (v, total) => `${(v / total) * 100}%`

/**
 * Draws one area: structures (walls etc.) underneath, tables on top.
 * view mode: tables are buttons (onTap); structures are not interactive.
 * edit mode: tables and structures can be dragged and selected; the selected structure has a corner handle to resize.
 */
export default function FloorPlan({
  tables, structures = [], mode = 'view',
  selectedId = null, onSelect, onTap, onMove, renderTile,
  onMoveStructure, onResizeStructure,
}) {
  const ref = useRef(null)
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null) // { id, x, y, w?, h? }
  const editing = mode === 'edit'

  const capture = (e) => {
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* pointer already released */ }
  }

  const start = (e, id, lay, kind) => {
    if (!editing) return
    capture(e)
    dragRef.current = { kind, id, sx: e.clientX, sy: e.clientY, ox: lay.x, oy: lay.y, ow: lay.w, oh: lay.h, moved: false }
    onSelect?.(id, kind)
  }

  const startResize = (e, id, lay) => {
    e.stopPropagation()
    capture(e)
    dragRef.current = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, ox: lay.x, oy: lay.y, ow: lay.w, oh: lay.h, moved: false }
  }

  const move = (e) => {
    const d = dragRef.current
    if (!d || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const dx = ((e.clientX - d.sx) / rect.width) * PLAN_W
    const dy = ((e.clientY - d.sy) / rect.height) * PLAN_H
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.6) return
    d.moved = true
    if (d.kind === 'resize') {
      setDrag({ id: d.id, x: d.ox, y: d.oy, w: clamp(d.ow + dx, 1, PLAN_W - d.ox), h: clamp(d.oh + dy, 1, PLAN_H - d.oy) })
    } else {
      setDrag({ id: d.id, x: clamp(d.ox + dx, 0, PLAN_W - d.ow), y: clamp(d.oy + dy, 0, PLAN_H - d.oh) })
    }
  }

  const end = (item) => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved && drag && drag.id === item.id) {
      if (d.kind === 'resize') onResizeStructure?.(item, snap(drag.w), snap(drag.h))
      else if (d.kind === 'structure') onMoveStructure?.(item, snap(drag.x), snap(drag.y))
      else onMove?.(item, snap(drag.x), snap(drag.y))
    }
    setDrag(null)
  }

  return (
    <div className={styles.scroller}>
      <div ref={ref} className={`${styles.canvas} ${editing ? styles.canvasEdit : ''}`}>
        {structures.map((st) => {
          const lay = { x: Number(st.x) || 0, y: Number(st.y) || 0, w: Number(st.w) || 5, h: Number(st.h) || 2 }
          const live = drag?.id === st.id ? drag : null
          const pos = { x: live ? live.x : lay.x, y: live ? live.y : lay.y }
          const size = { w: live?.w ?? lay.w, h: live?.h ?? lay.h }
          const isSel = editing && selectedId === st.id
          return (
            <div
              key={st.id}
              className={`${styles.structure} ${styles[`st_${st.style}`] || styles.st_wall} ${editing ? styles.editTile : styles.inert} ${isSel ? styles.selected : ''}`}
              style={{ left: pct(pos.x, PLAN_W), top: pct(pos.y, PLAN_H), width: pct(size.w, PLAN_W), height: pct(size.h, PLAN_H) }}
              onPointerDown={e => start(e, st.id, lay, 'structure')}
              onPointerMove={move}
              onPointerUp={() => end(st)}
              onPointerCancel={() => end(st)}
            >
              {st.label ? <span className={styles.structureLabel}>{st.label}</span> : null}
              {isSel && (
                <span
                  className={styles.handle}
                  data-testid="resize-handle"
                  onPointerDown={e => startResize(e, st.id, lay)}
                  onPointerMove={move}
                  onPointerUp={() => end(st)}
                  onPointerCancel={() => end(st)}
                />
              )}
            </div>
          )
        })}
        {tables.map((table, i) => {
          const lay = layoutOf(table, i)
          const pos = drag?.id === table.id ? { x: drag.x, y: drag.y } : { x: lay.x, y: lay.y }
          const round = lay.shape === 'round' || lay.shape === 'oval'
          const content = renderTile(table)
          return (
            <button
              key={table.id}
              type="button"
              className={`${styles.tile} ${content.className || ''} ${round ? styles.round : ''} ${editing ? styles.editTile : ''} ${editing && selectedId === table.id ? styles.selected : ''}`}
              style={{ left: pct(pos.x, PLAN_W), top: pct(pos.y, PLAN_H), width: pct(lay.w, PLAN_W), height: pct(lay.h, PLAN_H) }}
              onClick={() => { if (!editing) onTap?.(table) }}
              onPointerDown={e => start(e, table.id, lay, 'table')}
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
