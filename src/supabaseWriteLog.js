/** Standard log for every Supabase mutation. */
export function logSupabaseWrite(table, operation, error) {
  console.log('[Supabase write]', table, operation, error ?? 'ok')
}
