import styles from './Nav.module.css'
import { features } from '../features'

export default function Nav({ view, setView, openTabsCount }) {
  const tabs = [
    { key: 'till', label: 'Till' },
    ...(features.tables ? [{ key: 'tables', label: 'Tables' }] : []),
    ...(features.stations
      ? [{ key: 'kitchen', label: 'Kitchen Display' }, { key: 'bar', label: 'Bar Display' }]
      : [{ key: 'bar', label: 'Bar Display System' }]),
    { key: 'tabs', label: openTabsCount > 0 ? `Tabs (${openTabsCount})` : 'Tabs' },
    { key: 'stock', label: 'Stock' },
    { key: 'staff', label: 'Staff' },
    { key: 'sales', label: 'Sales' },
    ...(features.reports ? [{ key: 'reports', label: 'Reports' }] : []),
    ...(features.menus ? [{ key: 'menus', label: 'Menus' }] : []),
    { key: 'settings', label: 'Settings' },
  ]
  return (
    <nav className={styles.nav}>
      {tabs.map(t => (
        <button
          key={t.key}
          className={`${styles.btn} ${view === t.key ? styles.active : ''}`}
          onClick={() => setView(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
