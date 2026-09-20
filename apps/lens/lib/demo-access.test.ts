import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

import { auth } from "@clerk/nextjs/server";
import {
  allowMint,
  consumeAnalysis,
  DEMO_TOKEN_TTL_MS,
  demoLimits,
  resetDemoCaps,
  resolveCaller,
  resolveDemoCaller,
  signDemoToken,
  verifyDemoToken,
} from "./demo-access";

const NOW = 1_800_000_000_000;
const ON = { DEMO_MODE: "1", DEMO_TOKEN_SECRET: "sixteen-plus-characters-of-secret" };
const OFF = { DEMO_TOKEN_SECRET: ON.DEMO_TOKEN_SECRET };

const withBearer = (token: string | null, ip = "203.0.113.7") =>
  new Request("http://localhost/api/vision/analyze", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

beforeEach(() => {
  resetDemoCaps();
});

afterEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(auth).mockImplementation(async () => ({ userId: null }) as never);
});

describe("token issue and verify", () => {
  it("verifies a token it just signed and returns the same id", () => {
    // The route mints, the client echoes it back. If this round trip fails nothing else matters.
    const minted = signDemoToken(NOW, ON);
    expect(minted).not.toBeNull();
    expect(verifyDemoToken(minted!.token, NOW + 1000, ON)).toEqual({
      id: minted!.id,
      expiresAt: NOW + DEMO_TOKEN_TTL_MS,
    });
  });

  it("rejects a token once thirty minutes have passed", () => {
    // Short-lived is the whole safety story; a token from the morning must not spend credits at night.
    const minted = signDemoToken(NOW, ON)!;
    expect(verifyDemoToken(minted.token, NOW + DEMO_TOKEN_TTL_MS - 1, ON)).not.toBeNull();
    expect(verifyDemoToken(minted.token, NOW + DEMO_TOKEN_TTL_MS, ON)).toBeNull();
  });

  it("rejects a token whose expiry was edited or whose signature is from another secret", () => {
    // A judge who can extend their own token has the API key.
    const minted = signDemoToken(NOW, ON)!;
    const [id, , sig] = minted.token.split(".");
    expect(verifyDemoToken(`${id}.${NOW + 10 * DEMO_TOKEN_TTL_MS}.${sig}`, NOW, ON)).toBeNull();

    const other = signDemoToken(NOW, { ...ON, DEMO_TOKEN_SECRET: "a-different-secret-of-length" })!;
    expect(verifyDemoToken(other.token, NOW, ON)).toBeNull();
    expect(verifyDemoToken("not-a-token", NOW, ON)).toBeNull();
  });

  it("mints nothing and honours nothing while DEMO_MODE is off", () => {
    // Off by default means off: a leaked secret without the switch buys nothing.
    expect(signDemoToken(NOW, OFF)).toBeNull();
    const minted = signDemoToken(NOW, ON)!;
    expect(verifyDemoToken(minted.token, NOW, OFF)).toBeNull();
  });

  it("refuses to sign without a secret of at least sixteen characters", () => {
    // An empty or trivial HMAC key would make every token forgeable.
    expect(signDemoToken(NOW, { DEMO_MODE: "1" })).toBeNull();
    expect(signDemoToken(NOW, { DEMO_MODE: "1", DEMO_TOKEN_SECRET: "short" })).toBeNull();
  });
});

describe("caps", () => {
  it("stops a token after the configured number of analyses", () => {
    // This is the number the reviewer signs off on. It has to hold exactly.
    const limits = { maxAnalysesPerToken: 3, maxTokensPerIpHour: 5 };
    expect(consumeAnalysis("t1", NOW + DEMO_TOKEN_TTL_MS, NOW, limits)).toBe(true);
    expect(consumeAnalysis("t1", NOW + DEMO_TOKEN_TTL_MS, NOW, limits)).toBe(true);
    expect(consumeAnalysis("t1", NOW + DEMO_TOKEN_TTL_MS, NOW, limits)).toBe(true);
    expect(consumeAnalysis("t1", NOW + DEMO_TOKEN_TTL_MS, NOW, limits)).toBe(false);
    expect(consumeAnalysis("t2", NOW + DEMO_TOKEN_TTL_MS, NOW, limits)).toBe(true);
  });

  it("stops an IP after the configured number of tokens in an hour, then lets it mint again", () => {
    // One phone refreshing the page must not mint an unbounded supply of fresh caps.
    const limits = { maxAnalysesPerToken: 20, maxTokensPerIpHour: 2 };
    expect(allowMint("ip-a", NOW, limits)).toBe(true);
    expect(allowMint("ip-a", NOW, limits)).toBe(true);
    expect(allowMint("ip-a", NOW, limits)).toBe(false);
    expect(allowMint("ip-b", NOW, limits)).toBe(true);
    expect(allowMint("ip-a", NOW + 60 * 60 * 1000 + 1, limits)).toBe(true);
  });

  it("reads caps from the environment and falls back to the defaults on garbage", () => {
    // The limits are env-tunable so the booth can be adjusted without a deploy.
    expect(demoLimits({ DEMO_MAX_ANALYSES_PER_TOKEN: "7", DEMO_MAX_TOKENS_PER_IP_HOUR: "2" })).toEqual({
      maxAnalysesPerToken: 7,
      maxTokensPerIpHour: 2,
    });
    expect(demoLimits({ DEMO_MAX_ANALYSES_PER_TOKEN: "-1", DEMO_MAX_TOKENS_PER_IP_HOUR: "lots" })).toEqual({
      maxAnalysesPerToken: 20,
      maxTokensPerIpHour: 5,
    });
  });
});

describe("resolving a request", () => {
  it("turns a valid bearer token into a demo caller under the demo: user id and spends one analysis", () => {
    // Events record against a real user id, so the metrics strip counts a judge's session too.
    const minted = signDemoToken(NOW, ON)!;
    const env = { ...ON, DEMO_MAX_ANALYSES_PER_TOKEN: "1" };
    expect(resolveDemoCaller(withBearer(minted.token), NOW, env)).toEqual({
      userId: `demo:${minted.id}`,
      demo: true,
    });
    expect(resolveDemoCaller(withBearer(minted.token), NOW, env)).toBeNull();
  });

  it("returns null with no header, an expired token, or demo mode off", () => {
    // Every failure collapses to the same 401 the routes already return.
    const minted = signDemoToken(NOW, ON)!;
    expect(resolveDemoCaller(withBearer(null), NOW, ON)).toBeNull();
    expect(resolveDemoCaller(withBearer(minted.token), NOW + DEMO_TOKEN_TTL_MS, ON)).toBeNull();
    expect(resolveDemoCaller(withBearer(minted.token), NOW, OFF)).toBeNull();
  });

  it("returns the Clerk user untouched when a session exists, without reading any token", async () => {
    // Signed-in behaviour is byte-for-byte what it was. That is the acceptance test.
    vi.mocked(auth).mockImplementation(async () => ({ userId: "user_2abc" }) as never);
    const minted = signDemoToken(NOW, ON)!;
    expect(await resolveCaller(withBearer(minted.token))).toEqual({ userId: "user_2abc", demo: false });
    expect(await resolveCaller(withBearer(null))).toEqual({ userId: "user_2abc", demo: false });
  });

  it("returns null for an anonymous caller when DEMO_MODE is unset in the real environment", async () => {
    // The default deployment is unchanged: no Clerk session, no access.
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("DEMO_TOKEN_SECRET", ON.DEMO_TOKEN_SECRET);
    const minted = signDemoToken(NOW, ON)!;
    expect(await resolveCaller(withBearer(minted.token))).toBeNull();
    vi.unstubAllEnvs();
  });
});
