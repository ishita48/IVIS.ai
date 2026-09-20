import { describe, expect, it } from "vitest";
import { realKey } from "./env-keys";

describe("realKey", () => {
  it("rejects the placeholders that ship in .env.example", () => {
    expect(realKey("sk-ant-...")).toBeNull();
    expect(realKey("...")).toBeNull();
    expect(realKey("")).toBeNull();
    expect(realKey("   ")).toBeNull();
    expect(realKey(undefined)).toBeNull();
    expect(realKey("your-key-here-your-key-here")).toBeNull();
    expect(realKey("short")).toBeNull();
  });
  it("accepts a real-looking key, with or without quotes", () => {
    expect(realKey("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")).toMatch(/^sk-ant/);
    expect(realKey('"sk-proj-abcdefghijklmnopqrstuvwxyz"')).toBe("sk-proj-abcdefghijklmnopqrstuvwxyz");
  });
});
