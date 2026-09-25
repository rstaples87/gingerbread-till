/**
 * One codebase, two deployments: the events Till and the Haywain POS.
 * Which one this build is comes from VITE_APP_MODE ('pos' for the POS; anything else = events Till).
 * POS-only features are switched on here so the events Till stays exactly as simple as it is today.
 */
export const APP_MODE = import.meta.env.VITE_APP_MODE === 'pos' ? 'pos' : 'till'
export const isPosMode = APP_MODE === 'pos'

/** Names shown to staff. The events Till and the Haywain POS are the same code with different branding. */
export const branding = {
  productName: isPosMode ? 'POS' : 'Till',
  tagline: isPosMode ? 'FOOD & DRINK' : 'EVENT MANAGEMENT',
  appTitle: isPosMode ? 'Gingerbread POS' : 'Gingerbread Till',
}

/** What goes on the customer-facing printed bill/receipt — the venue's own name, not the app's. */
export const receiptBranding = {
  name: isPosMode ? 'THE HAYWAIN' : branding.appTitle,
  tagline: isPosMode ? 'Country Pub & Kitchen' : '',
  // The Haywain's own logo, used instead of the plain text name/tagline above when set.
  logo: isPosMode ? '/haywain-logo.png' : null,
}

export const features = {
  // VAT rate and food/drink group are always recorded on sales (defaults: 20%, drink);
  // only the editor fields for changing them are POS-only.
  taxFieldsInProductEditor: isPosMode,
  // Manager-only Reports view (sales inc/ex VAT, food/drink, by item/time, stock levels).
  // On in both builds for now so it can be tried on the events Till; set to isPosMode to make it POS-only.
  reports: true,
  // Dish options (e.g. steak cooking, chips or saute) and per-item notes. POS only.
  foodOptions: isPosMode,
  // Table plan (areas, numbered tables, covers). POS only.
  tables: isPosMode,
  // Kitchen display + bar display: one send from the till splits food (kitchen) and drinks (bar). POS only.
  stations: isPosMode,
  // Discounts and comps (free items) on tables, tabs and quick sales. POS only.
  discounts: isPosMode,
  // Optional tip added on the final payment screen only (never part of the bill, sales or VAT). POS only.
  tips: isPosMode,
  // Printable menus: templates per sitting (lunch, evening, kids...) the team can edit and print. POS only.
  menus: isPosMode,
}

/** Quick tip choices, as a percentage of the amount being paid. */
export const TIP_PERCENTS = [10, 12.5, 15]
