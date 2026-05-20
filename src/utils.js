export const fmt = n => '£' + Number(n).toFixed(2)

/** Local calendar date YYYY-MM-DD for bar_orders.session_date */
export function localSessionDateString() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Human-readable counted quantity for stock items with optional displayUnit
 * (used in Stock take + stock report). Sized packs use "qty x …", simple plurals use "qty …".
 */
export function formatStockItemQuantity(qty, item) {
  const du = item?.displayUnit
  if (du) {
    if (/\d/.test(du) || du.includes('-pack')) {
      return `${qty} x ${du}`
    }
    return `${qty} ${du}`
  }
  const u = item?.unit || 'unit'
  return `${qty} ${u}${qty === 1 ? '' : 's'}`
}

/** Mixer serves per till drink: doubles use two portions */
export function mixerServesPerDrink(productId) {
  return productId === 16 || productId === 17 ? 2 : 1
}

/** Fractional mixer bottles to deduct for line qty (uses stock item bottleYield) */
export function mixerBottleDeductionForLine(productId, lineQty, mixerBottleYield) {
  const y = mixerBottleYield
  if (!y || y <= 0) return lineQty
  return (mixerServesPerDrink(productId) / y) * lineQty
}

const getLineQty = (line) => (typeof line === 'number' ? line : (line?.qty || 0))
const getLineStockId = (line) => (typeof line === 'object' ? line?.selectedStockId : null)
const getLineMixerId = (line) => (typeof line === 'object' ? line?.selectedMixerId : null)
const getLineDisplayName = (line) => (typeof line === 'object' ? line?.displayName : null)

/** Panel/receipt label: variant display name when set, else product name */
export const orderLineLabel = (line, productName) => getLineDisplayName(line) || productName

export const getOrderTotal = (order, products) =>
  Object.entries(order).reduce((sum, [id, line]) => {
    const p = products.find(x => x.id === Number(id))
    const qty = getLineQty(line)
    return sum + (p ? p.price * qty : 0)
  }, 0)

export const orderToItems = (order, products) =>
  Object.entries(order).map(([id, line]) => {
    const p = products.find(x => x.id === Number(id))
    if (!p) return null
    return {
      productId: p.id,
      name: orderLineLabel(line, p.name),
      qty: getLineQty(line),
      price: p.price,
      selectedStockId: getLineStockId(line),
      selectedMixerId: getLineMixerId(line),
      displayName: getLineDisplayName(line) || undefined,
    }
  }).filter(Boolean)

export const tabTotal = tab =>
  tab.items.reduce((s, i) => s + i.price * i.qty, 0)

export const itemsText = items =>
  items.map(i => `${i.qty}× ${i.name}`).join('\n')
