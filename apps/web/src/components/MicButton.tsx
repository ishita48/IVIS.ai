import { useState } from 'react'
import { startThinkAloud, stopThinkAloud } from '../voice/deepgram'

/** Frontend owns the button and the strip. The fullstack owner owns everything behind them. */
export default function MicButton() {
  const [on, setOn] = useState(false)

  async function toggle() {
    if (on) { stopThinkAloud(); setOn(false) }
    else { await startThinkAloud(); setOn(true) }
  }

  return (
    <button className={`mic ${on ? 'mic-on' : ''}`} onClick={toggle} aria-pressed={on}>
      {on ? 'Listening…' : 'Think aloud'}
    </button>
  )
}
