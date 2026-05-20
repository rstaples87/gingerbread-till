export const EOD_REPORTS_STORAGE_KEY = 'bt_eod_reports'
export const MAX_LOCAL_EOD_REPORTS = 5

export function serializeTransactionForReport(tx) {
  return {
    ...tx,
    time: tx.time instanceof Date ? tx.time.toISOString() : tx.time,
    voidedAt: tx.voidedAt instanceof Date ? tx.voidedAt.toISOString() : tx.voidedAt ?? undefined,
  }
}

export function buildEodReportData({
  generatedAt,
  reportDate,
  subtitle,
  float,
  actualCashInTill,
  discrepancyAmount,
  discrepancyReason,
  expectedCashInTill,
  totalTakings,
  totalItems,
  cashTotal,
  cardTotal,
  accountTotal,
  liveTransactionCount,
  popSorted,
  staffMap,
  tabTx,
  voidedTx,
  transactions,
}) {
  const session_date = reportDate ?? new Date().toISOString().split('T')[0]

  return {
    generatedAt,
    reportDate,
    session_date,
    subtitle,
    float,
    actualCashInTill,
    discrepancyAmount,
    discrepancyReason,
    expectedCashInTill,
    takings: {
      totalTakings,
      totalItems,
      cashTotal,
      cardTotal,
      accountTotal,
      transactionCount: liveTransactionCount,
    },
    cashReconciliation: {
      cashSales: cashTotal,
      startingFloat: float,
      expectedCashInTill,
      cashToBank: cashTotal,
    },
    topSellers: popSorted.map(([name, qty]) => ({ name, qty })),
    staffBreakdown: Object.entries(staffMap).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
    })),
    tabsSettled: tabTx.map(t => ({
      tabName: t.tabName,
      total: t.total,
      time: t.time instanceof Date ? t.time.toISOString() : t.time,
    })),
    voidedTransactions: voidedTx.map(t => ({
      id: t.id,
      total: t.total,
      time: t.time instanceof Date ? t.time.toISOString() : t.time,
      items: t.items,
    })),
    transactions: transactions.map(serializeTransactionForReport),
  }
}

export function appendLocalEodReport(existing, entry) {
  return [entry, ...existing].slice(0, MAX_LOCAL_EOD_REPORTS)
}

/** Synchronous localStorage write for close till (step 2) before React state update. */
/** Read saved EOD reports from localStorage only (not live session). */
export function readSavedEodReportsFromStorage() {
  try {
    const raw = localStorage.getItem(EOD_REPORTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistEodReportEntry(existing, entry) {
  const next = appendLocalEodReport(existing, entry)
  try {
    localStorage.setItem(EOD_REPORTS_STORAGE_KEY, JSON.stringify(next))
  } catch (err) {
    console.warn('persistEodReportEntry:', err)
  }
  return next
}
