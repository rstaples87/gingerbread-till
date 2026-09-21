import { useRef, useState } from 'react'
import styles from './FloorPlan.module.css'

// The plan is a canvas 100 units wide and 75 tall (4:3). Positions and sizes are stored in those units,
// so the same plan looks right on any screen. Rotation (degrees, clockwise) turns an item about its centre.
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

/** Keep an angle in 0..359. */
export const normRot = (deg) => ((Math.round(deg) % 360) + 360) % 360

/** Where a table sits. Tables that have never been placed are laid out in a neat grid until someone edits the plan. */
export function layoutOf(table, index) {
  if (table.x != null && table.y != null) {
    const shape = SHAPES[table.shape] ? table.shape : 'square'
    return {
      x: Number(table.x), y: Number(table.y),
      w: Number(table.w) || SHAPES[shape].w, h: Number(table.h) || SHAPES[shape].h,
      shape, rot: Number(table.rot) || 0,
    }
  }
  const cols = 7
  return { x: 3 + (index % cols) * 13.6, y: 3 + Math.floor(index / cols) * 12.5, w: 11.5, h: 10, shape: 'square', rot: Number(table.rot) || 0 }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const snap = v => Math.round(v * 2) / 2
const pct = (v, total) => `${(v / total) * 100}%`

/**
 * New size for a rotated box, keeping its top-left corner (as the user sees it) where it is.
 * box: { x, y, w, h, rot }. Returns { x, y, w, h } — the new unrotated box.
 */
export function resizeKeepingCorner(box, w, h) {
  const r = ((Number(box.rot) || 0) * Math.PI) / 180
  const dw = (w - box.w) / 2
  const dh = (h - box.h) / 2
  // Centre moves by R * (dw, dh); the box is then re-derived from the new centre.
  const cx = box.x + box.w / 2 + (dw * Math.cos(r) - dh * Math.sin(r))
  const cy = box.y + box.h / 2 + (dw * Math.sin(r) + dh * Math.cos(r))
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

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
    dragRef.current = { kind, id, sx: e.clientX, sy: e.clientY, ox: lay.x, oy: lay.y, ow: lay.w, oh: lay.h, rot: lay.rot || 0, moved: false }
    onSelect?.(id, kind)
  }

  const startResize = (e, id, lay) => {
    e.stopPropagation()
    capture(e)
    dragRef.current = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, ox: lay.x, oy: lay.y, ow: lay.w, oh: lay.h, rot: lay.rot || 0, moved: false }
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
      // Turn the drag into the item's own (rotated) axes so the handle follows the pointer.
      const r = (d.rot * Math.PI) / 180
      const ldx = dx * Math.cos(r) + dy * Math.sin(r)
      const ldy = -dx * Math.sin(r) + dy * Math.cos(r)
      const w = clamp(d.ow + ldx, 1, PLAN_W)
      const h = clamp(d.oh + ldy, 1, PLAN_H)
      setDrag({ id: d.id, ...resizeKeepingCorner({ x: d.ox, y: d.oy, w: d.ow, h: d.oh, rot: d.rot }, w, h) })
    } else {
      setDrag({ id: d.id, x: clamp(d.ox + dx, 0, PLAN_W - d.ow), y: clamp(d.oy + dy, 0, PLAN_H - d.oh) })
    }
  }

  const end = (item) => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved && drag && drag.id === item.id) {
      if (d.kind === 'resize') onResizeStructure?.(item, { x: snap(drag.x), y: snap(drag.y), w: snap(drag.w), h: snap(drag.h) })
      else if (d.kind === 'structure') onMoveStructure?.(item, snap(drag.x), snap(drag.y))
      else onMove?.(item, snap(drag.x), snap(drag.y))
    }
    setDrag(null)
  }

  const turn = (rot) => (rot ? { transform: `rotate(${rot}deg)` } : {})
  const upright = (rot) => (rot ? { transform: `rotate(${-rot}deg)` } : {})

  return (
    <div className={styles.scroller}>
      <div ref={ref} className={`${styles.canvas} ${editing ? styles.canvasEdit : ''}`}>
        {structures.map((st) => {
          const lay = { x: Number(st.x) || 0, y: Number(st.y) || 0, w: Number(st.w) || 5, h: Number(st.h) || 2, rot: Number(st.rot) || 0 }
          const live = drag?.id === st.id ? drag : null
          const box = { x: live?.x ?? lay.x, y: live?.y ?? lay.y, w: live?.w ?? lay.w, h: live?.h ?? lay.h }
          const isSel = editing && selectedId === st.id
          return (
            <div
              key={st.id}
              className={`${styles.structure} ${styles[`st_${st.style}`] || styles.st_wall} ${editing ? styles.editTile : styles.inert} ${isSel ? styles.selected : ''}`}
              style={{ left: pct(box.x, PLAN_W), top: pct(box.y, PLAN_H), width: pct(box.w, PLAN_W), height: pct(box.h, PLAN_H), ...turn(lay.rot) }}
              onPointerDown={e => start(e, st.id, lay, 'structure')}
              onPointerMove={move}
              onPointerUp={() => end(st)}
              onPointerCancel={() => end(st)}
            >
              {st.label ? <span className={styles.structureLabel} style={upright(lay.rot)}>{st.label}</span> : null}
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
              style={{ left: pct(pos.x, PLAN_W), top: pct(pos.y, PLAN_H), width: pct(lay.w, PLAN_W), height: pct(lay.h, PLAN_H), ...turn(lay.rot) }}
              onClick={() => { if (!editing) onTap?.(table) }}
              onPointerDown={e => start(e, table.id, lay, 'table')}
              onPointerMove={move}
              onPointerUp={() => end(table)}
              onPointerCancel={() => end(table)}
            >
              {/* Text stays upright however the table is turned. */}
              <div className={styles.upright} style={upright(lay.rot)}>{content.node}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
