import { useStore } from '../state/store'

/**
 * Think-aloud capture. Audio never leaves the browser except to Deepgram.
 * Owner: fullstack (end to end). The frontend only mounts the button.
 *
 * Alignment: every final utterance is stamped with the edit that was in flight
 * when it started, so "I thought this loop reset" can be replayed against the
 * exact keystroke that followed.
 */
let socket: WebSocket | null = null
let recorder: MediaRecorder | null = null

export async function startThinkAloud() {
  const { token } = await fetch('/v1/voice/deepgram-token').then((r) => r.json())
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

  socket = new WebSocket(`wss://api.deepgram.com/v1/listen?interim_results=true`, ['token', token])
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    const alt = msg.channel?.alternatives?.[0]
    if (!alt?.transcript) return
    useStore.getState().pushTranscript({ ts: Date.now(), text: alt.transcript, final: !!msg.is_final })
  }

  socket.onopen = () => {
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    recorder.ondataavailable = (e) => socket?.readyState === 1 && socket.send(e.data)
    recorder.start(250)
  }
}

export function stopThinkAloud() {
  recorder?.stop()
  socket?.close()
  recorder = null
  socket = null
}
