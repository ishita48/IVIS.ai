import { useStore } from '../state/store'

/**
 * Predict-then-run. The student commits to an output before seeing one.
 * The gap between prediction and reality is the teachable moment - and the
 * cheapest signal the brain gets about what they believe.
 */
export default function PredictBox() {
  const { prediction, setPrediction, run } = useStore()
  const p = run?.prediction

  return (
    <div className="predict">
      <label className="panel-title" htmlFor="predict-input">
        Before you run - what does this return on the failing case?
      </label>
      <input
        id="predict-input"
        value={prediction}
        placeholder="your answer"
        onChange={(e) => setPrediction(e.target.value)}
      />

      {p && (
        <div className={`gap ${p.matched_actual ? 'gap-closed' : 'gap-open'}`}>
          <div><span className="k">you said</span><span className="v">{p.predicted_output}</span></div>
          <div><span className="k">it returned</span><span className="v">{String(run?.actual)}</span></div>
          <div><span className="k">correct is</span><span className="v">{String(run?.expected)}</span></div>
          {!p.matched_actual && (
            <p className="gap-note">
              You predicted the right answer but wrote code that does something else.
              That gap is the bug - not the algorithm.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
