/** Log failed Supabase mutations only. */
export function logSupabaseWrite(table, operation, error) {
  if (error) console.warn('[Supabase write]', table, operation, error)
}
