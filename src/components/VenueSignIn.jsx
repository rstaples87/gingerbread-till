import { useState } from 'react'
import { signInVenue } from '../auth'
import styles from './VenueSignIn.module.css'

/** One-time venue sign-in for this tablet. "Skip" exists only until the database rules are switched on. */
export default function VenueSignIn({ onDone, onSkip }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError('')
    const { error: err } = await signInVenue(email, password)
    setBusy(false)
    if (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setError(offline ? 'No signal — sign in when you are back online.' : 'Sign in failed. Check the email and password.')
      return
    }
    onDone()
  }

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={submit}>
        <h2 className={styles.title}>Venue sign in</h2>
        <p className={styles.hint}>
          Sign this tablet in once. Staff still use their own PINs.
        </p>
        <input
          className={styles.input}
          type="email"
          placeholder="Venue email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={styles.input}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className={styles.error}>{error}</div>}
        <button className={styles.primary} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className={styles.skip} type="button" onClick={onSkip}>
          Skip for now
        </button>
      </form>
    </div>
  )
}
