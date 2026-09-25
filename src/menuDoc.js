/**
 * Printable menus. Each menu is one row in menu_docs: { id, name, sort, doc }.
 *
 * doc = {
 *   orientation: 'portrait' | 'landscape',
 *   fontSize: 10.5,                          // pt — lets the team shrink a menu to fit one page
 *   priceFormat: 'trim' | '2dp',             // 8.5 / 20 vs 8.50 / 20
 *   dietaryStyle: 'colour' | 'muted',
 *   header: { logo: 'center' | 'left' | 'right' | 'none', title: '', titleStyle: 'plain' | 'hand', text: '' },
 *   rows: [{ id, cols: [[block, ...], [block, ...]] }],   // each row is a grid of 1-3 columns, each column a stack of blocks
 *   footer: '',
 * }
 * row may carry `widths` (a CSS grid-template-columns value) to make columns unequal.
 * block = { id, type: 'section', title, headingPrice, headingPriceProductId, note, boxed, align, priceLayout, sideTitle, itemColumns (1|2), items: [item] }
 *       | { id, type: 'text', text, boxed, align, bold }
 *       | { id, type: 'image', art, width }
 *       | { id, type: 'logo', width }
 * item  = { id, kind: 'dish' | 'heading' | 'note', name, desc, price, productId, diet: ['V', ...], plain, fontSize }
 * Any section/text block and any item can carry its own `fontSize` (pt) to override the menu's text size.
 * A dish with a productId takes its price live from the till, so a price change is made once.
 */

/** Artwork shipped in /public/menu-art. `crop` (source pixels) trims an image without altering the file. */
export const MENU_ART = {
  tractor: { label: 'Tractor', src: '/menu-art/tractor.jpg', w: 1545, h: 2000, crop: { x: 40, y: 320, w: 1470, h: 1290 } },
  animals: { label: 'Farm animals', src: '/menu-art/farm-animals.png', w: 297, h: 280, crop: { x: 0, y: 0, w: 297, h: 258 } },
}
export const MENU_LOGO_SRC = '/menu-art/haywain-logo.png'

export const DIET_CODES = ['V', 'VG', 'VGO', 'GF', 'GFO', 'N']

export const uid = () => Math.random().toString(36).slice(2, 9)

/** 'trim' drops trailing zeros (8.5, 20); '2dp' shows pence unless whole (13.80, 8). */
export function formatMenuPrice(value, mode = 'trim') {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return mode === '2dp' ? n.toFixed(2) : String(Math.round(n * 100) / 100)
}

export function itemPriceText(item, productById, mode) {
  const p = item.productId != null ? productById.get(Number(item.productId)) : null
  if (p) return formatMenuPrice(p.price, mode)
  return item.price ? String(item.price) : ''
}

export function headingText(block, productById, mode) {
  const p = block.headingPriceProductId != null ? productById.get(Number(block.headingPriceProductId)) : null
  if (p) return formatMenuPrice(p.price, mode)
  return block.headingPrice ? String(block.headingPrice) : ''
}

export const newDish = (patch = {}) => ({ id: uid(), kind: 'dish', name: '', desc: '', price: '', diet: [], ...patch })
export const newSection = () => ({
  id: uid(), type: 'section', title: 'New section', headingPrice: '', note: '', boxed: false, align: 'left', priceLayout: 'inline', items: [],
})
export const newTextBlock = () => ({ id: uid(), type: 'text', text: 'Some text', boxed: false, align: 'center', bold: false })
export const newImageBlock = () => ({ id: uid(), type: 'image', art: 'tractor', width: 100 })
export const newLogoBlock = () => ({ id: uid(), type: 'logo', width: 100 })
// Widths that line a 2-column row up with the 3-column row above it (4mm gaps): one third + two thirds.
export const ROW_WIDTHS = [
  { value: '', label: 'Equal' },
  { value: 'calc((100% - 8mm) / 3) 1fr', label: 'Narrow, then wide (thirds)' },
  { value: '1fr calc((100% - 8mm) / 3)', label: 'Wide, then narrow (thirds)' },
]
export const newRow = (cols = 1) => ({ id: uid(), cols: Array.from({ length: cols }, () => []) })

export const blankDoc = () => ({
  orientation: 'portrait',
  fontSize: 10.5,
  priceFormat: 'trim',
  dietaryStyle: 'colour',
  header: { logo: 'center', title: '', titleStyle: 'plain', text: '' },
  rows: [{ id: uid(), cols: [[newSection()]] }],
  footer: '',
})

/** Every image a doc prints, so printing can wait for them to load first. */
export function docImageSrcs(doc) {
  const out = new Set()
  if (doc?.header?.logo && doc.header.logo !== 'none') out.add(MENU_LOGO_SRC)
  for (const row of doc?.rows ?? []) {
    for (const col of row.cols ?? []) {
      for (const b of col) {
        if (b.type === 'logo') out.add(MENU_LOGO_SRC)
        if (b.type === 'image' && MENU_ART[b.art]) out.add(MENU_ART[b.art].src)
      }
    }
  }
  return [...out]
}

/** Give every block/item/row an id (seeded or older docs may lack them). */
export function ensureIds(doc) {
  const d = structuredClone(doc ?? {})
  d.rows = (d.rows ?? []).map(r => ({
    ...r,
    id: r.id || uid(),
    cols: (r.cols ?? [[]]).map(col => col.map(b => ({
      ...b,
      id: b.id || uid(),
      ...(b.items ? { items: b.items.map(it => ({ ...it, id: it.id || uid() })) } : {}),
    }))),
  }))
  return d
}
