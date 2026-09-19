import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useStore } from '../state/store'

const STARTER = `def max_subarray(nums):
    best = 0
    cur = 0
    for n in nums:
        cur = max(0, cur + n)
        best = max(best, cur)
    return best
`

export default function Editor() {
  const { code, setCode, hint, unlockedRung } = useStore()

  // Rung 1+ reveals a location. Below that we deliberately do not highlight -
  // the whole product claim is that we don't hand over the answer.
  const markedLine = unlockedRung >= 1 ? hint?.divergence.line ?? null : null

  return (
    <div className="editor" data-marked-line={markedLine ?? ''}>
      <div className="panel-title">
        solution.py
        {markedLine && <span className="marker">line {markedLine}</span>}
      </div>
      <CodeMirror
        value={code || STARTER}
        height="320px"
        extensions={[python()]}
        onChange={setCode}
      />
    </div>
  )
}
