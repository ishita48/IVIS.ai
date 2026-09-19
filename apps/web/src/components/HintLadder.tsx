import { useStore } from '../state/store'
import { unlockRung } from '../api/client'

const LABELS = ['Nudge', 'Where', 'Why', 'How', 'Fix']

/**
 * Five rungs, generated in one model call, revealed one at a time.
 * Locked rungs ship to the client redacted (text: null) so "view source" is not a cheat code.
 */
export default function HintLadder() {
  const { hint, unlockedRung, run } = useStore()
  if (!hint) return <div className="ladder empty">Run your code to see where it diverges.</div>

  return (
    <div className="ladder">
      <div className="panel-title">Where your reasoning broke</div>

      <p className="claim">{hint.divergence.claim}</p>
      <div className="belief">
        <div><span className="k">you assumed</span> {hint.divergence.student_belief}</div>
        <div><span className="k">what happens</span> {hint.divergence.actual_behavior}</div>
      </div>

      <ol className="rungs">
        {hint.ladder.map((r) => {
          const open = r.rung <= unlockedRung
          return (
            <li key={r.rung} className={open ? 'rung open' : 'rung locked'}>
              <span className="rung-label">{LABELS[r.rung]}</span>
              {open ? <span className="rung-text">{r.text}</span> : <span className="rung-text muted">locked</span>}
            </li>
          )
        })}
      </ol>

      {unlockedRung < 4 && (
        <button className="more" onClick={() => run && unlockRung(run.run_id, unlockedRung + 1)}>
          Still stuck - next rung
        </button>
      )}
    </div>
  )
}
