import { supabase } from './supabase'

// Shared menu (products + variants, stock item definitions, categories) in Supabase.
// Tables: menu_products, menu_categories, and definition columns on stock_items (see migration 20260920130000).

export const MENU_OP_TYPES = new Set([
  'menu_product',
  'menu_product_delete',
  'menu_variant',
  'stock_definition',
  'stock_definition_delete',
  'menu_category',
])

export function productToRow(product, variant) {
  const { id, name, price, category, stock: _stock, ...rest } = product
  return {
    id: Number(id),
    name: String(name ?? ''),
    price: Number(price ?? 0),
    category: category ?? null,
    data: rest,
    variant: variant ?? null,
  }
}

function rowToProduct(row) {
  return {
    ...(row.data ?? {}),
    id: Number(row.id),
    name: row.name,
    price: Number(row.price),
    category: row.category,
    stock: 0,
  }
}

/** Definition columns only — never includes qty, so it can't overwrite a stock count. */
export function stockDefinitionToRow(item) {
  const { id, name, category, unit, displayUnit, stock: _stock, ...rest } = item
  return {
    stock_key: String(id),
    name: String(name ?? ''),
    category: category ?? null,
    unit: unit ?? null,
    display_unit: displayUnit ?? null,
    data: rest,
  }
}

function rowToStockDefinition(row) {
  return {
    ...(row.data ?? {}),
    id: row.stock_key,
    name: row.name,
    category: row.category,
    unit: row.unit,
    ...(row.display_unit ? { displayUnit: row.display_unit } : {}),
    stock: 0,
  }
}

/** Apply one menu write. Also used to replay queued writes. Resolves { error } (never throws). */
export async function applyMenuOp(type, payload) {
  if (!supabase) return { error: new Error('no supabase') }
  try {
    let res
    if (type === 'menu_product') {
      res = await supabase.from('menu_products').upsert(payload, { onConflict: 'id' })
    } else if (type === 'menu_product_delete') {
      res = await supabase.from('menu_products').delete().eq('id', payload.id)
    } else if (type === 'menu_variant') {
      res = await supabase.from('menu_products').update({ variant: payload.variant }).eq('id', payload.id)
    } else if (type === 'stock_definition') {
      res = await supabase.from('stock_items').upsert(payload, { onConflict: 'stock_key' })
    } else if (type === 'stock_definition_delete') {
      res = await supabase.from('stock_items').delete().eq('stock_key', payload.stock_key)
    } else if (type === 'menu_category') {
      res = await supabase.from('menu_categories').upsert(payload, { onConflict: 'kind,name' })
    } else {
      return { error: new Error('unknown menu op ' + type) }
    }
    return { error: res.error ?? null }
  } catch (err) {
    return { error: err }
  }
}

/** Fetch the shared menu, or null if unavailable (offline / tables not created yet). */
export async function fetchMenuFromSupabase() {
  if (!supabase) return null
  try {
    const [p, s, c] = await Promise.all([
      supabase.from('menu_products').select('*'),
      supabase.from('stock_items').select('stock_key, name, category, unit, display_unit, data').not('name', 'is', null),
      supabase.from('menu_categories').select('kind, name'),
    ])
    const error = p.error || s.error || c.error
    if (error) {
      console.warn('fetchMenuFromSupabase:', error.message || error)
      return null
    }
    const products = (p.data ?? []).map(rowToProduct).sort((a, b) => a.id - b.id)
    const variants = {}
    for (const row of p.data ?? []) {
      if (row.variant) variants[Number(row.id)] = row.variant
    }
    const stockDefinitions = (s.data ?? [])
      .map(rowToStockDefinition)
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    const categories = { till: [], stock: [] }
    for (const row of c.data ?? []) {
      if (categories[row.kind]) categories[row.kind].push(row.name)
    }
    return { products, variants, stockDefinitions, categories }
  } catch (err) {
    console.warn('fetchMenuFromSupabase failed:', err?.message || err)
    return null
  }
}

/** One-time upload of this device's menu when the shared menu is empty. Skips parts already on the server. */
export async function seedMenuToSupabase({ products, variants, stockDefinitions, categories }, { seedProducts, seedStock }) {
  if (!supabase) return
  if (seedProducts && products.length) {
    const rows = products.map(p => productToRow(p, variants?.[p.id]))
    const { error } = await supabase.from('menu_products').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) console.warn('seed menu_products:', error.message)
    const catRows = [
      ...(categories?.till ?? []).map(name => ({ kind: 'till', name })),
      ...(categories?.stock ?? []).map(name => ({ kind: 'stock', name })),
    ]
    if (catRows.length) {
      const res = await supabase.from('menu_categories').upsert(catRows, { onConflict: 'kind,name', ignoreDuplicates: true })
      if (res.error) console.warn('seed menu_categories:', res.error.message)
    }
  }
  if (seedStock && stockDefinitions.length) {
    const { error } = await supabase
      .from('stock_items')
      .upsert(stockDefinitions.map(stockDefinitionToRow), { onConflict: 'stock_key' })
    if (error) console.warn('seed stock definitions:', error.message)
  }
}
