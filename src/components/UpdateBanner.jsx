import { useEffect, useState } from 'react'

const CHECK_EVERY_MS = 5 * 60 * 1000

const barStyle = {
  position: 'fixed',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: '#fff',
  color: '#1e1f26',
  border: '1px solid #d9dbe1',
  borderLeft: '4px solid #f59e0b',
  borderRadius: 10,
  boxShadow: '0 4px 20px rgba(0,0,0,.25)',
  padding: '10px 12px 10px 16px',
  fontSize: 14,
  maxWidth: 'calc(100vw - 24px)',
}

/** Shows a refresh prompt when a newer deployment has gone live while the app is open. */
export default function UpdateBanner() {
  const [available, setAvailable] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return undefined
    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.id && data.id !== __BUILD_ID__) setAvailable(true)
      } catch {
        // Offline or non-JSON response — try again next time.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }

    const timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    check()
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!available || dismissed) return null

  return (
    <div style={barStyle} role="status">
      <span>A new version of Gingerbread Till is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ background: '#f59e0b', color: '#1e1f26', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}
      >
        Refresh now
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', fontSize: 18, lineHeight: 1, cursor: 'pointer', color: '#666875', padding: '0 4px' }}
      >
        ×
      </button>
    </div>
  )
}
