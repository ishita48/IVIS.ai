// Mirrors /contracts/*.schema.json. Regenerate with `make types`; hand-edits get overwritten.
export type RunStatus = 'pass' | 'fail' | 'error' | 'timeout'

export interface HistoryEntry {
  ts: string
  run_status: RunStatus
  edit_summary?: string
  diff?: string
  failing_input_repr?: string | null
  hint_rung_shown?: number | null
}

export interface RunResult {
  run_id: string
  session_id: string
  problem_id: string
  status: RunStatus
  student_code: string
  reference_id?: string
  failing_input?: {
    args?: unknown[]
    repr?: string
    shrunk?: boolean
    shrink_steps?: number
    original_repr?: string
  } | null
  expected?: unknown
  actual?: unknown
  stdout?: string
  stderr?: string
  exception?: string | null
  runtime_ms?: number
  history: HistoryEntry[]
  prediction?: { predicted_output: string; matched_actual: boolean; matched_expected: boolean } | null
  woke_model: boolean
  tokens_saved: number
}

export type Reveals = 'nothing' | 'location' | 'cause' | 'strategy' | 'fix'

export interface Rung { rung: number; text: string | null; reveals: Reveals }

export interface SourceCard {
  doc_id: string
  title: string
  page?: number | null
  quote: string
  char_span?: [number, number] | null
  score?: number
  agrees_with_notes: boolean
  conflict_note?: string | null
  deep_link?: string | null
}

export interface HintResponse {
  run_id: string
  session_id: string
  divergence: {
    line?: number | null
    span?: [number, number] | null
    claim: string
    student_belief: string
    actual_behavior: string
  }
  rung: number
  ladder: Rung[]
  hint: { rung: number; text: string; reveals: Reveals }
  source?: SourceCard | null
  mistake?: { tag: string; first_seen?: string | null; recurrence: number; prior_run_ids: string[] }
  tokens?: { prompt: number; completion: number; model: string; local: boolean; latency_ms: number }
}

export interface TranscriptLine { ts: number; text: string; final: boolean; aligned_edit_id?: string }
