import { useState, useEffect } from 'react'
import styles from './Header.module.css'

export default function Header({ currentStaff, onStaffClick }) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img
          className={styles.logo}
          src="/logo.svg"
          alt=""
          width={36}
          height={36}
        />
        <div>
          <div className={styles.title}>Gingerbread Till</div>
          <div className={styles.sub}>v3.3</div>
        </div>
      </div>
      <div className={styles.right}>
        <button className={styles.staffPill} onClick={onStaffClick}>
          👤 {currentStaff || 'Select staff'}
        </button>
        <span className={styles.clock}>{time}</span>
      </div>
    </header>
  )
}
