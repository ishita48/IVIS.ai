"use client";

/**
 * ConceptMap — the Reasoning tab.
 * ─────────────────────────────────────────────────────────────────────
 * A tree of the concepts from the student's conversation, for reviewing
 * later: one root, more specific concepts below it, thin dashed cross-links
 * between branches. Every node and link is backed by evidence the server
 * already verified (see lib/conceptmap.ts); this file only draws.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus, X } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";
import type { ConceptEdge, ConceptNode, ConceptStatus, Evidence } from "@/lib/lens/contracts";
import { layoutTree, type Placed } from "./conceptLayout";

const STATUS_FILL: Record<ConceptStatus, string> = {
  mentioned: "#94a3b8",
  shaky: "#f59e0b",
  solid: "#10b981",
};
const STATUS_LABEL: Record<ConceptStatus, string> = {
  mentioned: "Mentioned",
  shaky: "Shaky",
  solid: "Solid",
};

type Selection =
  | { kind: "node"; id: string }
  | { kind: "cross"; id: string }
  | { kind: "parent"; id: string } // the link from this node up to its parent
  | null;
type View = { x: number; y: number; k: number };

const MIN_K = 0.2;
const MAX_K = 2.5;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ConceptMapView() {
  const map = useLens((s) => s.conceptMap);
  const sessionId = useLens((s) => s.sessionId);
  const updating = useLens((s) => s.updatingMap);
  const note = useLens((s) => s.mapNote);
  const updateMap = useLens((s) => s.updateMapNow);
  const refresh = useLens((s) => s.refreshConceptMap);
  const [selected, setSelected] = useState<Selection>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });

  const boxRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const fittedFor = useRef<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh, sessionId]);

  // A different session is a different tree.
  useEffect(() => {
    setSelected(null);
    setCollapsed(new Set());
  }, [sessionId]);

  const nodes = useMemo(() => map?.nodes ?? [], [map]);
  const crossLinks = useMemo(() => map?.edges ?? [], [map]);
  const layout = useMemo(() => layoutTree(nodes, map?.rootId, collapsed), [nodes, map?.rootId, collapsed]);
  const fresh = useMemo(() => new Set(map?.lastAdded.nodes ?? []), [map]);
  const shaky = nodes.filter((n) => n.status === "shaky");
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const node = selected?.kind === "node" ? byId.get(selected.id) : undefined;
  const cross = selected?.kind === "cross" ? crossLinks.find((e) => e.id === selected.id) : undefined;
  const parentOf = selected?.kind === "parent" ? byId.get(selected.id) : undefined;

  // ── Pan / zoom ──────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box || !layout.width) return;
    const { width: cw, height: ch } = box.getBoundingClientRect();
    const pad = 56;
    const k = Math.min(Math.max((cw - pad * 2) / layout.width, MIN_K), Math.max((ch - pad * 2) / layout.height, MIN_K), 1.2);
    setView({ k, x: (cw - layout.width * k) / 2, y: (ch - layout.height * k) / 2 });
  }, [layout.width, layout.height]);

  // Fit once when a session's tree first appears; later updates keep your view.
  useEffect(() => {
    if (!nodes.length || fittedFor.current === sessionId) return;
    fittedFor.current = sessionId;
    requestAnimationFrame(fit);
  }, [nodes.length, sessionId, fit]);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const v = viewRef.current;
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
    setView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // zoom the map, never scroll the page
      const r = box.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomAt, nodes.length]);

  // Pointer capture starts only once the pointer really drags; capturing on
  // press would redirect the click away from the node that was pressed.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    const r = boxRef.current!.getBoundingClientRect();
    if (pointers.current.size === 2) {
      // Pinch: scale about the midpoint of the two fingers.
      const [pa, pb] = [...pointers.current.values()];
      const other = pa.x === prev.x && pa.y === prev.y ? pb : pa;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
      const after = Math.hypot(cur.x - other.x, cur.y - other.y) || 1;
      zoomAt((cur.x + other.x) / 2 - r.left, (cur.y + other.y) / 2 - r.top, after / before);
      moved.current = true;
    } else {
      if (!moved.current) {
        const s = start.current;
        if (!s || Math.hypot(cur.x - s.x, cur.y - s.y) < 4) return;
        moved.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    pointers.current.set(e.pointerId, cur);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  /** Clicks count only if the pointer didn't drag the map. */
  const click = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!moved.current) fn();
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cx = (p: Placed, side: "l" | "r") => (side === "r" ? p.x + p.w : p.x);
  const cy = (p: Placed) => p.y + p.h / 2;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-3xl border border-ink-800/15 bg-white/40 backdrop-blur">
      {nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-ink-500">
          Talk to LENS and your map will build here.
        </div>
      ) : (
        <div
          ref={boxRef}
          className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            if (!moved.current) setSelected(null);
          }}
        >
          <svg className="h-full w-full" role="img" aria-label="Concept tree">
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* tree links */}
              {layout.links.map((l) => {
                const a = layout.place[l.from];
                const b = layout.place[l.to];
                if (!a || !b) return null;
                const x1 = cx(a, "r");
                const x2 = cx(b, "l");
                const m = (x1 + x2) / 2;
                const sel = selected?.kind === "parent" && selected.id === l.to;
                const isNew = fresh.has(l.to);
                const d = `M${x1},${cy(a)} C${m},${cy(a)} ${m},${cy(b)} ${x2},${cy(b)}`;
                return (
                  <g key={`${l.from}>${l.to}`} onClick={click(() => setSelected({ kind: "parent", id: l.to }))} className="cursor-pointer">
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <path
                      d={d}
                      fill="none"
                      stroke={sel ? "currentColor" : "#94a3b8"}
                      strokeWidth={sel || isNew ? 2.5 : 1.5}
                    />
                  </g>
                );
              })}

              {/* cross-links: thin and dashed */}
              {crossLinks.map((e) => {
                const a = layout.place[e.from];
                const b = layout.place[e.to];
                if (!a || !b) return null; // an endpoint is inside a collapsed branch
                const forward = b.x > a.x;
                const same = b.x === a.x;
                const x1 = same ? cx(a, "r") : forward ? cx(a, "r") : cx(a, "l");
                const x2 = same ? cx(b, "r") : forward ? cx(b, "l") : cx(b, "r");
                const bulge = same ? 60 : (x2 - x1) / 2;
                const c1 = x1 + bulge;
                const c2 = same ? x2 + 60 : x2 - bulge;
                const d = `M${x1},${cy(a)} C${c1},${cy(a)} ${c2},${cy(b)} ${x2},${cy(b)}`;
                const sel = selected?.kind === "cross" && selected.id === e.id;
                const mx = (x1 + x2) / 2 + (same ? 45 : 0);
                const my = (cy(a) + cy(b)) / 2;
                const w = e.label.length * 5.6 + 10;
                return (
                  <g key={e.id} onClick={click(() => setSelected({ kind: "cross", id: e.id }))} className="cursor-pointer">
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <path
                      d={d}
                      fill="none"
                      stroke={sel ? "currentColor" : "#94a3b8"}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                    <rect x={mx - w / 2} y={my - 8} width={w} height={16} rx={8} fill="rgba(255,255,255,0.85)" />
                    <text x={mx} y={my + 4} textAnchor="middle" className="fill-ink-500 text-[10px]">
                      {e.label}
                    </text>
                  </g>
                );
              })}

              {/* loose ideas header: a label, never a link */}
              {layout.looseHeader && (
                <g transform={`translate(${layout.looseHeader.x},${layout.looseHeader.y})`}>
                  <text y={20} className="fill-ink-500 text-[11px] font-semibold uppercase tracking-wider">
                    Loose ideas
                  </text>
                </g>
              )}

              {/* nodes */}
              {nodes.map((n) => {
                const p = layout.place[n.id];
                if (!p) return null;
                const isSel = selected?.kind === "node" && selected.id === n.id;
                const isRoot = n.id === map?.rootId;
                const fill = STATUS_FILL[n.status];
                const kids = layout.hasKids.has(n.id);
                const isCollapsed = collapsed.has(n.id);
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                    <g onClick={click(() => setSelected({ kind: "node", id: n.id }))} className="cursor-pointer">
                      {fresh.has(n.id) && (
                        <rect x={-5} y={-5} width={p.w + 10} height={p.h + 10} rx={(p.h + 10) / 2} fill="none" stroke={fill} strokeWidth={2} className="animate-pulse" opacity={0.7} />
                      )}
                      <rect
                        width={p.w}
                        height={p.h}
                        rx={p.h / 2}
                        fill={fill}
                        fillOpacity={isRoot ? 0.35 : 0.18}
                        stroke={isSel ? "currentColor" : fill}
                        strokeWidth={isSel ? 2.5 : isRoot ? 2 : 1.25}
                      />
                      <text x={p.w / 2} y={p.h / 2 + 4} textAnchor="middle" className={cn("fill-ink-200 text-[12px]", isRoot ? "font-semibold" : "font-medium")}>
                        {short(n.name, 24)}
                      </text>
                    </g>
                    {kids && (
                      <g
                        transform={`translate(${p.w + 2},${p.h / 2})`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={click(() => toggle(n.id))}
                        className="cursor-pointer"
                        role="button"
                        aria-label={isCollapsed ? `Expand ${n.name}` : `Collapse ${n.name}`}
                      >
                        <circle r={8} fill="white" stroke="#94a3b8" />
                        <path d={isCollapsed ? "M-3.5 0 H3.5 M0 -3.5 V3.5" : "M-3.5 0 H3.5"} stroke="#64748b" strokeWidth={1.5} />
                        {isCollapsed && layout.hidden[n.id] > 0 && (
                          <text x={13} y={4} className="fill-ink-500 text-[10px]">
                            {layout.hidden[n.id]}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      {/* toolbar */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => updateMap()}
          disabled={updating || !sessionId}
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 text-[12px] font-semibold text-ink-950 shadow transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
        >
          {updating && <Loader2 className="size-3.5 animate-spin" />}
          {updating ? "Updating..." : "Update map"}
        </button>
        {nodes.length > 0 && (
          <div className="pointer-events-auto flex items-center rounded-full glass-chip">
            <button onClick={fit} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-ink-300 hover:text-ink-100">
              <Maximize2 className="size-3.5" /> Fit to screen
            </button>
            <button
              aria-label="Zoom out"
              onClick={() => {
                const r = boxRef.current?.getBoundingClientRect();
                if (r) zoomAt(r.width / 2, r.height / 2, 0.8);
              }}
              className="px-2 py-1.5 text-ink-400 hover:text-ink-100"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => {
                const r = boxRef.current?.getBoundingClientRect();
                if (r) zoomAt(r.width / 2, r.height / 2, 1.25);
              }}
              className="px-2 py-1.5 text-ink-400 hover:text-ink-100"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
        {note && (
          <span className={cn("pointer-events-auto rounded-full bg-white/80 px-2.5 py-1 text-[12px]", note.kind === "error" ? "text-rose-600" : "text-ink-500")}>
            {note.text}
          </span>
        )}
      </div>

      {/* legend + to revise */}
      {nodes.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[60%] flex-col items-start gap-2">
          {shaky.length > 0 && (
            <div className="pointer-events-auto max-h-32 overflow-y-auto rounded-2xl border border-ink-800/15 bg-white/80 p-3 shadow backdrop-blur scrollbar-slim">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">To revise</div>
              <ul className="flex flex-wrap gap-1.5">
                {shaky.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => setSelected({ kind: "node", id: n.id })}
                      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[12px] text-ink-200 transition hover:bg-amber-500/20"
                    >
                      {n.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-full bg-white/70 px-3 py-1 text-[11px] text-ink-500">
            {(Object.keys(STATUS_FILL) as ConceptStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: STATUS_FILL[s] }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#94a3b8" strokeDasharray="3 3" /></svg>
              cross-link
            </span>
          </div>
        </div>
      )}

      {/* drawer: overlays the map, never shrinks it */}
      {(node || cross || parentOf) && (
        <aside className="absolute bottom-3 right-3 top-3 z-10 w-[340px] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl border border-ink-800/15 bg-white/90 p-4 shadow-xl backdrop-blur scrollbar-slim">
          {node && <NodePanel key={node.id} node={node} parent={node.parentId ? byId.get(node.parentId) : undefined} isRoot={node.id === map?.rootId} onClose={() => setSelected(null)} />}
          {cross && <CrossPanel edge={cross} onClose={() => setSelected(null)} />}
          {parentOf && <ParentPanel node={parentOf} parent={parentOf.parentId ? byId.get(parentOf.parentId) : undefined} onClose={() => setSelected(null)} />}
        </aside>
      )}
    </div>
  );
}

function Panel({ title, sub, onClose, children }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-ink-100">{title}</div>
          {sub}
        </div>
        <button onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-200">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label}</div>
      {children}
    </div>
  );
}

function Quotes({ items }: { items: Evidence[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="text-[12px]">
          {e.kind === "note" && <div className="font-medium text-ink-300">{e.title}</div>}
          <blockquote className="border-l-2 border-signal/40 pl-2 text-ink-500">“{e.quote}”</blockquote>
        </li>
      ))}
    </ul>
  );
}

function Evidences({ evidence }: { evidence: Evidence[] }) {
  // The same words said in two turns read as one quote.
  const said = evidence.filter((e, i) => e.kind === "student" && evidence.findIndex((x) => x.kind === "student" && x.quote === e.quote) === i);
  const notes = evidence.filter((e) => e.kind === "note");
  return (
    <>
      {said.length > 0 && <Section label="What you said"><Quotes items={said} /></Section>}
      {notes.length > 0 && <Section label="What your notes say"><Quotes items={notes} /></Section>}
    </>
  );
}

function NodePanel({ node, parent, isRoot, onClose }: { node: ConceptNode; parent?: ConceptNode; isRoot: boolean; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <Panel
      title={node.name}
      onClose={onClose}
      sub={
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: STATUS_FILL[node.status] }} />
            {STATUS_LABEL[node.status]}
          </span>
          {isRoot && <span>· main subject</span>}
          {parent && node.parentRelation && <span>· {node.parentRelation} {parent.name}</span>}
        </span>
      }
    >
      <Evidences evidence={node.evidence} />
      {node.reviewQuestion && (
        <Section label="Review question">
          <p className="rounded-xl bg-signal/5 px-3 py-2 text-[13px] text-ink-200">{node.reviewQuestion}</p>
          {node.answer ? (
            shown ? (
              <div className="mt-2 rounded-xl border border-signal/30 bg-signal/5 px-3 py-2">
                <p className="text-[13px] text-ink-200">{node.answer.text}</p>
                <blockquote className="mt-1.5 border-l-2 border-signal/40 pl-2 text-[12px] text-ink-500">“{node.answer.quote}”</blockquote>
                <div className="mt-1 text-[11px] font-medium text-ink-400">{node.answer.title}</div>
              </div>
            ) : (
              <button
                onClick={() => setShown(true)}
                className="mt-2 rounded-full glass-chip px-3 py-1 text-[12px] text-ink-300 transition hover:text-ink-100"
              >
                Show answer
              </button>
            )
          ) : (
            <p className="mt-2 text-[12px] italic text-ink-500">Your notes don&apos;t answer this</p>
          )}
        </Section>
      )}
    </Panel>
  );
}

function ParentPanel({ node, parent, onClose }: { node: ConceptNode; parent?: ConceptNode; onClose: () => void }) {
  return (
    <Panel title={`${node.name} — ${node.parentRelation ?? "part of"} → ${parent?.name ?? node.parentId}`} onClose={onClose}>
      <Evidences evidence={node.parentEvidence ?? []} />
    </Panel>
  );
}

function CrossPanel({ edge, onClose }: { edge: ConceptEdge; onClose: () => void }) {
  return (
    <Panel title={`${edge.from} — ${edge.label} → ${edge.to}`} onClose={onClose}>
      <Evidences evidence={edge.evidence} />
    </Panel>
  );
}
