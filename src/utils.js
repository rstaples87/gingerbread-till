export const fmt = n => '£' + Number(n).toFixed(2)

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

export const getOrderTotal = (order, products) =>
  Object.entries(order).reduce((sum, [id, line]) => {
    const p = products.find(x => x.id === Number(id))
    const qty = getLineQty(line)
    return sum + (p ? p.price * qty : 0)
  }, 0)

export const orderToItems = (order, products) =>
  Object.entries(order).map(([id, line]) => {
    const p = products.find(x => x.id === Number(id))
    return {
      productId: p.id,
      name: p.name,
      qty: getLineQty(line),
      price: p.price,
      selectedStockId: getLineStockId(line),
      selectedMixerId: getLineMixerId(line),
    }
  })

export const tabTotal = tab =>
  tab.items.reduce((s, i) => s + i.price * i.qty, 0)

export const itemsText = items =>
  items.map(i => `${i.qty}× ${i.name}`).join('\n')
