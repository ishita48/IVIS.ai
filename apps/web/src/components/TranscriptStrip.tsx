import { useStore } from '../state/store'

/** Think-aloud, timestamped and aligned to the edit that was happening when it was said. */
export default function TranscriptStrip() {
  const transcript = useStore((s) => s.transcript)
  if (!transcript.length) return null

  return (
    <footer className="strip">
      {transcript.map((l, i) => (
        <span key={i} className={l.final ? 'line final' : 'line partial'}>
          {l.text}
        </span>
      ))}
    </footer>
  )
}
