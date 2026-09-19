"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Youtube, Link2, FileText, Loader2 } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

type Tab = "upload" | "youtube" | "url";

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
  const { uploadFile, addYouTube, addUrl } = useLens();

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
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-ink-800/30 bg-white shadow-lift"
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
        </>
      )}
    </AnimatePresence>
  );
}
