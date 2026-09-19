export interface RunResult {
  passed: boolean;
  failingInput: string; // already shrunk to smallest by a teammate
  expected: string;
  actual: string;
  shrinkSteps: number;
}

export interface Divergence {
  step: string; // the exact line or step where reasoning broke
  probableBelief: string; // what the student likely believes, in plain words
  confidence: number; // 0-1
  rung: 1 | 2 | 3 | 4 | 5;
  hint: string;
  question?: string;
  options?: string[];
  citation?: { text: string; source: string };
  shouldRevealAnswer: false; // always false, enforced by schema
}
