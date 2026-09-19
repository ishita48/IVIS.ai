# Contracts

Three shapes, frozen in hour one. Everything else can churn.

```
proof-engine ──RunResult──▶ brain ──HintResponse──▶ gateway ──▶ web
                                        ▲
                             sources ───┘ (SourceCard, optional)
```

- `run_result.schema.json` — Backend 1 → Backend 2
- `hint_response.schema.json` — Backend 2 → Fullstack → Frontend
- `source_card.schema.json` — nested inside HintResponse, or streamed late
- `events.md` — the SSE event names the frontend subscribes to

`fixtures/` holds one realistic example of each. **The frontend builds against the
fixtures from minute one** and does not wait for a live backend. `apps/web/src/api/mock.ts`
replays them on a timer.

## Changing a contract
1. Edit the schema.
2. Update the fixture in the same commit.
3. Say so in the team channel. A contract change with a stale fixture is how the demo dies.

## Validating
```bash
make contracts   # validates every fixture against its schema
```
