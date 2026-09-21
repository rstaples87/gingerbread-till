import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && key)

/**
 * The database only accepts signed-in venue requests. A device with no venue session would just be
 * refused (and its empty replies could look like "no data"), so treat it exactly like being offline:
 * data calls fail as a network error, the app falls back to its local copy, and writes wait in the
 * sync queue until the device is signed in. Auth calls (sign in / token refresh) are not blocked.
 */
function venueGuardedFetch(input, init) {
  try {
    const target = typeof input === 'string' ? input : (input?.url ?? String(input))
    if (target.includes('/rest/v1/')) {
      const headers = new Headers(init?.headers ?? (typeof input === 'object' ? input.headers : undefined))
      if (headers.get('Authorization') === `Bearer ${key}`) {
        return Promise.reject(new TypeError('Failed to fetch (venue not signed in)'))
      }
    }
  } catch {}
  return fetch(input, init)
}

export const supabase = isSupabaseConfigured
  ? createClient(url, key, { global: { fetch: venueGuardedFetch } })
  : null
