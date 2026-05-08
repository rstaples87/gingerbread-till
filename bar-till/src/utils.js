export const fmt = n => '£' + Number(n).toFixed(2)

export const getOrderTotal = (order, products) =>
  Object.entries(order).reduce((sum, [id, qty]) => {
    const p = products.find(x => x.id === Number(id))
    return sum + (p ? p.price * qty : 0)
  }, 0)

export const orderToItems = (order, products) =>
  Object.entries(order).map(([id, qty]) => {
    const p = products.find(x => x.id === Number(id))
    return { name: p.name, qty, price: p.price }
  })

export const tabTotal = tab =>
  tab.items.reduce((s, i) => s + i.price * i.qty, 0)

export const itemsText = items =>
  items.map(i => `${i.qty}× ${i.name}`).join('\n')
