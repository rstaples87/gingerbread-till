import styles from './Nav.module.css'

export default function Nav({ view, setView, openTabsCount }) {
  const tabs = [
    { key: 'till', label: 'Till' },
    { key: 'tabs', label: openTabsCount > 0 ? `Tabs (${openTabsCount})` : 'Tabs' },
    { key: 'stock', label: 'Stock' },
    { key: 'sales', label: 'Sales' },
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
