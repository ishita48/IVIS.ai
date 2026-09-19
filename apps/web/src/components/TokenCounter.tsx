import { useStore } from '../state/store'

/**
 * The cascade's scoreboard. Most runs never wake the model; this is where a judge
 * sees that claim as a number instead of a sentence.
 */
export default function TokenCounter() {
  const { tokensSaved, tokensUsed, run } = useStore()
  const total = tokensSaved + 1
  const pct = Math.round((tokensSaved / Math.max(1, total)) * 100)

  return (
    <div className="tokens" title="Model calls skipped because the checker already knew the answer">
      <span className="tk-num">{tokensSaved}</span>
      <span className="tk-label">model calls skipped ({pct}%)</span>
      <span className="tk-used">{tokensUsed} tokens spent</span>
      {run && !run.woke_model && <span className="tk-badge">this run: no model</span>}
    </div>
  )
}
