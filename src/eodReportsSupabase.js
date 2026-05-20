import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import {
  EOD_REPORTS_STORAGE_KEY,
  MAX_LOCAL_EOD_REPORTS,
  readSavedEodReportsFromStorage,
  appendLocalEodReport,
} from './eodReports'

export function normaliseEodReportRow(row) {
  if (!row) return null
  let reportData = row.report_data
  if (typeof reportData === 'string') {
    try {
      reportData = JSON.parse(reportData)
    } catch {
      reportData = {}
    }
  }
  const sessionDate = row.session_date ?? reportData?.session_date ?? reportData?.reportDate
  return {
    id: row.id,
    createdAt: row.created_at,
    closedAt: row.created_at,
    reportDate: sessionDate,
    session_date: sessionDate,
    totalTakings: reportData?.takings?.totalTakings ?? 0,
    reportData: reportData ?? {},
  }
}

/** Fetch the 5 most recent EOD reports (Supabase source of truth). */
export async function fetchRecentEodReportsFromSupabase(limit = MAX_LOCAL_EOD_REPORTS) {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('eod_reports')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('fetchRecentEodReportsFromSupabase:', error)
    return null
  }

  return (data ?? []).map(normaliseEodReportRow).filter(Boolean)
}

export async function saveEodReportToSupabase(entry) {
  if (!supabase) {
    return { error: new Error('Supabase not configured') }
  }

  const row = {
    id: entry.id,
    created_at: entry.createdAt ?? new Date().toISOString(),
    session_date: entry.session_date ?? entry.reportDate,
    report_data: entry.reportData,
  }

  const { error } = await supabase.from('eod_reports').upsert(row, { onConflict: 'id' })
  logSupabaseWrite('eod_reports', 'upsert', error)
  return { error: error ?? null }
}

function cacheEodReportsLocally(reports) {
  try {
    localStorage.setItem(EOD_REPORTS_STORAGE_KEY, JSON.stringify(reports))
  } catch (err) {
    console.warn('cacheEodReportsLocally:', err)
  }
}

/** Supabase first; localStorage fallback if unavailable or empty. */
export async function loadEodReportsWithFallback() {
  const remote = await fetchRecentEodReportsFromSupabase()
  if (remote?.length) {
    cacheEodReportsLocally(remote)
    return remote
  }
  return readSavedEodReportsFromStorage()
}

/** Save to Supabase and local cache; returns updated list (remote refresh or local append). */
export async function persistEodReportEntryRemote(existing, entry) {
  const localNext = appendLocalEodReport(existing, entry)
  cacheEodReportsLocally(localNext)

  const { error } = await saveEodReportToSupabase(entry)
  if (error) {
    console.warn('persistEodReportEntryRemote Supabase save failed:', error)
    return localNext
  }

  const remote = await fetchRecentEodReportsFromSupabase()
  if (remote?.length) {
    cacheEodReportsLocally(remote)
    return remote
  }
  return localNext
}
