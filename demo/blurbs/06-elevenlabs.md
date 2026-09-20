# 06-elevenlabs

Students can talk through a task with a voice tutor that can ask to inspect their
workspace, compare it with a reference frame, and adjust the teaching pace.
ElevenLabs runs the browser conversation over WebRTC with a WebSocket fallback,
while the app records a transcript and handles the tutor's tool calls. A server
route supplies conversation credentials without exposing the ElevenLabs API key
to the browser.

**Lives in:** `apps/lens/hooks/useAgent.ts`, `apps/lens/app/api/elevenlabs/signed-url/route.ts`
