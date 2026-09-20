import { supabase } from './supabase'
import { logSupabaseWrite } from './supabaseWriteLog'
import { maybeQueueSyncFailure, readPendingEodReportRows } from './syncQueue'
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

export function eodRowForSupabase(entry) {
  return {
    id: entry.id,
    created_at: entry.createdAt ?? new Date().toISOString(),
    session_date: entry.session_date ?? entry.reportDate,
    report_data: entry.reportData,
  }
}

/** Upsert an EOD report; on a network failure it's queued and retried by the sync queue. */
export async function saveEodReportToSupabase(entry) {
  const row = eodRowForSupabase(entry)
  if (!supabase) {
    const err = new Error('Supabase not configured')
    maybeQueueSyncFailure('eod_report', row, err)
    return { error: err }
  }

  try {
    const { error } = await supabase.from('eod_reports').upsert(row, { onConflict: 'id' })
    logSupabaseWrite('eod_reports', 'upsert', error)
    if (error) maybeQueueSyncFailure('eod_report', row, error)
    return { error: error ?? null }
  } catch (err) {
    logSupabaseWrite('eod_reports', 'upsert', err)
    maybeQueueSyncFailure('eod_report', row, err)
    return { error: err }
  }
}

/** Remote reports plus any still-queued local ones, newest first, capped. */
function mergeWithPendingEodReports(remote) {
  const byId = new Map()
  for (const r of remote) byId.set(r.id, r)
  for (const row of readPendingEodReportRows()) {
    if (!byId.has(row.id)) byId.set(row.id, normaliseEodReportRow(row))
  }
  return Array.from(byId.values())
    .sort((a, b) =>
      String(b.session_date ?? '').localeCompare(String(a.session_date ?? ''))
      || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, MAX_LOCAL_EOD_REPORTS)
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
    const merged = mergeWithPendingEodReports(remote)
    cacheEodReportsLocally(merged)
    return merged
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
    const merged = mergeWithPendingEodReports(remote)
    cacheEodReportsLocally(merged)
    return merged
  }
  return localNext
}
