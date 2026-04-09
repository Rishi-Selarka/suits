import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Calendar, List, ChevronLeft, ChevronRight } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

const DATE_RE = /\b(\d{1,2}[\s/-]\w+[\s/-]\d{2,4}|\w+ \d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})\b/gi
const TIME_KEYWORDS = /(\d+)\s*(day|week|month|year|business day)s?/gi

interface DeadlineItem {
  clauseId: number
  text: string
  match: string
  page: number
}

export function extractDeadlines(result: AnalysisResult): DeadlineItem[] {
  const items: DeadlineItem[] = []
  const seen = new Set<string>()

  for (const clause of result.clauses) {
    const dateMatches = clause.text.match(DATE_RE) || []
    const timeMatches = clause.text.match(TIME_KEYWORDS) || []

    for (const match of [...dateMatches, ...timeMatches]) {
      const key = `${clause.clause_id}-${match}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        clauseId: clause.clause_id,
        text: clause.title || clause.text.slice(0, 120),
        match,
        page: clause.page_number,
      })
    }
  }
  return items
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
}

// Extracts a date from a string using multiple strategies
function parseDeadlineDate(input: string): Date | null {
  const s = input.trim()

  // Skip pure relative time periods ("30 days", "6 months", etc.)
  if (/^\d+\s*(day|week|month|year|business day)s?$/i.test(s)) return null

  // Strategy 1: ISO format "2025-01-15"
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3])
    if (!isNaN(d.getTime())) return d
  }

  // Strategy 2: "Month dd, yyyy" or "Month dd yyyy" — e.g. "January 15, 2025"
  const mdy = s.match(/([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})/i)
  if (mdy) {
    const m = MONTH_MAP[mdy[1].toLowerCase()]
    if (m !== undefined) {
      const d = new Date(+mdy[3], m, +mdy[2])
      if (!isNaN(d.getTime())) return d
    }
  }

  // Strategy 3: "dd Month yyyy" or "ddth Month yyyy" — e.g. "15th January 2025", "1st of March 2024", "1st day of January, 2025"
  const dmy = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+)?(?:of\s+)?([A-Za-z]+)\s*,?\s*(\d{4})/i)
  if (dmy) {
    const m = MONTH_MAP[dmy[2].toLowerCase()]
    if (m !== undefined) {
      const d = new Date(+dmy[3], m, +dmy[1])
      if (!isNaN(d.getTime())) return d
    }
  }

  // Strategy 4: "dd-Mon-yyyy" or "dd/Mon/yyyy" — e.g. "01-Jan-2025", "15/Jun/2024"
  const dMonY = s.match(/(\d{1,2})[\s/.-]+([A-Za-z]+)[\s/.-]+(\d{2,4})/i)
  if (dMonY) {
    const m = MONTH_MAP[dMonY[2].toLowerCase()]
    if (m !== undefined) {
      const yr = +dMonY[3] < 100 ? 2000 + +dMonY[3] : +dMonY[3]
      const d = new Date(yr, m, +dMonY[1])
      if (!isNaN(d.getTime())) return d
    }
  }

  // Strategy 5: Pure numeric "dd/mm/yyyy" or "dd-mm-yyyy"
  const numeric = s.match(/(\d{1,2})[\s/.-]+(\d{1,2})[\s/.-]+(\d{2,4})/)
  if (numeric) {
    const yr = +numeric[3] < 100 ? 2000 + +numeric[3] : +numeric[3]
    // Assume dd/mm/yyyy
    const d = new Date(yr, +numeric[2] - 1, +numeric[1])
    if (!isNaN(d.getTime())) return d
  }

  // Strategy 6: Native Date as last resort
  const native = new Date(s)
  if (!isNaN(native.getTime()) && native.getFullYear() > 1970) return native

  return null
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Stacked View (original) ──

function StackedView({ deadlines }: { deadlines: DeadlineItem[] }) {
  return deadlines.length === 0 ? (
    <p className="text-center text-cream-400 py-12">No date references found in this document.</p>
  ) : (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
      {deadlines.map((d, i) => (
        <motion.div
          key={`${d.clauseId}-${d.match}-${i}`}
          variants={staggerItem}
          className="flex items-start gap-4 bg-white rounded-2xl border border-cream-200 p-4"
        >
          <div className="w-10 h-10 rounded-xl bg-suits-500/10 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4 text-suits-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-md bg-suits-50 text-suits-700 text-xs font-medium">{d.match}</span>
              <span className="text-xs text-cream-400">Clause {d.clauseId} · Page {d.page}</span>
            </div>
            <p className="text-sm text-surface-300 line-clamp-2">{d.text}</p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  )
}

// ── Calendar View ──

function CalendarView({ deadlines }: { deadlines: DeadlineItem[] }) {
  const today = new Date()

  // Build a map of date-string -> deadlines for quick lookup
  const dateMap = new Map<string, DeadlineItem[]>()
  let firstDeadlineDate: Date | null = null
  for (const d of deadlines) {
    const parsed = parseDeadlineDate(d.match)
    if (!parsed) continue
    if (!firstDeadlineDate) firstDeadlineDate = parsed
    const key = `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}`
    const existing = dateMap.get(key) || []
    existing.push(d)
    dateMap.set(key, existing)
  }

  // Start on the first deadline's month, or today if none parsed
  const startDate = firstDeadlineDate || today
  const [year, setYear] = useState(startDate.getFullYear())
  const [month, setMonth] = useState(startDate.getMonth())
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month')

  // Check if a month has any deadlines
  const monthHasDeadlines = (y: number, m: number) => {
    for (const [key] of dateMap) {
      const [dy, dm] = key.split('-').map(Number)
      if (dy === y && dm === m) return true
    }
    return false
  }

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  if (viewMode === 'year') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-xl mx-auto space-y-3">
        {/* Year header */}
        <div className="flex items-center justify-between">
          <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded-lg hover:bg-cream-100 text-surface-400 hover:text-surface-200 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-surface-200">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded-lg hover:bg-cream-100 text-surface-400 hover:text-surface-200 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-3 gap-2">
          {MONTH_NAMES.map((name, i) => {
            const hasDeadlines = monthHasDeadlines(year, i)
            return (
              <button
                key={name}
                onClick={() => { setMonth(i); setViewMode('month') }}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                  hasDeadlines
                    ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                    : 'border-cream-200 bg-white text-surface-300 hover:bg-cream-100',
                )}
              >
                {name}
              </button>
            )
          })}
        </div>
      </motion.div>
    )
  }

  // ── Month view ──
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  // Build weeks as rows of 7 cells (null = empty cell)
  const weeks: (number | null)[][] = []
  let currentWeek: (number | null)[] = Array.from({ length: firstDay }, () => null)
  for (let d = 1; d <= daysInMonth; d++) {
    currentWeek.push(d)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-xl mx-auto space-y-3">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-cream-100 text-surface-400 hover:text-surface-200 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => setViewMode('year')}
          className="text-base font-semibold text-surface-200 hover:text-suits-600 transition-colors"
        >
          {MONTH_NAMES[month]} {year}
        </button>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-cream-100 text-surface-400 hover:text-surface-200 transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1.5">
        {DAY_HEADERS.map(day => (
          <div key={day} className="text-center text-xs font-medium text-cream-400 py-1.5">{day}</div>
        ))}
      </div>

      {/* Calendar rows */}
      <div className="space-y-1.5">
        {weeks.map((week, wi) => {
          // Check if any cell in this row has deadlines
          const rowHasContent = week.some(d => {
            if (!d) return false
            const key = `${year}-${month}-${d}`
            return (dateMap.get(key) || []).length > 0
          })

          return (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map((day, di) => {
                if (day === null) {
                  return <div key={`empty-${wi}-${di}`} className={rowHasContent ? 'min-h-[3.5rem]' : 'min-h-[2.75rem]'} />
                }

                const key = `${year}-${month}-${day}`
                const dayDeadlines = dateMap.get(key) || []
                const hasDeadlines = dayDeadlines.length > 0
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

                return (
                  <div
                    key={day}
                    className={cn(
                      'rounded-lg border p-1.5 flex flex-col transition-all relative group',
                      rowHasContent ? 'min-h-[3.5rem]' : 'min-h-[2.75rem]',
                      hasDeadlines
                        ? 'border-red-300 bg-red-50'
                        : 'border-cream-200 bg-white',
                      isToday && 'ring-2 ring-suits-500/30',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        hasDeadlines ? 'text-red-600' : 'text-surface-300',
                        isToday && 'text-suits-600',
                      )}
                    >
                      {day}
                    </span>
                    {hasDeadlines && (
                      <div className="mt-0.5 space-y-0.5 overflow-hidden">
                        {dayDeadlines.map((dl, idx) => (
                          <p key={idx} className="text-[10px] leading-tight text-red-500 font-medium truncate">
                            {dl.text}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Tooltip on hover */}
                    {hasDeadlines && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-surface-100 text-white rounded-xl p-3 text-xs opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                        {dayDeadlines.map((dl, idx) => (
                          <div key={idx} className={idx > 0 ? 'mt-2 pt-2 border-t border-white/10' : ''}>
                            <p className="font-medium text-red-300">{dl.match}</p>
                            <p className="text-white/70 mt-0.5">Clause {dl.clauseId} · Page {dl.page}</p>
                            <p className="text-white/50 line-clamp-2 mt-0.5">{dl.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* All deadlines list */}
      {deadlines.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-medium text-cream-400 uppercase tracking-wider">All Deadlines &amp; Obligations</h3>
          {deadlines.map((dl, i) => {
            const parsed = parseDeadlineDate(dl.match)
            return (
              <div
                key={`${dl.clauseId}-${dl.match}-${i}`}
                className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-3"
              >
                <div className="shrink-0 px-2 py-0.5 rounded-md bg-red-100 text-red-600 text-xs font-semibold whitespace-nowrap">
                  {dl.match}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-700">{dl.text}</p>
                  <p className="text-xs mt-0.5 text-red-400">
                    Clause {dl.clauseId} · Page {dl.page}
                    {parsed && ` · ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}

// ── Main Content ──

export function DeadlineTrackerContent({ result }: { result: AnalysisResult }) {
  const [view, setView] = useState<'stacked' | 'calendar'>('stacked')
  const deadlines = useMemo(() => extractDeadlines(result), [result])

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex items-center gap-2 bg-cream-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView('stacked')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            view === 'stacked'
              ? 'bg-white text-surface-200 shadow-sm'
              : 'text-cream-400 hover:text-surface-300',
          )}
        >
          <List className="w-4 h-4" />
          Stacked
        </button>
        <button
          onClick={() => setView('calendar')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            view === 'calendar'
              ? 'bg-white text-surface-200 shadow-sm'
              : 'text-cream-400 hover:text-surface-300',
          )}
        >
          <Calendar className="w-4 h-4" />
          Calendar
        </button>
      </div>

      {/* Content */}
      {view === 'stacked' ? (
        <StackedView deadlines={deadlines} />
      ) : (
        <CalendarView deadlines={deadlines} />
      )}
    </div>
  )
}

export default function DeadlineTrackerPage() {
  return (
    <ToolLayout title="Deadline Tracker" description="Dates, periods, and time-sensitive obligations" icon={Calendar} exportType="deadlines">
      {(result) => <DeadlineTrackerContent result={result} />}
    </ToolLayout>
  )
}
