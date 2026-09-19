import { useStore } from '../state/store'

/** Backed by mistake embeddings in Elastic - the same error across problems, over time. */
export default function MistakeSidebar() {
  const mistake = useStore((s) => s.hint?.mistake)
  if (!mistake) return null

  return (
    <div className="mistakes">
      <div className="panel-title">You have made this mistake before</div>
      <div className="tag">{mistake.tag}</div>
      <p className="recurrence">
        {mistake.recurrence}× this session
        {mistake.first_seen && <> · first seen {new Date(mistake.first_seen).toLocaleTimeString()}</>}
      </p>
      <ul className="priors">
        {mistake.prior_run_ids.map((id) => (
          <li key={id}><button className="linkish">replay {id.slice(-4)}</button></li>
        ))}
      </ul>
    </div>
  )
}
