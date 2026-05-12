export const INITIAL_PRODUCTS = [
  // WINE - GLASS (1 bottle = 5 glasses)
  { id: 1,  name: 'Sauvignon Blanc (glass)', price: 5.50, category: 'Wine', stock: 0, portionSize: 150, bottleYield: 5 },
  { id: 2,  name: 'Rosé (glass)',            price: 5.50, category: 'Wine', stock: 0, portionSize: 150, bottleYield: 5 },
  { id: 3,  name: 'Merlot (glass)',          price: 5.50, category: 'Wine', stock: 0, portionSize: 150, bottleYield: 5 },
  { id: 4,  name: 'Prosecco (glass)',        price: 7.00, category: 'Wine', stock: 0, portionSize: 125, bottleYield: 6 },

  // WINE - BOTTLE
  { id: 5,  name: 'Bottle of Wine',     price: 30.00, category: 'Wine', stock: 0 },
  { id: 6,  name: 'Bottle of Prosecco', price: 37.00, category: 'Wine', stock: 0 },

  // BEER
  { id: 7,  name: 'Spitfire / Southwold', price: 6.00, category: 'Beer', stock: 0 },
  { id: 8,  name: 'Lager (Moretti / Peroni / Corona)', price: 5.70, category: 'Beer', stock: 0 },
  { id: 9,  name: '0% Beer', price: 5.00, category: 'Beer', stock: 0 },

  // CIDER
  { id: 10, name: 'Aspall / Old Mout Cider', price: 6.60, category: 'Cider', stock: 0 },

  // SPIRITS (1 bottle = 28 x 25ml measures)
  { id: 11, name: 'House Spirit (25ml)',            price: 3.50,  category: 'Spirits', stock: 0, portionSize: 25, bottleYield: 28 },
  { id: 12, name: 'Premium Spirit (25ml)',          price: 4.50,  category: 'Spirits', stock: 0, portionSize: 25, bottleYield: 28 },
  { id: 13, name: 'Baileys / Martini (50ml)',       price: 5.00,  category: 'Spirits', stock: 0, portionSize: 50, bottleYield: 14 },
  { id: 14, name: 'House Spirit & Mixer',           price: 6.50,  category: 'Spirits', stock: 0, portionSize: 25, bottleYield: 28 },
  { id: 15, name: 'Premium Spirit & Mixer',         price: 7.50,  category: 'Spirits', stock: 0, portionSize: 25, bottleYield: 28 },
  { id: 16, name: 'Double House Spirit & Mixer',    price: 10.00, category: 'Spirits', stock: 0, portionSize: 50, bottleYield: 14 },
  { id: 17, name: 'Double Premium Spirit & Mixer',  price: 12.00, category: 'Spirits', stock: 0, portionSize: 50, bottleYield: 14 },
  { id: 18, name: '0% Gordons & Mixer',             price: 5.00,  category: 'Spirits', stock: 0 },
  { id: 19, name: 'Aperol Spritz',                  price: 10.00, category: 'Spirits', stock: 0 },

  // SHOTS
  { id: 20, name: 'Jager Bomb',                    price: 6.50, category: 'Shots', stock: 0, portionSize: 25, bottleYield: 28 },
  { id: 21, name: 'Tequila Rose / Tequila / Sambuca', price: 5.00, category: 'Shots', stock: 0, portionSize: 25, bottleYield: 28 },

  // SOFT DRINKS
  { id: 22, name: 'Coke / Lemonade / Tonic / Juice', price: 3.50, category: 'Soft Drinks', stock: 0 },
  { id: 23, name: 'Red Bull',                         price: 4.20, category: 'Soft Drinks', stock: 0 },
  { id: 24, name: 'J2O Orange & Passion Fruit',       price: 3.90, category: 'Soft Drinks', stock: 0 },
  { id: 25, name: 'Tea & Coffee',                     price: 3.00, category: 'Soft Drinks', stock: 0 },
]

export const STOCK_ITEMS = [
  // LAGER (bottles)
  { id: 's1',  name: 'Moretti',          category: 'Lager',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's2',  name: 'Peroni',           category: 'Lager',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's3',  name: 'Corona',           category: 'Lager',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },

  // ALE (bottles)
  { id: 's4',  name: 'Spitfire',         category: 'Ale',             unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's5',  name: 'Southwold (Adnams)', category: 'Ale',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },

  // 0% BEER
  { id: 's6',  name: '0% Peroni',        category: '0% Beer',         unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's7',  name: '0% Ghostship',     category: '0% Beer',         unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's8',  name: 'Guinness Draft',   category: '0% Beer',         unit: 'can',    displayUnit: 'cans', stock: 0 },

  // CIDER
  { id: 's9',  name: 'Aspall',           category: 'Cider',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's10', name: 'Old Mout',         category: 'Cider',           unit: 'bottle', displayUnit: 'bottles', stock: 0 },

  // HOUSE SPIRITS
  { id: 's11', name: 'Smirnoff',                category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's12', name: 'Bacardi',                 category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's13', name: 'Bells Whiskey',           category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's14', name: 'Malibu',                  category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's15', name: 'Archers',                 category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's16', name: 'Captain Morgans Spiced',  category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's17', name: 'Captain Morgans Rum',     category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's18', name: 'Gordons Gin',             category: 'House Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },

  // PREMIUM SPIRITS
  { id: 's19', name: 'Copper House Gin',   category: 'Premium Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's20', name: 'Flavoured Gins',     category: 'Premium Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's21', name: 'Jack Daniels',       category: 'Premium Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's22', name: 'Courvoisier',        category: 'Premium Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's23', name: 'Disaronno',          category: 'Premium Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },

  // OTHER SPIRITS
  { id: 's24', name: 'Baileys',        category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 14 },
  { id: 's25', name: 'Martini',        category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 14 },
  { id: 's26', name: 'Tequila Rose',   category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's27', name: 'Jose Tequila',   category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's28', name: 'Sambuca',        category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },
  { id: 's29', name: 'Jagermeister',   category: 'Other Spirits', unit: 'bottle', stock: 0, bottleYield: 28 },

  // WINE
  { id: 's30', name: 'Sauvignon Blanc', category: 'Wine', unit: 'bottle', stock: 0, bottleYield: 5 },
  { id: 's31', name: 'Rosé',            category: 'Wine', unit: 'bottle', stock: 0, bottleYield: 5 },
  { id: 's32', name: 'Merlot',          category: 'Wine', unit: 'bottle', stock: 0, bottleYield: 5 },
  { id: 's33', name: 'Prosecco',        category: 'Wine', unit: 'bottle', stock: 0, bottleYield: 6 },

  // SOFT DRINKS
  { id: 's34', name: 'Coke (1.75ltr)',         category: 'Soft Drinks', unit: 'bottle', displayUnit: '1.75ltr bottles', stock: 0 },
  { id: 's35', name: 'Diet Coke (1.75ltr)',    category: 'Soft Drinks', unit: 'bottle', displayUnit: '1.75ltr bottles', stock: 0 },
  { id: 's36', name: 'Lemonade (1.5ltr)',      category: 'Soft Drinks', unit: 'bottle', displayUnit: '1.5ltr bottles', stock: 0 },
  { id: 's37', name: 'Tonic Water',            category: 'Soft Drinks', unit: 'bottle', displayUnit: '6-pack bottles', stock: 0 },
  { id: 's38', name: 'Slimline Tonic',         category: 'Soft Drinks', unit: 'bottle', displayUnit: '6-pack bottles', stock: 0 },
  { id: 's39', name: 'Soda Water',             category: 'Soft Drinks', unit: 'bottle', displayUnit: '6-pack bottles', stock: 0 },
  { id: 's40', name: 'Orange Juice',           category: 'Soft Drinks', unit: 'carton', displayUnit: 'cartons', stock: 0 },
  { id: 's41', name: 'Apple Juice',            category: 'Soft Drinks', unit: 'carton', displayUnit: 'cartons', stock: 0 },
  { id: 's42', name: 'Cranberry Juice',        category: 'Soft Drinks', unit: 'bottle', displayUnit: 'bottles', stock: 0 },
  { id: 's43', name: 'Ginger Ale',             category: 'Soft Drinks', unit: 'bottle', displayUnit: '12-pack bottles', stock: 0 },
  { id: 's44', name: 'Red Bull',               category: 'Soft Drinks', unit: 'can',    displayUnit: 'cans', stock: 0 },
  { id: 's45', name: 'J2O',                    category: 'Soft Drinks', unit: 'bottle', displayUnit: 'bottles', stock: 0 },

  // MIXERS (stock room — linked to spirit & mixer till lines; portions per bottle)
  { id: 's46', name: 'Coke (mixer)',           category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 7 },
  { id: 's47', name: 'Diet Coke (mixer)',      category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 7 },
  { id: 's48', name: 'Lemonade (mixer)',       category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
  { id: 's49', name: 'Tonic Water (mixer)',    category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
  { id: 's50', name: 'Slimline Tonic (mixer)', category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
  { id: 's51', name: 'Soda Water (mixer)',     category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
  { id: 's52', name: 'Ginger Ale (mixer)',     category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
  { id: 's53', name: 'Cranberry (mixer)',      category: 'Mixers', unit: 'bottle', stock: 0, bottleYield: 6 },
]

/** Stock item ids offered as mixer choices for spirit & mixer till products */
export const MIXER_STOCK_IDS = ['s46', 's47', 's48', 's49', 's50', 's51', 's52', 's53']

export const PRODUCT_VARIANTS = {
  7:  { label: 'Which ale?',            stockIds: ['s4', 's5'],      deduct: 1 },
  8:  { label: 'Which lager?',          stockIds: ['s1', 's2', 's3'], deduct: 1 },
  9:  { label: 'Which 0% beer?',        stockIds: ['s6', 's7', 's8'], deduct: 1 },
  10: { label: 'Which cider?',          stockIds: ['s9', 's10'],     deduct: 1 },
  5:  { label: 'Which wine?',           stockIds: ['s30', 's31', 's32'], deduct: 1 },
  6:  { label: 'Prosecco — confirm',    stockIds: ['s33'],          deduct: 1 },
  1:  { label: 'Which wine? (glass)',   stockIds: ['s30'],          deduct: 0.2 },
  2:  { label: 'Which wine? (glass)',   stockIds: ['s31'],          deduct: 0.2 },
  3:  { label: 'Which wine? (glass)',   stockIds: ['s32'],          deduct: 0.2 },
  4:  { label: 'Prosecco (glass)',      stockIds: ['s33'],          deduct: 0.167 },
  11: { label: 'Which house spirit?',   stockIds: ['s11', 's12', 's13', 's14', 's15', 's16', 's17', 's18'], deduct: 0.036 },
  12: { label: 'Which premium spirit?', stockIds: ['s19', 's20', 's21', 's22', 's23'], deduct: 0.036 },
  13: { label: 'Which spirit? (50ml)',  stockIds: ['s24', 's25'],    deduct: 0.071 },
  14: { label: 'Which house spirit?',   stockIds: ['s11', 's12', 's13', 's14', 's15', 's16', 's17', 's18'], deduct: 0.036, needsMixer: true },
  15: { label: 'Which premium spirit?', stockIds: ['s19', 's20', 's21', 's22', 's23'], deduct: 0.036, needsMixer: true },
  16: { label: 'Which house spirit?',   stockIds: ['s11', 's12', 's13', 's14', 's15', 's16', 's17', 's18'], deduct: 0.071, needsMixer: true },
  17: { label: 'Which premium spirit?', stockIds: ['s19', 's20', 's21', 's22', 's23'], deduct: 0.071, needsMixer: true },
  18: { mixerOnly: true, fixedSpiritStockId: 's18', deduct: 0.036 },
  20: { label: 'Confirm Jager Bomb',    stockIds: ['s29'],          deduct: 0.036 },
  21: { label: 'Which shot?',           stockIds: ['s26', 's27', 's28'], deduct: 0.036 },
  22: { label: 'Which soft drink?',     stockIds: ['s34', 's35', 's36', 's37', 's38', 's39', 's40', 's41', 's42', 's43'], deduct: 1 },
  23: { label: 'Confirm Red Bull',      stockIds: ['s44'],          deduct: 1 },
  24: { label: 'Confirm J2O',           stockIds: ['s45'],          deduct: 1 },
}

export const INITIAL_STAFF = []

export const ADMIN_PIN = '0000'

export const DEFAULT_TAB_LIMIT = 500

export const TAB_PRESETS = ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6']

export const CATEGORIES = ['Wine', 'Beer', 'Cider', 'Spirits', 'Shots', 'Soft Drinks']

export const STOCK_CATEGORIES = ['Lager', 'Ale', '0% Beer', 'Cider', 'House Spirits', 'Premium Spirits', 'Other Spirits', 'Wine', 'Soft Drinks', 'Mixers']
