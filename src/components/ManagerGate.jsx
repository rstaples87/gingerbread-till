import { useEffect, useState } from 'react'
import { PinDots, Numpad } from './StaffOverlay'
import styles from './StaffOverlay.module.css'

/** Shows `children` only while a manager is unlocked; otherwise asks for a manager PIN. */
export default function ManagerGate({ unlocked, verifyPin, onUnlock, title = 'Manager PIN required', children }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (pin.length !== 4) return
    if (verifyPin(pin)) {
      setError('')
      setPin('')
      onUnlock()
    } else {
      setError('Incorrect PIN')
      setPin('')
    }
  }, [pin, verifyPin, onUnlock])

  if (unlocked) return children

  return (
    <div className={styles.card} style={{ margin: '24px auto' }}>
      <div className={styles.pinHeader}>
        <div className={styles.pinSpacer} />
        <div className={styles.pinTitle}>{title}</div>
        <div className={styles.pinSpacer} />
      </div>
      <PinDots pinLength={pin.length} />
      {error ? <div className={styles.error}>{error}</div> : <div className={styles.hint}>Enter manager PIN</div>}
      <Numpad
        onDigit={(d) => { setError(''); setPin(p => (p.length >= 4 ? p : p + d)) }}
        onClear={() => { setError(''); setPin('') }}
        onDelete={() => { setError(''); setPin(p => p.slice(0, -1)) }}
        disabled={pin.length >= 4}
      />
    </div>
  )
}
