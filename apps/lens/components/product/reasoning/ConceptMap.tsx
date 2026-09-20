"use client";

/**
 * ConceptMap — the Reasoning tab.
 * ─────────────────────────────────────────────────────────────────────
 * A map of the concepts that came up in the student's conversation with
 * LENS, for reviewing later. Every circle and line is backed by evidence
 * the server already verified (see lib/conceptmap.ts); this file only draws.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";
import type { ConceptEdge, ConceptNode, ConceptStatus, Evidence } from "@/lib/lens/contracts";
import { layoutConcepts, mapSize, type Pos } from "./conceptLayout";

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
const R = 20;

type Selection = { kind: "node" | "edge"; id: string } | null;

export function ConceptMapView() {
  const map = useLens((s) => s.conceptMap);
  const sessionId = useLens((s) => s.sessionId);
  const updating = useLens((s) => s.updatingMap);
  const note = useLens((s) => s.mapNote);
  const updateMap = useLens((s) => s.updateMapNow);
  const refresh = useLens((s) => s.refreshConceptMap);
  const [selected, setSelected] = useState<Selection>(null);
  const placed = useRef<Record<string, Pos>>({});

  useEffect(() => {
    void refresh();
  }, [refresh, sessionId]);

  const nodes = map?.nodes ?? [];
  const edges = map?.edges ?? [];
  const signature = `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => e.id).join(",")}`;

  const positions = useMemo(() => {
    const next = layoutConcepts(nodes.map((n) => n.id), edges, placed.current);
    placed.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const { w: MAP_W, h: MAP_H } = mapSize(nodes.length);
  const fresh = new Set([...(map?.lastAdded.nodes ?? []), ...(map?.lastAdded.edges ?? [])]);
  const shaky = nodes.filter((n) => n.status === "shaky");
  const node = selected?.kind === "node" ? nodes.find((n) => n.id === selected.id) : undefined;
  const edge = selected?.kind === "edge" ? edges.find((e) => e.id === selected.id) : undefined;

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden p-3">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto scrollbar-slim">
        <div className="mb-2 flex shrink-0 items-center justify-end gap-3">
          {note && (
            <span className={cn("text-[12px]", note.kind === "error" ? "text-rose-600" : "text-ink-500")}>
              {note.text}
            </span>
          )}
          <button
            onClick={() => updateMap()}
            disabled={updating || !sessionId}
            className="flex items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
          >
            {updating && <Loader2 className="size-3.5 animate-spin" />}
            {updating ? "Updating..." : "Update map"}
          </button>
        </div>

        {nodes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[13px] text-ink-500">
            Talk to LENS and your map will build here.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-ink-800/15 bg-white/40 p-2 backdrop-blur">
              <div className="overflow-auto scrollbar-slim">
              <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="mx-auto max-w-none" role="img" aria-label="Concept map">
                <defs>
                  <marker id="cm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8" />
                  </marker>
                </defs>

                {edges.map((e) => (
                  <EdgeLine
                    key={e.id}
                    edge={e}
                    a={positions[e.from]}
                    b={positions[e.to]}
                    isNew={fresh.has(e.id)}
                    selected={selected?.kind === "edge" && selected.id === e.id}
                    onSelect={() => setSelected({ kind: "edge", id: e.id })}
                  />
                ))}

                {nodes.map((n) => {
                  const p = positions[n.id];
                  if (!p) return null;
                  const isSel = selected?.kind === "node" && selected.id === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      onClick={() => setSelected({ kind: "node", id: n.id })}
                      className="cursor-pointer"
                    >
                      {fresh.has(n.id) && (
                        <circle r={R + 8} fill="none" stroke={STATUS_FILL[n.status]} strokeWidth={2} className="animate-pulse" opacity={0.6} />
                      )}
                      <circle r={R} fill={STATUS_FILL[n.status]} fillOpacity={0.85} stroke={isSel ? "currentColor" : "white"} strokeWidth={isSel ? 3 : 2} />
                      <text y={R + 16} textAnchor="middle" className="fill-ink-200 text-[13px] font-medium">
                        {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
              </div>
              <div className="flex items-center gap-4 px-2 pb-1 text-[11px] text-ink-500">
                {(Object.keys(STATUS_FILL) as ConceptStatus[]).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ background: STATUS_FILL[s] }} />
                    {STATUS_LABEL[s]}
                  </span>
                ))}
              </div>
            </div>

            {shaky.length > 0 && (
              <div className="mt-3 rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">To revise</div>
                <ul className="flex flex-wrap gap-2">
                  {shaky.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => setSelected({ kind: "node", id: n.id })}
                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[12px] text-ink-200 transition hover:bg-amber-500/20"
                      >
                        {n.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="w-[300px] shrink-0 overflow-y-auto scrollbar-slim">
        {node && <NodePanel node={node} onClose={() => setSelected(null)} />}
        {edge && <EdgePanel edge={edge} onClose={() => setSelected(null)} />}
        {!node && !edge && nodes.length > 0 && (
          <p className="text-[12px] text-ink-500">Click a concept or a line to see where it came from.</p>
        )}
      </aside>
    </div>
  );
}

function EdgeLine({
  edge, a, b, isNew, selected, onSelect,
}: {
  edge: ConceptEdge; a?: Pos; b?: Pos; isNew: boolean; selected: boolean; onSelect: () => void;
}) {
  if (!a || !b) return null;
  const d = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  // Stop at the circle edges so the arrow head is visible.
  const x1 = a.x + ux * R;
  const y1 = a.y + uy * R;
  const x2 = b.x - ux * (R + 3);
  const y2 = b.y - uy * (R + 3);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const w = edge.label.length * 6.2 + 12;
  return (
    <g onClick={onSelect} className="cursor-pointer">
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={selected ? "currentColor" : "#94a3b8"}
        strokeWidth={isNew ? 2.5 : 1.5}
        className={isNew ? "animate-pulse" : undefined}
        markerEnd={edge.label === "different from" ? undefined : "url(#cm-arrow)"}
      />
      <rect x={mx - w / 2} y={my - 9} width={w} height={18} rx={9} fill="rgba(148,163,184,0.18)" />
      <text x={mx} y={my + 4} textAnchor="middle" className="fill-ink-500 text-[11px]">{edge.label}</text>
    </g>
  );
}

function Panel({ title, sub, onClose, children }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur">
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

function NodePanel({ node, onClose }: { node: ConceptNode; onClose: () => void }) {
  return (
    <Panel
      title={node.name}
      onClose={onClose}
      sub={
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-500">
          <span className="size-2 rounded-full" style={{ background: STATUS_FILL[node.status] }} />
          {STATUS_LABEL[node.status]}
        </span>
      }
    >
      <Evidences evidence={node.evidence} />
      {node.reviewQuestion && (
        <Section label="Review question">
          <p className="rounded-xl bg-signal/5 px-3 py-2 text-[13px] text-ink-200">{node.reviewQuestion}</p>
        </Section>
      )}
    </Panel>
  );
}

function EdgePanel({ edge, onClose }: { edge: ConceptEdge; onClose: () => void }) {
  return (
    <Panel title={`${edge.from} — ${edge.label} → ${edge.to}`} onClose={onClose}>
      <Evidences evidence={edge.evidence} />
    </Panel>
  );
}
