import axios from 'axios'

const API_BASE = '/api'

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// ── Types matching backend models (models.py) ──

export interface UploadResponse {
  document_id: string
  filename: string
  page_count: number
  status: 'processing' | 'cached'
}

export interface SSEEvent {
  agent: string
  status: 'running' | 'complete' | 'error' | 'cached'
  data?: Record<string, unknown>
  timing_ms?: number
  model_used?: string
  error?: string
}

export interface Clause {
  clause_id: number
  section_number: string | null
  title: string
  text: string
  page_number: number
  clause_type_hint: string | null
}

export interface ClassificationResult {
  clause_id: number
  category: string
  subcategory: string
  confidence: number
  secondary_category: string | null
}

export interface SimplificationResult {
  clause_id: number
  original_length: number
  simplified_text: string
  simplified_length: number
  jargon_replaced: string[]
  hidden_implications: string | null
}

export interface RiskResult {
  clause_id: number
  risk_score: number
  risk_level: 'GREEN' | 'YELLOW' | 'RED'
  perspective: string
  flags: string[]
  reasoning: string
  specific_concern: string | null
  suggested_modification: string | null
  india_specific_note: string | null
}

export interface BenchmarkResult {
  clause_id: number
  document_type_detected: string
  deviation_level: 'STANDARD' | 'MODERATE_DEVIATION' | 'SIGNIFICANT_DEVIATION' | 'AGGRESSIVE'
  benchmark_comparison: string
  industry_norm: string
  is_missing_standard_protection: boolean
  missing_protection_detail: string | null
}

export interface DocumentSummary {
  document_type: string
  parties: string[]
  effective_date: string | null
  duration: string | null
  total_clauses_analyzed: number
  key_financial_terms: string | null
}

export interface OverallRiskAssessment {
  score: number
  level: 'LOW_RISK' | 'MODERATE_RISK' | 'HIGH_RISK' | 'CRITICAL_RISK'
  verdict: 'SIGN' | 'NEGOTIATE' | 'WALK_AWAY'
  verdict_reasoning: string
}

export interface CriticalIssue {
  priority: number
  clause_id: number
  issue_title: string
  issue_description: string
  impact: string
  recommended_action: string
  suggested_counter_language: string
}

export interface PositiveAspect {
  clause_id: number
  description: string
}

export interface MissingClause {
  clause_type: string
  why_important: string
  suggested_language: string
}

export interface VerificationNotes {
  factual_corrections: string[]
  cross_clause_interactions: string[]
  hallucinations_caught: string[]
  completeness_additions: string[]
  confidence_score: number
}

export interface AdvisoryReport {
  document_summary: DocumentSummary
  overall_risk_assessment: OverallRiskAssessment | null
  critical_issues: CriticalIssue[]
  positive_aspects: PositiveAspect[]
  missing_clauses: MissingClause[]
  negotiation_priority_order: string[]
  executive_summary: string
  verification_notes: VerificationNotes | null
}

export interface AgentTiming {
  agent: string
  timing_ms: number
  model_used: string
  status: 'success' | 'failed' | 'skipped'
}

export interface AnalysisResult {
  document_id: string
  clauses: Clause[]
  classifications: ClassificationResult[]
  simplifications: SimplificationResult[]
  risks: RiskResult[]
  benchmarks: BenchmarkResult[]
  advisory: AdvisoryReport | null
  agent_timings: AgentTiming[]
  total_analysis_time_ms: number
  cache_hit: boolean
}

export interface ChatResponse {
  answer: string
  source_clauses: { clause_id: number; text: string; page: number }[]
}

// ── API functions ──

export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post<UploadResponse>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function analyzeDocumentSSE(
  documentId: string,
  onEvent: (event: SSEEvent) => void,
  onComplete?: () => void,
  onError?: (error: string) => void,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/analyze/${documentId}`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Analysis failed' }))
      onError?.(err.detail || 'Analysis failed')
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      onError?.('No response stream')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        // Skip empty lines, SSE comments, event/id/retry fields
        if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) continue

        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr) continue
          try {
            const event = JSON.parse(jsonStr) as SSEEvent
            onEvent(event)
          } catch {
            // skip malformed events
          }
        }
      }
    }

    onComplete?.()
  } catch (err) {
    onError?.(err instanceof Error ? err.message : 'Stream error')
  }
}

export async function getResults(documentId: string): Promise<AnalysisResult> {
  const { data } = await api.get<AnalysisResult>(`/results/${documentId}`)
  return data
}

export async function chatWithDocument(
  documentId: string,
  message: string,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>(`/chat/${documentId}`, { message })
  return data
}

export async function downloadReport(
  documentId: string,
  exportType: string = 'negotiation_brief',
): Promise<Blob> {
  const { data } = await api.get(`/report/${documentId}`, {
    params: { export_type: exportType },
    responseType: 'blob',
  })
  return data
}

export async function compareDocuments(
  docId1: string,
  docId2: string,
): Promise<Record<string, unknown>> {
  const { data } = await api.post('/compare', {
    document_id_1: docId1,
    document_id_2: docId2,
  })
  return data
}

export async function healthCheck(): Promise<Record<string, unknown>> {
  const { data } = await api.get('/health')
  return data
}
