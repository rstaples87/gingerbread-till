export const INITIAL_PRODUCTS = [
  { id: 1,  name: 'Pint Lager',          price: 5.50, category: 'Draught',     stock: 40 },
  { id: 2,  name: 'Pint Ale',            price: 5.00, category: 'Draught',     stock: 32 },
  { id: 3,  name: 'Half Lager',          price: 3.00, category: 'Draught',     stock: 40 },
  { id: 4,  name: 'Half Ale',            price: 2.70, category: 'Draught',     stock: 32 },
  { id: 5,  name: 'Red Wine (bottle)',   price: 18.00, category: 'Wine',       stock: 12 },
  { id: 6,  name: 'White Wine (bottle)', price: 18.00, category: 'Wine',       stock: 8  },
  { id: 7,  name: 'Glass of Wine',       price: 5.50, category: 'Wine',        stock: 20 },
  { id: 8,  name: 'Prosecco (bottle)',   price: 22.00, category: 'Wine',       stock: 6  },
  { id: 9,  name: 'Gin & Tonic',         price: 6.50, category: 'Spirits',    stock: 25 },
  { id: 10, name: 'Rum & Coke',          price: 6.00, category: 'Spirits',    stock: 20 },
  { id: 11, name: 'Vodka Mixer',         price: 6.00, category: 'Spirits',    stock: 20 },
  { id: 12, name: 'Whisky',              price: 5.50, category: 'Spirits',    stock: 15 },
  { id: 13, name: 'Soft Drink',          price: 2.50, category: 'Soft Drinks', stock: 30 },
  { id: 14, name: 'Still Water',         price: 1.50, category: 'Soft Drinks', stock: 24 },
  { id: 15, name: 'Sparkling Water',     price: 1.50, category: 'Soft Drinks', stock: 18 },
  { id: 16, name: 'Fruit Juice',         price: 2.00, category: 'Soft Drinks', stock: 16 },
]

export const INITIAL_STAFF = ['Alice', 'Ben', 'Chloe', 'Dan']

export const TAB_PRESETS = ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6']

export const CATEGORIES = [...new Set(INITIAL_PRODUCTS.map(p => p.category))]
