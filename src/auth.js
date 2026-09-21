import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Venue login: one shared Supabase Auth account per venue, entered once per tablet.
 * Staff never log in — they use PINs on top of this session.
 *
 * Offline rule: a tablet counts as signed in if a session is *stored on the device*, even when its
 * short-lived token has expired and can't refresh without signal. We never sign out because of a
 * network problem.
 */

function storedAuthSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue
      const parsed = JSON.parse(localStorage.getItem(key) || 'null')
      if (parsed?.user) return parsed
    }
  } catch {}
  return null
}

export function useVenueAuth() {
  const [stored, setStored] = useState(() => storedAuthSession())
  const [ready, setReady] = useState(!supabase)
  // True when a session is stored on the device but the server says it's no longer usable (checked online only).
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    if (!supabase) return undefined
    let alive = true
    // Reads/refreshes the session; its result is not trusted for "signed in" (it fails offline).
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!alive) return
        const online = typeof navigator === 'undefined' || navigator.onLine !== false
        const networkProblem = error && (error.name === 'AuthRetryableFetchError' || /fetch|network/i.test(String(error.message)))
        // Signal loss must never look like a bad login; only an online, non-network refusal does.
        setRejected(Boolean(online && !data?.session && !networkProblem && storedAuthSession()))
      })
      .catch(() => {})
      .finally(() => {
        if (alive) {
          setStored(storedAuthSession())
          setReady(true)
        }
      })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return
      if (session) {
        setRejected(false)
        // Live updates are subject to the database rules too: make sure realtime carries this login.
        try { supabase.realtime.setAuth(session.access_token) } catch {}
      }
      setStored(storedAuthSession())
    })
    return () => {
      alive = false
      data?.subscription?.unsubscribe()
    }
  }, [])

  return {
    ready,
    signedIn: Boolean(stored) && !rejected,
    email: stored?.user?.email ?? null,
  }
}

export async function signInVenue(email, password) {
  if (!supabase) return { error: new Error('Supabase not configured') }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return { error: error ?? null }
}

export async function signOutVenue() {
  if (!supabase) return
  try {
    await supabase.auth.signOut()
  } catch {}
}
