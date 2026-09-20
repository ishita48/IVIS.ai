/**
 * Tidy left-to-right tree layout for the concept map (no dependency).
 * ─────────────────────────────────────────────────────────────────────
 * Depth sets x, leaf order sets y, a parent sits at the middle of its
 * children. Children keep the order they were added in, so a new concept
 * slots in without reshuffling the rest. Concepts with no (valid) parent
 * hang under a "Loose ideas" header — a label only, never a drawn link.
 */

export type Pos = { x: number; y: number };
export type TreeInput = { id: string; name: string; parentId?: string };
export type Placed = Pos & { w: number; h: number; depth: number };
export type TreeLayout = {
  place: Record<string, Placed>;
  /** Visible parent → child pairs (the drawn tree links). */
  links: { from: string; to: string }[];
  /** Concepts that have children, and how many descendants a collapse hides. */
  hidden: Record<string, number>;
  hasKids: Set<string>;
  looseHeader: Placed | null;
  width: number;
  height: number;
};

export const LOOSE_ID = "__loose__";
export const NODE_H = 30;
const ROW = 44;
const GAP_X = 64;
const TREE_GAP = 1.2; // rows between the main tree and the loose group

export const nodeWidth = (name: string) => Math.min(190, Math.max(64, name.length * 7 + 34));

export function layoutTree(
  nodes: TreeInput[],
  rootId: string | undefined,
  collapsed: Set<string>
): TreeLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  const loose: string[] = [];
  for (const n of nodes) {
    if (n.id === rootId) continue;
    if (n.parentId && byId.has(n.parentId) && n.parentId !== n.id) {
      kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n.id]);
    } else loose.push(n.id);
  }

  const place: Record<string, Placed> = {};
  const links: { from: string; to: string }[] = [];
  const hidden: Record<string, number> = {};
  const hasKids = new Set<string>();
  const seen = new Set<string>();
  let row = 0;

  const count = (id: string): number =>
    (kids.get(id) ?? []).reduce((s, c) => s + 1 + count(c), 0);

  // Returns the y of `id`; assigns rows to leaves as it goes.
  const walk = (id: string, depth: number): number => {
    seen.add(id);
    const list = (kids.get(id) ?? []).filter((c) => !seen.has(c));
    const name = byId.get(id)?.name ?? id;
    if (list.length) hasKids.add(id);
    let y: number;
    if (!list.length || collapsed.has(id)) {
      if (list.length) hidden[id] = count(id);
      y = row++ * ROW;
    } else {
      const ys = list.map((c) => {
        const cy = walk(c, depth + 1);
        links.push({ from: id, to: c });
        return cy;
      });
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    place[id] = { x: 0, y, w: nodeWidth(name), h: NODE_H, depth };
    return y;
  };

  if (rootId && byId.has(rootId)) walk(rootId, 0);

  let looseHeader: Placed | null = null;
  if (loose.length) {
    if (row > 0) row += TREE_GAP;
    const headerRow = row++;
    looseHeader = { x: 0, y: headerRow * ROW, w: nodeWidth("Loose ideas"), h: NODE_H, depth: 0 };
    for (const id of loose) if (!seen.has(id)) walk(id, 1);
  }

  // x from the widest node at each depth.
  const widest: number[] = [];
  for (const p of Object.values(place)) widest[p.depth] = Math.max(widest[p.depth] ?? 0, p.w);
  if (looseHeader) widest[0] = Math.max(widest[0] ?? 0, looseHeader.w);
  const xs: number[] = [];
  let x = 0;
  widest.forEach((w, d) => {
    xs[d] = x;
    x += (w ?? 0) + GAP_X;
  });
  for (const p of Object.values(place)) p.x = xs[p.depth] ?? 0;
  if (looseHeader) looseHeader.x = 0;

  const all = [...Object.values(place), ...(looseHeader ? [looseHeader] : [])];
  return {
    place,
    links,
    hidden,
    hasKids,
    looseHeader,
    width: Math.max(0, ...all.map((p) => p.x + p.w)),
    height: Math.max(0, ...all.map((p) => p.y + p.h)),
  };
}
