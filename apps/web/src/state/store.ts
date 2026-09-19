import { create } from 'zustand'
import type { RunResult, HintResponse, SourceCard, TranscriptLine } from '../api/types'

type State = {
  sessionId: string
  problemId: string
  code: string
  prediction: string
  run: RunResult | null
  hint: HintResponse | null
  source: SourceCard | null
  unlockedRung: number
  hintPending: boolean
  transcript: TranscriptLine[]
  tokensSaved: number
  tokensUsed: number

  setCode: (c: string) => void
  setPrediction: (p: string) => void
  applyRunResult: (r: RunResult) => void
  applyHint: (h: HintResponse) => void
  applySource: (s: SourceCard) => void
  unlockNext: () => void
  pushTranscript: (l: TranscriptLine) => void
}

export const useStore = create<State>((set, get) => ({
  sessionId: crypto.randomUUID(),
  problemId: 'max-subarray',
  code: '',
  prediction: '',
  run: null,
  hint: null,
  source: null,
  unlockedRung: 0,
  hintPending: false,
  transcript: [],
  tokensSaved: 0,
  tokensUsed: 0,

  setCode: (code) => set({ code }),
  setPrediction: (prediction) => set({ prediction }),

  // A new run wipes the previous hint. Stale hints pointing at edited lines are the
  // single worst bug class in this UI - do not soften this.
  applyRunResult: (run) =>
    set({ run, hint: null, source: null, unlockedRung: 0, hintPending: run.status !== 'pass', tokensSaved: run.tokens_saved }),

  applyHint: (hint) =>
    set({ hint, hintPending: false, unlockedRung: hint.rung, tokensUsed: get().tokensUsed + (hint.tokens?.completion ?? 0) }),

  applySource: (source) => set({ source }),

  // The student asks for more. Rungs are climbed one at a time, never skipped.
  unlockNext: () => set({ unlockedRung: Math.min(4, get().unlockedRung + 1) }),

  pushTranscript: (l) => set({ transcript: [...get().transcript, l].slice(-50) }),
}))
