import styles from './StaffOverlay.module.css'

export default function StaffOverlay({ staff, setStaff, currentStaff, onSelect, onClose }) {
  const addStaff = () => {
    const name = prompt('Enter staff member name:')
    if (name?.trim()) setStaff(prev => [...prev, name.trim()])
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>Who's serving?</h2>
        <p className={styles.sub}>Select your name to log sales against you</p>
        <div className={styles.grid}>
          {staff.map(name => (
            <button
              key={name}
              className={`${styles.btn} ${currentStaff === name ? styles.selected : ''}`}
              onClick={() => onSelect(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <button className={styles.addBtn} onClick={addStaff}>+ Add staff member</button>
      </div>
    </div>
  )
}
