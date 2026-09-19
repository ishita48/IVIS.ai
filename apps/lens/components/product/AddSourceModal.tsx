"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Youtube, Link2, FileText, Loader2, Cloud, RefreshCw, Check } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

type Tab = "upload" | "dropbox" | "youtube" | "url";

type DbxFile = { id: string; name: string; path: string; size: number; kind: string; status: "new" | "added" | "changed" };

function prettySize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AddSourceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [ytUrl, setYtUrl] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { uploadFile, addYouTube, addUrl, sessionId, _loadSessionData, pushToast } = useLens();

  // ── Dropbox tab: browse the connected folder and pick what to add ──
  const [dbx, setDbx] = useState<{ loading: boolean; files: DbxFile[]; folder: string; error?: string; notConnected?: boolean }>({
    loading: false,
    files: [],
    folder: "/notes",
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadDropbox = useCallback(async () => {
    setDbx((d) => ({ ...d, loading: true, error: undefined, notConnected: false }));
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const res = await fetch(`/api/dropbox/files${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDbx({ loading: false, files: [], folder: data.folder ?? "/notes", error: data.error || `Dropbox failed (HTTP ${res.status})`, notConnected: data.code === "not_connected" });
        return;
      }
      const files: DbxFile[] = data.files ?? [];
      setDbx({ loading: false, files, folder: data.folder ?? "/notes" });
      setPicked(new Set(files.filter((f) => f.status !== "added").map((f) => f.id))); // pre-tick what's new
    } catch (e) {
      setDbx({ loading: false, files: [], folder: "/notes", error: e instanceof Error ? e.message : "Couldn't reach Dropbox" });
    }
  }, [sessionId]);

  useEffect(() => {
    if (open && tab === "dropbox") void loadDropbox();
  }, [open, tab, loadDropbox]);

  function togglePick(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function addFromDropbox() {
    if (!picked.size) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dropbox/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, fileIds: [...picked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Dropbox failed (HTTP ${res.status})`);

      const added: any[] = data.sources ?? [];
      if (!sessionId && data.sessionId) {
        await _loadSessionData(data.sessionId);
      } else if (added.length) {
        // show them immediately; the server-side list catches up once indexing finishes
        useLens.setState((s) => ({
          sources: [...s.sources.filter((x) => !added.some((n) => n._id === x._id)), ...added] as any,
        }));
      }

      const failed: { name: string; error: string }[] = data.failed ?? [];
      if (failed.length) pushToast({ kind: "error", text: `${failed[0].name}: ${failed[0].error}` });
      else pushToast({ kind: "success", text: `Added ${added.length} from Dropbox` });
      if (!failed.length) onClose();
      else void loadDropbox();
    } catch (err) {
      pushToast({ kind: "error", text: err instanceof Error ? err.message : "Dropbox failed" });
    } finally {
      setBusy(false);
    }
  }

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(true);
      try {
        for (const f of files) await uploadFile(f);
        onClose();
      } finally {
        setBusy(false);
      }
    },
    [uploadFile, onClose]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      // Documents
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      // Text / data
      "text/plain": [".txt"],
      "text/markdown": [".md"],
      "text/csv": [".csv"],
      "text/tab-separated-values": [".tsv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      // Images
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      // Audio lectures
      "audio/mpeg": [".mp3"],
      "audio/mp4": [".m4a"],
      "audio/wav": [".wav"],
      "audio/ogg": [".ogg"],
      "audio/webm": [".webm"],
      "audio/aac": [".aac"],
      // Video lectures
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/webm": [".webm"],
    },
    maxSize: 200 * 1024 * 1024, // server enforces per-type limits (50MB docs, 200MB audio/video)
    multiple: true,
  });

  async function submitYT() {
    if (!ytUrl.trim()) return;
    setBusy(true);
    try {
      await addYouTube(ytUrl.trim());
      setYtUrl("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await addUrl(url.trim());
      setUrl("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto max-h-[90vh] w-[min(520px,92vw)] overflow-y-auto rounded-2xl border border-ink-800/30 bg-white shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-ink-800/10 px-5 py-3.5">
              <div className="text-[13px] font-medium text-ink-100">Add a study source</div>
              <button
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-950/5"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex gap-1 border-b border-ink-800/10 px-4 pt-3">
              {(
                [
                  { id: "upload", label: "Upload", icon: FileText },
                  { id: "dropbox", label: "Dropbox", icon: Cloud },
                  { id: "youtube", label: "YouTube", icon: Youtube },
                  { id: "url", label: "URL", icon: Link2 },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] transition",
                    tab === t.id
                      ? "border-b-2 border-signal text-ink-100"
                      : "text-ink-500 hover:text-ink-300"
                  )}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tab === "upload" && (
                <div
                  {...getRootProps()}
                  data-dropzone
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
                    isDragActive
                      ? "border-signal bg-signal/5"
                      : "border-ink-800/20 hover:border-signal/40 hover:bg-ink-950/[0.02]"
                  )}
                >
                  <input {...getInputProps()} />
                  {busy ? (
                    <Loader2 className="size-6 animate-spin text-signal" />
                  ) : (
                    <Upload className="size-6 text-ink-400" />
                  )}
                  <div className="mt-3 text-[13px] text-ink-200">
                    {busy
                      ? "Reading it now…"
                      : isDragActive
                      ? "Drop to add it to your study session"
                      : "Drop a file or click to browse. Pro tip: the Chrome extension can grab any tab in one click."}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-500">
                    PDF, DOCX, TXT, MD, CSV, XLSX, PNG, JPG · up to 50 MB · Audio/Video up to 200 MB
                  </div>
                </div>
              )}

              {tab === "dropbox" && (
                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] text-ink-500">
                    <span>
                      Your Dropbox folder: <span className="font-mono text-ink-300">{dbx.folder}</span>
                    </span>
                    <button
                      onClick={loadDropbox}
                      disabled={dbx.loading || busy}
                      className="flex items-center gap-1 transition hover:text-ink-300 disabled:opacity-50"
                    >
                      <RefreshCw className={cn("size-3", dbx.loading && "animate-spin")} />
                      Refresh
                    </button>
                  </div>

                  {dbx.loading && dbx.files.length === 0 && (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-ink-800/15 px-4 py-8 text-[12px] text-ink-500">
                      <Loader2 className="size-4 animate-spin" /> Looking in your Dropbox…
                    </div>
                  )}

                  {dbx.error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-600">
                      {dbx.error}
                    </div>
                  )}

                  {!dbx.loading && !dbx.error && dbx.files.length === 0 && (
                    <div className="rounded-xl border border-dashed border-ink-800/20 px-4 py-8 text-center text-[12px] text-ink-500">
                      No PDFs or documents in this Dropbox folder yet. Add some in Dropbox and hit Refresh.
                    </div>
                  )}

                  {dbx.files.length > 0 && (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto scrollbar-slim">
                      {dbx.files.map((f) => {
                        const already = f.status === "added";
                        const on = picked.has(f.id);
                        return (
                          <button
                            key={f.id}
                            onClick={() => !already && togglePick(f.id)}
                            disabled={already || busy}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                              already
                                ? "border-ink-800/10 bg-white/40 opacity-60"
                                : on
                                ? "border-signal/50 bg-signal/5"
                                : "border-ink-800/15 hover:border-signal/40"
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded border",
                                already || on ? "border-signal bg-signal text-white" : "border-ink-800/30"
                              )}
                            >
                              {(already || on) && <Check className="size-3" />}
                            </span>
                            <FileText className="size-4 shrink-0 text-signal-deep" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-ink-200">{f.name}</span>
                              <span className="block truncate text-[11px] text-ink-500">
                                {f.path} · {prettySize(f.size)}
                              </span>
                            </span>
                            {f.status === "added" && <span className="text-[11px] text-ink-500">Added</span>}
                            {f.status === "changed" && <span className="text-[11px] text-signal-deep">Updated in Dropbox</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {dbx.files.length > 0 && (
                    <button
                      onClick={addFromDropbox}
                      disabled={busy || picked.size === 0}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-signal to-signal-deep px-4 py-2.5 text-[12px] font-medium text-white shadow-glow disabled:opacity-60"
                    >
                      {busy && <Loader2 className="size-3.5 animate-spin" />}
                      {busy ? "Reading your notes…" : picked.size ? `Add ${picked.size} file${picked.size === 1 ? "" : "s"} from Dropbox` : "Nothing new to add"}
                    </button>
                  )}
                </div>
              )}

              {tab === "youtube" && (
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-500">
                    YouTube URL
                  </label>
                  <input
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitYT()}
                    placeholder="https://youtube.com/watch?v=..."
                    className="w-full rounded-lg border border-ink-800/20 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-signal/40 focus:shadow-glow"
                  />
                  <div className="mt-2 text-[11px] text-ink-500">
                    Drop in a lecture and LENS can cite the exact moment in the transcript that contradicts what you just did.
                  </div>
                  <button
                    onClick={submitYT}
                    disabled={busy || !ytUrl.trim()}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-signal to-signal-deep px-4 py-2.5 text-[12px] font-medium text-white shadow-glow disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Add YouTube
                  </button>
                </div>
              )}

              {tab === "url" && (
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-500">
                    Webpage URL
                  </label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitUrl()}
                    placeholder="https://brightspace.example.edu/module/4"
                    className="w-full rounded-lg border border-ink-800/20 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-signal/40 focus:shadow-glow"
                  />
                  <div className="mt-2 text-[11px] text-ink-500">
                    Brightspace, articles, wikis, docs — anything on the web. (One click with the Chrome extension if it’s already open.)
                  </div>
                  <button
                    onClick={submitUrl}
                    disabled={busy || !url.trim()}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-signal to-signal-deep px-4 py-2.5 text-[12px] font-medium text-white shadow-glow disabled:opacity-60"
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Add URL
                  </button>
                </div>
              )}
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
