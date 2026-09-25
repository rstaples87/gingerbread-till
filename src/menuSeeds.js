import { uid } from './menuDoc'

/**
 * The Haywain's seven menus, transcribed from the September 2026 Publisher files.
 * Dishes with `pid` are linked to the till product, so their price is read live from the till.
 * Loaded once from the Menus screen ("Load the Haywain menus"); after that the team edits them there.
 */

const dish = (name, desc = '', o = {}) => ({
  id: uid(), kind: 'dish', name, desc, price: o.price ?? '', diet: o.diet ?? [],
  ...(o.pid != null ? { productId: o.pid } : {}),
  ...(o.plain ? { plain: true } : {}),
})
const heading = (name) => ({ id: uid(), kind: 'heading', name })
const note = (desc) => ({ id: uid(), kind: 'note', desc })
const section = (title, items, o = {}) => ({
  id: uid(), type: 'section', title, headingPrice: o.hp ?? '', ...(o.hpPid != null ? { headingPriceProductId: o.hpPid } : {}),
  note: o.note ?? '', boxed: !!o.boxed, align: o.align ?? 'left', priceLayout: o.right ? 'right' : 'inline', sideTitle: !!o.side, items,
})
const text = (t, o = {}) => ({ id: uid(), type: 'text', text: t, boxed: !!o.boxed, align: o.align ?? 'center', bold: !!o.bold })
const logo = (width = 100) => ({ id: uid(), type: 'logo', width })
const image = (art, width = 100) => ({ id: uid(), type: 'image', art, width })
const row = (...cols) => ({ id: uid(), cols })

const docBase = (o) => ({
  orientation: 'portrait', fontSize: 10.5, priceFormat: 'trim', dietaryStyle: 'colour',
  header: { logo: 'center', title: '', titleStyle: 'plain', text: '' }, footer: '', ...o,
})

const halfPintNames = ['Bacon Bites', 'Whitebait', 'Breaded Brie Bites', 'Chipolatas', 'Fried Gherkins']
const V = ['V']
const VG = ['V', 'VG']

function evening() {
  return docBase({
    fontSize: 10,
    rows: [
      row(
        [section('Starters', [
          dish('Garlic Citrus Hummus', 'Flatbread', { pid: 400, diet: V }),
          dish('Crispy Beef', 'Chilli, Soy & Sesame Sauce, Mixed Leaves', { pid: 401 }),
          dish('Smoked Mackerel Mousse', 'Pickled Cucumber, Melba Toasts', { pid: 402 }),
          dish('Chicken Souvlaki', 'Tzatziki', { pid: 403 }),
          dish('Baked Goats Cheese', 'Homemade Tomato Chutney', { pid: 404 }),
        ])],
        [section('Half Pints', [
          dish('Three for 20'),
          note('Perfect for a light bite or starter, why not have a few to share?'),
          ...halfPintNames.map(n => dish(n, '', { plain: true })),
          note('Served with Dipping Sauce'),
        ], { hpPid: 426, boxed: true, align: 'center' })],
      ),
      row([section('Sharing Boards - For Two', [
        dish("Haywain Ploughman's", 'Home Cured Smoked Ham, Cheddar, Pickled Vegetables, Apple Chutney and Pickle, Apple, Breads, Salad, & Coleslaw', { pid: 422 }),
        dish('Barbecue Pulled Pork Nachos', 'Sour Cream, Homemade Salsa', { pid: 424 }),
        dish('Haywain Barbecue Board', 'Flat Iron Steak, Home Cured Bacon Steak, Lamb Kofta, Pork Tomahawk, Onion Rings, Mushrooms, Creamy Coleslaw, Paprika Fries', { pid: 425 }),
      ], { boxed: true })]),
      row(
        [section('Mains', [
          dish('Crispy Battered Fish and Chips', 'Crushed Peas, Tartar Sauce', { pid: 405 }),
          dish('Slow Cooked Beef Brisket', 'Fries, Barbecue Sauce, Smokey Garlic Butter\nCorn, Coleslaw', { pid: 406 }),
          dish('Pan Fried Seabass', 'Garlic and Ginger Sauce, Lyonnaise Potatoes', { pid: 407 }),
          dish('Saag Aloo', 'Roasted Spiced Butternut Squash, Chapati', { pid: 408, diet: VG }),
          dish('Slow Roasted Pork Belly', 'Cider and Mustard Sauce, Sauteed Potatoes', { pid: 409 }),
          dish('Oven Roasted Chicken Breast', 'Sweetcorn Cream Sauce, Chilli Oil, Sauteed Potatoes', { pid: 410 }),
        ])],
        [section('From The Griddle', [
          dish('Flat Iron Steak', 'Served with Chips or Sautéed Potatoes with Salad, Mushrooms and Tarragon Mayonnaise', { pid: 416 }),
          heading('Burgers'),
          note('Served in a Bun with Crispy Lettuce, Tomato, Coleslaw and Chips'),
          dish('The Haywain Burger', 'Smoked Cheese, Haywain Sauce, Pickles', { pid: 417 }),
          dish('Crispy Buttermilk Chicken Burger', 'Smoked Cheese, Haywain Mayo, Garlic Bun, Sriracha', { pid: 418 }),
          dish('Vegan Burger', 'Vegan Cheese, Haywain Burger Sauce', { pid: 419, diet: VG }),
          note('Add Bacon or Mushrooms - 3 each'),
        ])],
      ),
      row([section('Sides', [
        note('Chips V VG | Fresh Vegetables | Skin on Fries V VG | Mixed Leaf Salad | Sautéed Potatoes'),
      ], { hpPid: 411, boxed: true, align: 'center' })]),
    ],
  })
}

function lunch() {
  return docBase({
    orientation: 'landscape',
    fontSize: 8.5,
    header: { logo: 'none', title: '', titleStyle: 'plain', text: '' },
    rows: [
      row(
        [
          logo(100),
          section('Half Pints', [
            dish('Three for 20'),
            note('Perfect for a light bite or starter!'),
            ...halfPintNames.map(n => dish(n, '', { plain: true })),
          ], { hpPid: 426, boxed: true, align: 'center' }),
          section('Sandwiches', [
            heading('Open Sandwiches'),
            note('Toasted Sourdough\nServed with Crisps and topped with one of the following:'),
            dish('Flat Iron Steak', 'Smokey Dijon Onions'),
            dish('Chicken Tikka', 'Homemade Mango Chutney, Crisp Pastry'),
            dish('Brie', 'Hot Honey, Walnuts'),
            heading('Ciabattas'),
            note('Crusty Ciabattas served with Crisps and filled with one of the following:'),
            dish('Steak, Mustard and Salad', '', { plain: true }),
            dish('Grilled Chicken, Herb Mayo, Salad', '', { plain: true }),
            dish('Halloumi, Red Onion Chutney and Salad', '', { plain: true }),
            dish('Chip upgrade', '', { pid: 437 }),
            dish('Sandwich and a Drink', '', { price: '15' }),
          ], { hp: '11.50', boxed: true, align: 'center' }),
        ],
        [
          section('Starters', [
            dish('Smoked Mackerel Mousse', 'Pickled Cucumber, Melba Toast', { pid: 402 }),
            dish('Crispy Beef', 'Chilli, Soy and Sesame Sauce, Mixed Leaves', { pid: 401 }),
            dish('Chicken Souvlaki', 'Tzatziki', { pid: 403 }),
            dish('Baked Goats Cheese', 'Onion Chutney', { pid: 404 }),
            dish('Garlic Citrus Hummus', 'Flatbread', { pid: 400, diet: V }),
          ], { boxed: true, align: 'center' }),
          section('Mains', [
            dish('Battered Fish and Chips', 'Crushed Peas and Tartar Sauce', { pid: 405 }),
            dish('Pan Fried Seabass', 'Ginger and Garlic Sauce, Lyonnaise Potatoes', { pid: 407 }),
            dish('Saag Aloo', 'Roasted Spiced Butternut Squash', { pid: 408, diet: VG }),
            dish('Slow Roasted Pork Belly', 'Sauteed Potatoes, Cider and Mustard Sauce', { pid: 409 }),
            dish('Slow Cooked Beef Brisket', 'Fries, Barbecue Sauce, Smokey Garlic Butter Corn, Coleslaw', { pid: 406 }),
            dish('Oven Roasted Chicken Breast', 'Sweetcorn Cream Sauce, Chilli Oil, Sauteed Potatoes', { pid: 410 }),
          ], { boxed: true, align: 'center' }),
        ],
        [
          section('Sharing Boards - For Two', [
            dish('Baked Camembert', 'Fresh Breads, Tomato Chutney', { pid: 423 }),
            dish('Barbecue Pulled Pork Nachos', 'Sour Cream, Homemade Salsa', { pid: 424 }),
            dish('Haywain Barbecue Board', 'Flat Iron Steak, Home Cured Bacon Steak, Lamb Kofta, Pork Chop, Onion Rings, Mushrooms, Haywain Chunky Coleslaw & Paprika Fries', { pid: 425 }),
          ], { boxed: true, align: 'center' }),
          section('From the Griddle', [
            heading('Steaks'),
            note('Served with Chips or Sautéed Potatoes with Mushrooms, Salad and Tarragon Mayonnaise'),
            dish('Flat Iron', '', { pid: 416 }),
            heading('Burgers'),
            note('Served in a Bun with Crispy Lettuce, Tomato, Coleslaw and Chips'),
            dish('The Haywain Burger', 'Smoked Cheese, Haywain Sauce, Pickles', { pid: 417 }),
            dish('Crispy Buttermilk Chicken Burger', 'Smoked Cheese, Haywain Mayo, Garlic Bun, Sriracha', { pid: 418 }),
            dish('Vegan Burger', 'Vegan Cheese, Haywain Burger Sauce', { pid: 419, diet: VG }),
            note('Add Bacon or Mushrooms - 3 each'),
          ], { boxed: true, align: 'center' }),
        ],
      ),
    ],
  })
}

function sunday() {
  return docBase({
    fontSize: 9,
    dietaryStyle: 'muted',
    header: { logo: 'right', title: '', titleStyle: 'plain', text: '' },
    footer: 'Allergy Code: GFO - Gluten Free Option | V - Vegetarian | VG Vegan | N - Contains Nuts',
    rows: [
      row([
        section('Starters', [
          dish('Garlic and Lemon Hummus', 'Flatbread', { diet: ['V', 'VG', 'GFO'] }),
          dish('Mackerel Pate', 'Pickled Cucumber, Melba Toast', { diet: ['GFO'] }),
          dish('Chicken Souvlaki', 'Tzatziki', { diet: ['GFO'] }),
          dish('Crispy Beef', 'Chilli and Soy'),
          dish('Goats Cheese', 'Onion Chutney', { diet: ['V', 'GFO'] }),
        ]),
        section('Roasts', [
          dish('Beef', 'Top Rump - Served Pink\nSlow Cooked Brisket - Well Done'),
          dish('Lamb', 'Slow Cooked Shoulder with Garlic and Rosemary (1.00 supplement)'),
          dish('Pork', 'Slow Cooked Shoulder with Crackling'),
          dish('Chickpea and Cashew Nut Slice', 'Vegetarian Gravy', { diet: ['V', 'VG', 'N'] }),
          note('All served with Gravy, Yorkshire Pudding, Roast Potatoes, Cauliflower Cheese and Vegetables (GFO)'),
        ]),
        section('Alternative Main Courses', [
          dish('Roasted Chicken Breast', 'Sweetcorn Cream, Chilli Oil, Sautéed Potatoes', { diet: ['GFO'] }),
          dish('Saag Aloo', 'Aromatic Tomato Sauce, Roasted Butternut Squash, Toasted Seeds', { diet: VG }),
          dish('Pan Fried Seabass', 'Ginger and Garlic Sauce, New Potatoes', { diet: ['GFO'] }),
          dish('Beef Burger', 'Cheese, Haywain Sauce, Lettuce, Tomato, Fries'),
        ]),
      ]),
      row([section('Desserts', [
        dish('Chocolate Delice', 'White Chocolate Crumb', { diet: V }),
        dish('Berry Bakewell Blondie', 'Vanilla Ice Cream', { diet: V }),
        dish('Chocolate Brownie', 'Vanilla Ice Cream', { diet: ['V', 'GFO'] }),
        dish('Affogato', 'Vanilla Ice Cream, Espresso Coffee', { diet: ['V', 'GF'] }),
        dish('Banana and Caramel Panna Cotta', 'Biscuit Crumb', { diet: ['GFO'] }),
      ])], [section('', [
        dish('1 Course', '', { pid: 438 }),
        dish('2 Courses', '', { pid: 439 }),
        dish('3 Courses', '', { pid: 440 }),
      ], { boxed: true, align: 'center' })]),
    ],
  })
}

// Sunday laid out in two columns so the text can be bigger than the single-column version.
function sundayTwo() {
  const d = sunday()
  const [starters, roasts, alt] = d.rows[0].cols[0]
  const [[desserts], [prices]] = d.rows[1].cols
  return {
    ...d,
    fontSize: 13.5,
    rows: [row([starters, roasts], [alt, desserts, prices])],
  }
}

// Sunday on a landscape page, three columns.
function sundayThree() {
  const d = sunday()
  const [starters, roasts, alt] = d.rows[0].cols[0]
  const [[desserts], [prices]] = d.rows[1].cols
  return {
    ...d,
    orientation: 'landscape',
    fontSize: 13,
    header: { ...d.header, logo: 'none' },
    rows: [
      row([logo(60), starters], [roasts], [alt]),
      { ...row([prices], [{ ...desserts, itemColumns: 2 }]), widths: 'calc((100% - 8mm) / 3) 1fr' },
    ],
  }
}

function breakfast() {
  return docBase({
    fontSize: 10,
    priceFormat: '2dp',
    header: { logo: 'left', title: '', titleStyle: 'plain', text: 'Breakfast and Brunch\n9.30 – 11.30\nSaturdays and Sundays' },
    rows: [
      row([
        section('Cooked Breakfast', [
          dish('Full', 'Pork Sausage, Two eggs, Haywain Cured Bacon, Grilled Tomato, Mushrooms, Black Pudding, Beans and Toast', { pid: 442 }),
          dish('Full Veggie', 'Savoury Waffle, Portobello mushroom, Two eggs, Grilled Tomato and Beans', { pid: 443 }),
          dish('Full Vegan', 'Wholegrain Toast, Smashed Avocado, Portobello mushroom and Grilled tomato', { pid: 444 }),
        ], { right: true }),
        section('', [
          dish('Breakfast Sharing Board - For Two', 'Sausages, Eggs, Haywain Cured Bacon, Tomatoes, Mushrooms, Black Pudding, Beans, Savoury Waffle and Toast', { pid: 445 }),
        ], { align: 'center' }),
      ]),
      row(
        [section('Waffles', [
          dish('Poached Egg Waffle', 'Savoury Waffle, Poached Eggs, Hollandaise', { pid: 446 }),
          dish('Bacon Waffle', 'Savoury Waffle, Poached Eggs, Haywain Cured Bacon, Hollandaise', { pid: 447 }),
          dish('Salmon Waffle', 'Savoury Waffle, Poached Eggs, Smoked Salmon, Hollandaise', { pid: 448 }),
        ], { boxed: true, right: true })],
        [section('Breakfast Rolls', [
          note('Ciabatta filled with your choice of the following:'),
          dish('Haywain Cured Bacon', '', { pid: 449, plain: true }),
          dish('Pork Sausage', '', { pid: 450, plain: true }),
          dish('Free range omelette', '', { pid: 451, plain: true }),
          dish('Haywain Bacon and Pork Sausage', '', { pid: 452, plain: true }),
          note('Why not add a Fried Egg or Black Pudding?'),
        ], { boxed: true, right: true })],
      ),
      row([], [section('Sweet Waffles', [
        dish('Maple Syrup', '', { pid: 453, plain: true }),
        dish('Banana and Cinnamon Sugar', '', { pid: 454, plain: true }),
      ], { boxed: true, right: true })], []),
      row([section('Drinks', [], { align: 'center' })]),
      row(
        [section('The Old Chapel Coffee Company', [
          dish('Americano', '', { pid: 455, plain: true }),
          dish('Latte', '', { pid: 456, plain: true }),
          dish('Cappuccino', '', { pid: 457, plain: true }),
          dish('Espresso', '', { pid: 458, plain: true }),
          dish('De-Caff', '', { pid: 459, plain: true }),
        ], { right: true })],
        [section('Twist Teas', [
          ...['English Breakfast', 'Propermint', 'Green Tea', 'Super Berries', 'Restore'].map(n => dish(n, '', { plain: true })),
        ], { hpPid: 460 })],
      ),
    ],
  })
}

function dessert() {
  return docBase({
    orientation: 'landscape',
    fontSize: 11,
    dietaryStyle: 'muted',
    footer: 'www.thehaywain.co.uk\n@TheHaywainPub',
    rows: [row(
      [section('Desserts', [
        dish('Chocolate Brownie', 'Vanilla Ice Cream', { pid: 480, diet: ['V', 'GFO'] }),
        dish('White Chocolate Tiramisu', 'Cocoa Dust', { pid: 481 }),
        dish('Affogato', 'Vanilla Ice Cream with a Shot of Espresso', { pid: 482, diet: ['V', 'GF'] }),
        dish('Chocolate Delice', 'Whipped Cream', { pid: 483, diet: V }),
      ], { side: true, align: 'center' })],
      [section('After Dinner Drinks', [
        heading('Coffee'),
        note('Old Chapel Coffee - from 3.8\nAmericano, Latte, Flat White, Cappuccino'),
        heading('Tea'),
        note('Twist Teas - 3.1\n24/7, Classic Earl, Super Berries, Refresher Green, Restore, Propermint'),
      ], { side: true, align: 'center' })],
    )],
  })
}

const kidsBreakfast = () => section('Breakfast', [
  note('Served 9.30am until 11.30am'),
  dish('Sweet Waffles', 'Waffle with Maple Syrup\nWaffle with Banana and Cinnamon Sugar', { pid: 465 }),
  note('Add Ice Cream - 1.5'),
  dish('Mini Breakfast', 'Includes Toast\nChoose three items from the below -\nBacon, Sausage, Egg, Beans, Tomato, Mushrooms', { pid: 467 }),
  note('Add extras - 1.5'),
])

const kidsShell = (rows) => docBase({
  fontSize: 10,
  header: { logo: 'none', title: 'The Little Harvest\nKids Menu', titleStyle: 'hand', text: '' },
  rows,
})

function kids() {
  const p = (n, pid) => dish(n, '', { pid, plain: true })
  return kidsShell([
    row([kidsBreakfast()], [image('animals', 100)]),
    row(
      [image('tractor', 100)],
      [section('Lunch and Dinner', [
        p('Garlic Bread', 468),
        note('_____'),
        p('Battered Fish and Chips', 469),
        p('Pasta and Cheese Sauce', 470),
        p('Sausage with Mash or Chips', 471),
        p('Beef Burger and Fries', 472),
        p('Breaded Chicken and Chips', 473),
        p('Grilled Chicken and New Potatoes', 474),
        note('Served with Vegetables or Baked Beans'),
        note('_____'),
        p('Chocolate Brownie', 475),
        p('Berry Sundae', 476),
        p('Brownie Waffle', 477),
        p('Chocolate Sundae', 478),
      ])],
    ),
    row([], [logo(75)]),
  ])
}

function sundayKids() {
  const t = (n, price) => dish(n, '', { price, plain: true })
  return kidsShell([
    row([kidsBreakfast()], [image('animals', 100)]),
    row(
      [image('tractor', 100)],
      [section('Sunday Lunch', [
        t('Garlic Bread', '5'),
        note('_____'),
        t('Battered Fish and Chips', '10'),
        t('Pasta and Cheese Sauce', '8'),
        t('Sausage with Mash or Chips', '9'),
        t('Beef Burger and Fries', '9'),
        t('Breaded Chicken and Chips', '9'),
        t('Grilled Chicken and New Potatoes', '9'),
        note('Served with Vegetables or Baked Beans'),
        note('_____'),
        dish('Sunday Roast', 'Beef Brisket, Lamb, Pork or Top Rump served with Roast Potatoes, Yorkshire Pudding, Vegetables, Cauliflower Cheese and Gravy', { pid: 479, plain: true }),
        note('_____'),
        t('Chocolate Brownie', '5'),
        t('Berry Sundae', '5'),
        t('Chocolate Sundae', '5'),
      ], { right: true })],
    ),
    row([], [logo(75)]),
  ])
}

/** Fresh copies each call (new ids), in the order they appear as tabs. */
export const haywainMenuSeeds = () => [
  { name: 'Evening', sort: 1, doc: evening() },
  { name: 'Lunch', sort: 2, doc: lunch() },
  { name: 'Sunday', sort: 3, doc: sunday() },
  { name: 'Breakfast', sort: 4, doc: breakfast() },
  { name: 'Desserts', sort: 5, doc: dessert() },
  { name: 'Sunday 2', sort: 3, doc: sundayTwo() },
  { name: 'Sunday 3', sort: 3, doc: sundayThree() },
  { name: 'Kids', sort: 6, doc: kids() },
  { name: 'Sunday Kids', sort: 7, doc: sundayKids() },
]
