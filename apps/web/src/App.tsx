import Editor from './components/Editor'
import RunPanel from './components/RunPanel'
import PredictBox from './components/PredictBox'
import HintLadder from './components/HintLadder'
import SourceCard from './components/SourceCard'
import TokenCounter from './components/TokenCounter'
import MistakeSidebar from './components/MistakeSidebar'
import MicButton from './components/MicButton'
import TranscriptStrip from './components/TranscriptStrip'

/**
 * Demo layout. Everything the judge sees is on one screen - no tabs, no routing.
 * Left: what the student does. Right: what LENS noticed.
 */
export default function App() {
  return (
    <div className="app">
      <header className="bar">
        <span className="logo">LENS</span>
        <TokenCounter />
        <MicButton />
      </header>

      <main className="cols">
        <section className="left">
          <Editor />
          <PredictBox />
          <RunPanel />
        </section>

        <aside className="right">
          <HintLadder />
          <SourceCard />
          <MistakeSidebar />
        </aside>
      </main>

      <TranscriptStrip />
    </div>
  )
}
