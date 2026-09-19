/**
 * Voice TA. Speaks a rung out loud instead of printing it - used when the student
 * is mid-keystroke and should not have to look away from the editor.
 * Never speaks above the unlocked rung.
 */
export async function speakRung(text: string, signal?: AbortSignal) {
  const res = await fetch('/v1/voice/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) return
  const blob = await res.blob()
  const audio = new Audio(URL.createObjectURL(blob))
  await audio.play()
  return audio
}
