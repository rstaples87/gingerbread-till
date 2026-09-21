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

export const features = {
  // VAT rate and food/drink group are always recorded on sales (defaults: 20%, drink);
  // only the editor fields for changing them are POS-only.
  taxFieldsInProductEditor: isPosMode,
  // Manager-only Reports view (sales inc/ex VAT, food/drink, by item/time, stock levels).
  // On in both builds for now so it can be tried on the events Till; set to isPosMode to make it POS-only.
  reports: true,
}
