"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, ListPlus, Sparkles } from "lucide-react";
import { useLens } from "@/lib/store";

export function BulkUrlModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: (added: number) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { bulkIngest, pushToast } = useLens();

  async function submit() {
    const lines = text
      .split(/\r?\n|,/g)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));

    if (!lines.length) {
      pushToast({ kind: "error", text: "Paste at least one http(s) URL." });
      return;
    }

    setBusy(true);
    try {
      const { added, total } = await bulkIngest(lines);
      pushToast({
        kind: added > 0 ? "success" : "error",
        text:
          added === total
            ? `Added ${added} source${added === 1 ? "" : "s"}`
            : `Added ${added} of ${total} (${total - added} failed)`,
      });
      setText("");
      onDone?.(added);
      if (added > 0) onClose();
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
            className="fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-ink-800/30 bg-white shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-ink-800/10 px-5 py-3.5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink-100">
                <ListPlus className="size-4 text-signal" />
                Paste a stack of tabs
              </div>
              <button
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-950/5"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5">
              <p className="mb-3 text-[12px] leading-relaxed text-ink-400">
                Paste links from your open tabs — one per line or comma-separated.
                LENS pulls each one (YouTube transcripts, Brightspace pages, articles)
                and turns it into context for your session. Way faster with the
                Chrome extension if you have it pinned.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`https://youtube.com/watch?v=...\nhttps://brightspace.example.edu/module/4\nhttps://en.wikipedia.org/wiki/...`}
                rows={7}
                className="w-full resize-none rounded-lg border border-ink-800/20 bg-white px-3 py-2.5 font-mono text-[12px] leading-relaxed outline-none focus:border-signal/40 focus:shadow-glow"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-ink-500">
                <span>
                  Up to 15 URLs · PDFs not supported via URL (use the Upload tab)
                </span>
              </div>
              <button
                onClick={submit}
                disabled={busy || !text.trim()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-signal to-signal-deep px-4 py-2.5 text-[12px] font-medium text-white shadow-glow disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Reading them now…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Bring them in
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
