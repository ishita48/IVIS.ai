"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLens } from "@/lib/store";
import { CameraView } from "@/components/Camera/CameraView";
import { PointerView } from "./camera/PointerView";
import { ReasoningGraph } from "./reasoning/ReasoningGraph";
import { SourcesOverview } from "./SourcesOverview";

const variants = {
  enter: { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

export function Workspace() {
  const view = useLens((s) => s.view);
  return (
    <div className="relative h-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          className="h-full"
        >
          {view === "camera" && <CameraView />}
          {view === "pointer" && <PointerView />}
          {view === "reasoning" && <ReasoningGraph />}
          {view === "sources" && <SourcesOverview />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
