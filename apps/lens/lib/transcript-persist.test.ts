import { describe, it, expect } from "vitest";
import { takeUnrecorded } from "./transcript-persist";
import { hasTopicContent } from "./topic-turn";

const t = (id: string) => ({ id, role: "user" as const, text: id, at: 0 });

describe("takeUnrecorded", () => {
  it("returns every unrecorded entry when several land in one render, oldest first", () => {
    const recorded = new Set<string>();
    expect(takeUnrecorded([t("a"), t("b"), t("c")], recorded).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("never returns an entry twice", () => {
    const recorded = new Set<string>();
    takeUnrecorded([t("a"), t("b")], recorded);
    expect(takeUnrecorded([t("a"), t("b"), t("c")], recorded).map((x) => x.id)).toEqual(["c"]);
    expect(takeUnrecorded([t("a"), t("b"), t("c")], recorded)).toEqual([]);
  });
});

describe("hasTopicContent", () => {
  it("keeps short topic answers and drops pure filler", () => {
    for (const s of ["ATP", "DNA", "mitosis", "the Calvin cycle"]) expect(hasTopicContent(s), s).toBe(true);
    for (const s of ["ok", "ok thanks", "yeah I don't know", "hmm", "", "  ..."]) expect(hasTopicContent(s), s).toBe(false);
  });
});
