/**
 * Small force-directed layout for the concept map (no dependency).
 * Deterministic: seeds come from a hash of the concept id, so the same map
 * always lays out the same way, and concepts already placed keep their
 * exact position when new ones arrive.
 */

export type Pos = { x: number; y: number };
const PAD = 60;

/** The canvas grows with the map (drawn at 1:1 and scrolled, so text stays readable). */
export function mapSize(n: number) {
  const k = Math.max(1, Math.sqrt(n / 10));
  return { w: Math.round(700 * k), h: Math.round(460 * k) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const MIN_GAP = 46;
const tooClose = (ids: string[], pos: Record<string, Pos>) =>
  ids.some((a, i) => ids.slice(i + 1).some((b) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y) < MIN_GAP));

export function layoutConcepts(
  ids: string[],
  edges: { from: string; to: string }[],
  prev: Record<string, Pos>
): Record<string, Pos> {
  const pos = place(ids, edges, prev);
  // New concepts got squeezed against pinned ones: re-flow everything once.
  if (Object.keys(prev).length && tooClose(ids, pos)) return place(ids, edges, {});
  return pos;
}

function place(
  ids: string[],
  edges: { from: string; to: string }[],
  prev: Record<string, Pos>
): Record<string, Pos> {
  const { w: MAP_W, h: MAP_H } = mapSize(ids.length);
  const pos: Record<string, Pos> = {};
  const fresh = new Set<string>();
  for (const id of ids) {
    if (prev[id]) {
      pos[id] = { ...prev[id] };
      continue;
    }
    fresh.add(id);
    // New concept: start beside a neighbour that is already placed, else on a ring.
    const nb = edges
      .map((e) => (e.from === id ? e.to : e.to === id ? e.from : null))
      .find((n) => n && prev[n]);
    const a = hash(id) * Math.PI * 2;
    const r = nb ? 70 : Math.min(MAP_W, MAP_H) / 3;
    const c = nb ? prev[nb!] : { x: MAP_W / 2, y: MAP_H / 2 };
    pos[id] = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  }

  const L = 130; // ideal edge length
  const steps = 260;
  for (let step = 0; step < steps; step++) {
    const t = 1 - step / steps; // cooling
    const disp: Record<string, Pos> = Object.fromEntries(ids.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = hash(ids[i] + ids[j]) - 0.5;
          dy = 0.5 - hash(ids[j] + ids[i]);
          d = 0.5;
        }
        const f = (L * L) / d;
        disp[ids[i]].x += (dx / d) * f;
        disp[ids[i]].y += (dy / d) * f;
        disp[ids[j]].x -= (dx / d) * f;
        disp[ids[j]].y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (d * d) / L;
      disp[e.from].x -= (dx / d) * f;
      disp[e.from].y -= (dy / d) * f;
      disp[e.to].x += (dx / d) * f;
      disp[e.to].y += (dy / d) * f;
    }
    for (const id of ids) {
      // Gentle pull to the centre keeps disconnected concepts on screen.
      disp[id].x += (MAP_W / 2 - pos[id].x) * 0.6;
      disp[id].y += (MAP_H / 2 - pos[id].y) * 0.6;
      const d = Math.max(Math.hypot(disp[id].x, disp[id].y), 0.01);
      // Concepts the student has already seen do not move at all.
      if (!fresh.has(id)) continue;
      const move = Math.min(d, 30 * t + 1);
      pos[id].x = Math.min(MAP_W - PAD, Math.max(PAD, pos[id].x + (disp[id].x / d) * move));
      pos[id].y = Math.min(MAP_H - PAD, Math.max(PAD, pos[id].y + (disp[id].y / d) * move));
    }
  }
  return pos;
}
