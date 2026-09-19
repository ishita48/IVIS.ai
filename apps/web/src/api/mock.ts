import runFixture from '../../../../contracts/fixtures/run_result.example.json'
import hintFixture from '../../../../contracts/fixtures/hint_response.example.json'
import { useStore } from '../state/store'
import type { HintResponse, RunResult } from './types'

/**
 * Replays the contract fixtures on a timer so the frontend is demo-complete
 * before any backend exists. Kill VITE_USE_MOCK to go live - nothing else changes.
 */
export async function mockRun(code: string, prediction: string) {
  const run: RunResult = {
    ...(runFixture as unknown as RunResult),
    run_id: crypto.randomUUID(),
    student_code: code || (runFixture as any).student_code,
    prediction: prediction
      ? { predicted_output: prediction, matched_actual: false, matched_expected: true }
      : null,
  }

  setTimeout(() => useStore.getState().applyRunResult(run), 350)
  setTimeout(() => {
    const hint = { ...(hintFixture as unknown as HintResponse), run_id: run.run_id }
    useStore.getState().applyHint(hint)
    if (hint.source) useStore.getState().applySource(hint.source)
  }, 1400)

  return { run_id: run.run_id }
}

export function mockStream(): () => void {
  return () => {}
}
