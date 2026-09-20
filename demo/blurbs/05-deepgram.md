# 05-deepgram

ElevenLabs already hears the student, so a second transcript would be worth
nothing on its own. What Deepgram adds is the stamp: every finished sentence
carries the model call LENS had in flight at the moment the student started
saying it, taken from Deepgram's own audio clock rather than the time the
message arrived. In a live session a student said "I'm trying to add this
number and then this number." one second into a vision call, and the stored
turn names that call, its objective, and the frame it was looking at — so a
confusion can be replayed against exactly what LENS was seeing when it was
voiced.

**Lives in:** `apps/lens/lib/deepgram.ts`, `apps/lens/components/Camera/CameraView.tsx`
