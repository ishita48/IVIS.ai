import { useStore } from '../state/store'

/**
 * The claim is grounded in the student's OWN uploaded notes, quoted verbatim.
 * If retrieval found something that contradicts the hint, we say so rather than hide it.
 */
export default function SourceCard() {
  const source = useStore((s) => s.source)
  if (!source) return null

  return (
    <div className={`source ${source.agrees_with_notes ? 'agrees' : 'conflicts'}`}>
      <div className="panel-title">
        {source.agrees_with_notes ? 'From your notes' : 'Your notes disagree'}
      </div>
      <blockquote>{source.quote}</blockquote>
      <cite>
        {source.deep_link ? <a href={source.deep_link} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
        {source.page != null && <> · p.{source.page}</>}
      </cite>
      {source.conflict_note && <p className="conflict-note">{source.conflict_note}</p>}
    </div>
  )
}
