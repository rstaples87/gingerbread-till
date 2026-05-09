import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL ? 'set' : 'missing', 'Key:', import.meta.env.VITE_SUPABASE_ANON_KEY ? 'set' : 'missing')
