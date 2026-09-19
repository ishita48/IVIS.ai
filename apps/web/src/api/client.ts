import type { RunResult } from './types'
import { mockStream, mockRun } from './mock'
import { useStore } from '../state/store'

const BASE = import.meta.env.VITE_API_BASE ?? ''
const MOCK = import.meta.env.VITE_USE_MOCK === '1'

/** Submit a run. Returns immediately; the result arrives on the stream. */
export async function submitRun(code: string, prediction: string): Promise<{ run_id: string }> {
  if (MOCK) return mockRun(code, prediction)
  const s = useStore.getState()
  const res = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: s.sessionId, problem_id: s.problemId, code, prediction }),
  })
  if (!res.ok) throw new Error(`run failed: ${res.status}`)
  return res.json()
}

/** Ask for the next rung. Cheap - the ladder was generated in one call already. */
export async function unlockRung(runId: string, rung: number) {
  useStore.getState().unlockNext()
  if (MOCK) return
  await fetch(`${BASE}/v1/hints/${runId}/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rung }),
  })
}

/** One SSE stream per session. See contracts/events.md. */
export function connectStream(sessionId: string): () => void {
  if (MOCK) return mockStream()

  const es = new EventSource(`${BASE}/v1/sessions/${sessionId}/stream`)
  const s = () => useStore.getState()

  es.addEventListener('run.result', (e) => s().applyRunResult(JSON.parse((e as MessageEvent).data) as RunResult))
  es.addEventListener('hint.ready', (e) => s().applyHint(JSON.parse((e as MessageEvent).data)))
  es.addEventListener('source.ready', (e) => s().applySource(JSON.parse((e as MessageEvent).data)))
  es.addEventListener('hint.pending', () => useStore.setState({ hintPending: true }))
  es.addEventListener('tokens.tick', (e) => {
    const d = JSON.parse((e as MessageEvent).data)
    useStore.setState({ tokensSaved: d.saved, tokensUsed: d.used_total })
  })
  es.onerror = () => console.warn('[stream] dropped; EventSource will retry')

  return () => es.close()
}
