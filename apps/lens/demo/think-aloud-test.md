# Testing Think aloud

A manual script. Takes about three minutes. The thing being tested is not
transcription — it is whether each sentence gets stamped with the model call
LENS had in flight when you started saying it.

Nothing here needs a second person. Read the whole step before doing it,
because some steps are timed.

---

## Before you start

```bash
npm --prefix apps/lens run dev
```

Check the token route answers. A 403 here means the Deepgram key lost its
Member permission again and nothing below will work:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/deepgram
```

Expect `200`. If you get `404`, `/api/deepgram` fell out of the public matcher
in `middleware.ts`. If you get `502`, open the body and read the Deepgram
error.

---

## 1 — Turn it on, alone

Sign in, open http://localhost:3000/app and pick the **Camera** tab. Do **not** start a session yet.

Click **Think aloud**. It should go amber with a pulsing dot.

Say: **"Testing one two three."**

Watch for a caption over the video while you speak. That is the interim
channel — it appears and disappears as Deepgram revises its guess.

Then open the Inspector and look for:

```
think aloud → "Testing one two three."  no call in flight
```

`no call in flight` is **correct** here. Nothing was being analyzed, so there
was nothing to stamp. A null stamp is only a bug when a call really was
running.

---

## 2 — The real test: speak while it looks

This is the one that matters, and it is timed. A look takes roughly 1.5–3
seconds, so you have a narrow window.

1. Put your hands in frame holding something — a pen, a few fingers up.
2. Click **Look**.
3. **Immediately** start talking, without waiting. Say:

   > **"I'm trying to add this number and then this number."**

   Start speaking within about half a second of the click. Do not pause first.

4. Watch the Inspector.

What you want:

```
think aloud → "I'm trying to add this number and then this number."  during vision
```

The words `during vision` or `during analyze` are the whole feature. If you
see `no call in flight`, you were too slow — the look finished before you
opened your mouth. Try again and start talking earlier.

Repeat two or three times so you have a few stamped turns.

---

## 3 — With a session running

Start Session, wait for **listening**, then click Think aloud.

Order matters. If you click Think aloud at the same moment the ElevenLabs SDK
is seizing the microphone, the recorder comes up empty and Deepgram closes the
socket after about ten seconds with:

```
Think aloud is off — Deepgram closed the socket (1011: ... did not receive audio data ...)
```

That is the known race. Let the session reach **listening** first, then toggle.

Now talk to LENS normally. Ask it to look at something, and keep talking while
it looks. Those are the turns that get stamped in real use.

End Session. Think aloud should switch itself off — the mic does not outlive
the lesson.

---

## 4 — Check what was stored

```bash
cd apps/lens && cat > /tmp/vt.mjs <<'JS'
import fs from "node:fs";
import { MongoClient } from "mongodb";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const c = new MongoClient(env.MONGODB_URI);
await c.connect();
const ev = c.db("lens").collection("events");
const q = { type: "voice_turn", "payload.source": "deepgram" };
console.log("turns:", await ev.countDocuments(q));
console.log("stamped:", await ev.countDocuments({ ...q, "payload.inFlight": { $ne: null } }));
for (const d of await ev.find(q).sort({ _id: -1 }).limit(8).toArray()) {
  const f = d.payload.inFlight;
  console.log(`"${d.payload.text}" -> ${f ? `${f.kind} (+${d.payload.at - f.startedAt}ms)` : "null"}  session=${d.sessionId}`);
}
await c.close();
JS
node /tmp/vt.mjs
```

Three things to check:

- **`stamped` is greater than zero.** If every turn is null and you know you
  spoke during a look, the ledger wiring is broken.
- **The offset is small and positive.** `+176ms`, `+1042ms` — you started
  speaking that far into the call. A negative number or something over the
  call's own duration means the audio clock and the wall clock have drifted.
- **`session` is the same id across turns from one sitting.** A different id
  on every line means the turns are being scattered into throwaway sessions
  and cannot be replayed against the frames they refer to.

---

## What good looks like

```
turns: 22
stamped: 5
"I'm trying to add this number and then this number." -> vision (+1042ms)  session=6aaf8c6d…
"And add the numbers. What's the answer?"             -> vision (+1185ms)  session=6aaf8c6d…
"I'm trying to add"                                   -> analyze (+71ms)   session=6aaf8c6d…
```

Not every turn is stamped, and that is fine — you are not always talking while
it is looking. What matters is that the ones spoken during a call name that
call.
