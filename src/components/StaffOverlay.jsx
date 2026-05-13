import { useEffect, useState } from 'react'
import styles from './StaffOverlay.module.css'
import { ADMIN_PIN } from '../data'

function PinDots({ pinLength }) {
  return (
    <div className={styles.dots} aria-label="PIN entry">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={`${styles.dot} ${i < pinLength ? styles.dotFilled : ''}`}
        />
      ))}
    </div>
  )
}

function Numpad({ onDigit, onClear, onDelete, disabled }) {
  const Btn = ({ children, onClick, variant }) => (
    <button
      className={`${styles.npBtn} ${variant ? styles[variant] : ''}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  )

  return (
    <div className={styles.numpad} aria-label="PIN numpad">
      {Array.from({ length: 9 }).map((_, idx) => {
        const n = idx + 1
        return (
          <Btn key={n} onClick={() => onDigit(String(n))}>
            {n}
          </Btn>
        )
      })}
      <Btn variant="npGhost" onClick={onClear}>Clear</Btn>
      <Btn onClick={() => onDigit('0')}>0</Btn>
      <Btn variant="npGhost" onClick={onDelete}>Delete</Btn>
    </div>
  )
}

export default function StaffOverlay({ onSelect, onClose }) {
  const [step, setStep] = useState('pick') // pick | pin
  const [pinFor, setPinFor] = useState(null) // { type: 'admin' }
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (step !== 'pin') return
    if (pin.length !== 4) return

    const submitted = pin
    const doFail = () => {
      setError('Incorrect PIN')
      setPin('')
    }

    if (pinFor?.type === 'admin') {
      if (submitted === ADMIN_PIN) {
        setError('')
        setPin('')
        onSelect('Manager')
        onClose()
      } else doFail()
      return
    }
  }, [pin, pinFor, step, onClose, onSelect])

  const startPinForAdmin = () => {
    setPinFor({ type: 'admin' })
    setPin('')
    setError('')
    setStep('pin')
  }

  const onDigit = (d) => {
    setError('')
    setPin(p => (p.length >= 4 ? p : p + d))
  }

  const onClear = () => {
    setError('')
    setPin('')
  }

  const onDelete = () => {
    setError('')
    setPin(p => p.slice(0, -1))
  }

  return (
    <div className={`${styles.screen} ${step === 'pick' ? styles.screenPick : ''}`}>
      {step === 'pick' ? (
        <div className={styles.pickColumn}>
          <div className={styles.heroMark}>
            <img
              className={styles.heroIcon}
              src="/logo.svg"
              alt=""
              width={80}
              height={80}
            />
            <div className={styles.heroText}>
              <div className={styles.heroGinger}>Gingerbread</div>
              <div className={styles.heroTill}>Till</div>
              <div className={styles.heroEvent}>EVENT MANAGEMENT</div>
            </div>
          </div>
          <div className={`${styles.card} ${styles.signInCard}`} role="dialog" aria-modal="true">
            <p className={styles.pickHint}>Manager sign in required</p>
            <button className={styles.adminBtn} type="button" onClick={startPinForAdmin}>
              Manager sign in
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.card} role="dialog" aria-modal="true">
          <div className={styles.pinHeader}>
            <button
              className={styles.backBtn}
              type="button"
              onClick={() => {
                setStep('pick')
                setPin('')
                setError('')
              }}
            >
              Back
            </button>
            <div className={styles.pinTitle}>Manager PIN</div>
            <div className={styles.pinSpacer} />
          </div>

          <PinDots pinLength={pin.length} />
          {error && <div className={styles.error}>{error}</div>}
          {!error && <div className={styles.hint}>Enter 4-digit PIN</div>}

          <Numpad onDigit={onDigit} onClear={onClear} onDelete={onDelete} disabled={pin.length >= 4} />
        </div>
      )}
    </div>
  )
}
