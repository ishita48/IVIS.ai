import { useEffect } from 'react'
import { useStore } from '../state/store'
import { submitRun, connectStream } from '../api/client'

export default function RunPanel() {
  const { code, prediction, run, sessionId, hintPending } = useStore()

  useEffect(() => connectStream(sessionId), [sessionId])

  return (
    <div className="runpanel">
      <button className="run" onClick={() => submitRun(code, prediction)}>
        Run
      </button>

      {run && (
        <div className={`result result-${run.status}`}>
          <div className="panel-title">
            {run.status === 'pass' ? 'All checks passed' : 'Disagrees with the reference'}
            <span className="ms">{run.runtime_ms}ms</span>
          </div>

          {run.failing_input && (
            <div className="failing">
              <code>{run.failing_input.repr}</code>
              {run.failing_input.shrunk && (
                <p className="shrink-note">
                  shrunk from <code>{run.failing_input.original_repr}</code> in{' '}
                  {run.failing_input.shrink_steps} steps
                </p>
              )}
              <div className="ea">
                <span>expected <b>{String(run.expected)}</b></span>
                <span>got <b>{String(run.actual)}</b></span>
              </div>
            </div>
          )}

          {run.exception && <pre className="stderr">{run.exception}</pre>}
          {hintPending && <p className="pending">Looking at where your reasoning broke…</p>}
        </div>
      )}
    </div>
  )
}
