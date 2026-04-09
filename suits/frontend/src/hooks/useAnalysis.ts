import { useState, useCallback, useRef } from 'react'
import {
  type SSEEvent,
  type AnalysisResult,
  analyzeDocumentSSE,
  getResults,
} from '@/api/client'

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

export interface AgentState {
  name: string
  status: AgentStatus
  timing_ms?: number
  model_used?: string
  data?: Record<string, unknown>
  error?: string
}

const AGENT_ORDER = ['ingestor', 'classifier', 'simplifier', 'risk_analyzer', 'benchmark', 'advisor', 'verifier']

export function useAnalysis() {
  const [agents, setAgents] = useState<Record<string, AgentState>>({})
  const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'running' | 'complete' | 'error' | 'cached'>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setAgents({})
    setPipelineStatus('idle')
    setResult(null)
    setError(null)
    abortRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const runAnalysis = useCallback(async (documentId: string) => {
    reset()
    setPipelineStatus('running')

    const controller = new AbortController()
    abortControllerRef.current = controller

    // Init agent states
    const initial: Record<string, AgentState> = {}
    for (const name of AGENT_ORDER) {
      initial[name] = { name, status: 'idle' }
    }
    setAgents(initial)

    const handleEvent = (event: SSEEvent) => {
      if (abortRef.current) return

      if (event.agent === 'pipeline') {
        if (event.status === 'complete') {
          setPipelineStatus('complete')
        } else if (event.status === 'cached') {
          setPipelineStatus('cached')
        } else if (event.status === 'error') {
          setPipelineStatus('error')
          setError(event.error || 'Pipeline failed')
        }
        return
      }

      setAgents(prev => ({
        ...prev,
        [event.agent]: {
          name: event.agent,
          status: event.status as AgentStatus,
          timing_ms: event.timing_ms,
          model_used: event.model_used,
          data: event.data,
          error: event.error,
        },
      }))
    }

    await analyzeDocumentSSE(
      documentId,
      handleEvent,
      async () => {
        // On stream complete, fetch full results
        try {
          const fullResult = await getResults(documentId)
          setResult(fullResult)
          setPipelineStatus('complete')
        } catch {
          // Results might not be ready yet if pipeline had errors
        }
      },
      (errMsg) => {
        if (controller.signal.aborted) return
        setPipelineStatus('error')
        setError(errMsg)
      },
      controller.signal,
    )
  }, [reset])

  const abort = useCallback(() => {
    abortRef.current = true
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setPipelineStatus('error')
    setError('Aborted by user')
  }, [])

  return {
    agents,
    agentOrder: AGENT_ORDER,
    pipelineStatus,
    result,
    error,
    runAnalysis,
    reset,
    abort,
  }
}
