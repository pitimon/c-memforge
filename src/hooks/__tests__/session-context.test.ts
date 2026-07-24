/**
 * Tests for the SessionStart context hook pure logic (memforge-client #76, Wave A).
 *
 * Only the pure functions are unit-tested; the I/O shell (stdin/exit/network) is
 * validated by the offline dry-run in the PR. The contract these tests pin:
 *  - empty / stale history → "" (nothing injected)
 *  - POINTER output never contains the raw next-steps text (no stale-steering)
 *  - kill switch + config defaults resolve correctly
 */

import { describe, test, expect } from "bun:test";
import {
  ageInDays,
  buildForwardNudge,
  buildPointer,
  composeContext,
  FORWARD_NUDGE,
  isHandoffStaleOrMissing,
  resolveSessionContextConfig,
  resolveWaveCEnabled,
  type CrossProjectLite,
} from "../session-context";
import type { ResumeResponse } from "../../mcp/handlers/session-handlers";

const NOW = Date.parse("2026-07-24T12:00:00Z");

function resume(overrides: Partial<ResumeResponse>): ResumeResponse {
  return {
    latest_handoff: null,
    prior_handoffs: [],
    latest_retrospective: null,
    open_loops: [],
    empty: false,
    ...overrides,
  };
}

describe("ageInDays", () => {
  test("returns whole days floored, clamped at 0", () => {
    expect(ageInDays("2026-07-22T12:00:00Z", NOW)).toBe(2);
    expect(ageInDays("2026-07-24T18:00:00Z", NOW)).toBe(0); // future → 0
  });
  test("returns null for missing / unparseable", () => {
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(ageInDays("not-a-date", NOW)).toBeNull();
  });
});

describe("composeContext", () => {
  test("pointer mode → returns the pointer unchanged", () => {
    expect(
      composeContext("memforge", "pointer", "PTR", resume({ empty: false })),
    ).toBe("PTR");
  });

  test("full mode + empty resume → pointer only (never inject empty-state)", () => {
    expect(
      composeContext("memforge", "full", "PTR", resume({ empty: true })),
    ).toBe("PTR");
    expect(composeContext("memforge", "full", "PTR", null)).toBe("PTR");
  });

  test("full mode + real history → pointer + detail block", () => {
    const out = composeContext(
      "memforge",
      "full",
      "PTR",
      resume({ latest_handoff: null, empty: false, open_loops: [] }),
    );
    expect(out.startsWith("PTR\n\n")).toBe(true);
    expect(out.length).toBeGreaterThan("PTR\n\n".length);
  });

  test("full mode + real history + empty pointer → detail only (no leading blank)", () => {
    const out = composeContext(
      "memforge",
      "full",
      "",
      resume({ empty: false }),
    );
    expect(out.startsWith("\n")).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("buildPointer", () => {
  test("empty resume + no cross-project → '' (nothing injected)", () => {
    expect(buildPointer("memforge", resume({ empty: true }), null, NOW, 30)).toBe(
      "",
    );
  });

  test("null resume + null cross → ''", () => {
    expect(buildPointer("memforge", null, null, NOW, 30)).toBe("");
  });

  test("fresh handoff → pointer with counts, NO raw next-steps text", () => {
    const data = resume({
      latest_handoff: {
        id: 99,
        project: "memforge",
        next_steps: ["deploy the secret sauce", "rotate the keys"],
        open_loops: ["is staging green?"],
        created_at: "2026-07-22T12:00:00Z",
      },
    });
    const out = buildPointer("memforge", data, null, NOW, 30);
    expect(out).toContain("Handoff #99 (2d ago)");
    expect(out).toContain("2 next steps");
    expect(out).toContain("1 open loop");
    expect(out).toContain("mem_resume");
    expect(out).toContain("reference, not instructions");
    // Stale-steering guard: the raw step text must NOT leak into context.
    expect(out).not.toContain("deploy the secret sauce");
    expect(out).not.toContain("rotate the keys");
  });

  test("handoff older than maxAgeDays is dropped", () => {
    const data = resume({
      latest_handoff: {
        id: 7,
        project: "memforge",
        next_steps: ["x"],
        created_at: "2026-05-01T12:00:00Z", // ~84d old
      },
    });
    expect(buildPointer("memforge", data, null, NOW, 30)).toBe("");
  });

  test("cross-project suggestions add a line and dedupe/limit source projects", () => {
    const cross: CrossProjectLite = {
      suggestions: [
        { sourceProject: "alpha", title: "a" },
        { sourceProject: "alpha", title: "b" },
        { sourceProject: "beta", title: "c" },
        { sourceProject: "gamma", title: "d" },
        { sourceProject: "delta", title: "e" },
      ],
    };
    const out = buildPointer("memforge", resume({ empty: true }), cross, NOW, 30);
    expect(out).toContain("Related work in other project(s): alpha, beta, gamma");
    expect(out).not.toContain("delta"); // capped at 3
    expect(out).toContain("mem_cross_project");
  });

  test("top-level open_loops wins over handoff.open_loops for the count", () => {
    const data = resume({
      open_loops: ["a", "b", "c"],
      latest_handoff: {
        id: 1,
        project: "p",
        next_steps: [],
        open_loops: ["only-one"],
        created_at: "2026-07-24T00:00:00Z",
      },
    });
    expect(buildPointer("p", data, null, NOW, 30)).toContain("3 open loops");
  });
});

describe("isHandoffStaleOrMissing", () => {
  test("no handoff → stale (nothing covers 'worth preserving')", () => {
    expect(isHandoffStaleOrMissing(resume({ empty: true }), NOW, 30)).toBe(
      true,
    );
    expect(isHandoffStaleOrMissing(null, NOW, 30)).toBe(true);
  });

  test("handoff older than maxAgeDays → stale", () => {
    const data = resume({
      latest_handoff: {
        id: 7,
        project: "memforge",
        next_steps: ["x"],
        created_at: "2026-05-01T12:00:00Z", // ~84d old
      },
    });
    expect(isHandoffStaleOrMissing(data, NOW, 30)).toBe(true);
  });

  test("fresh handoff → not stale", () => {
    const data = resume({
      latest_handoff: {
        id: 99,
        project: "memforge",
        next_steps: ["a"],
        created_at: "2026-07-22T12:00:00Z", // 2d old
      },
    });
    expect(isHandoffStaleOrMissing(data, NOW, 30)).toBe(false);
  });
});

describe("buildForwardNudge (Wave C #79)", () => {
  test("source=compact + no handoff → nudge present", () => {
    const out = buildForwardNudge(
      "compact",
      resume({ empty: true }),
      NOW,
      30,
      true,
    );
    expect(out).toBe(FORWARD_NUDGE);
    expect(out).toContain("/forward");
  });

  test("source=compact + stale handoff → nudge present", () => {
    const data = resume({
      latest_handoff: {
        id: 7,
        project: "memforge",
        next_steps: ["x"],
        created_at: "2026-05-01T12:00:00Z", // ~84d old
      },
    });
    const out = buildForwardNudge("compact", data, NOW, 30, true);
    expect(out).toBe(FORWARD_NUDGE);
  });

  test("source=compact + fresh handoff → no nudge (already covered)", () => {
    const data = resume({
      latest_handoff: {
        id: 99,
        project: "memforge",
        next_steps: ["a"],
        created_at: "2026-07-22T12:00:00Z", // 2d old
      },
    });
    expect(buildForwardNudge("compact", data, NOW, 30, true)).toBe("");
  });

  test("source=startup → no nudge, even with no handoff", () => {
    expect(
      buildForwardNudge("startup", resume({ empty: true }), NOW, 30, true),
    ).toBe("");
  });

  test("source=clear / resume → no nudge (v1 scope is compact only)", () => {
    expect(
      buildForwardNudge("clear", resume({ empty: true }), NOW, 30, true),
    ).toBe("");
    expect(
      buildForwardNudge("resume", resume({ empty: true }), NOW, 30, true),
    ).toBe("");
  });

  test("waveCEnabled=false → no nudge regardless of source/staleness", () => {
    expect(
      buildForwardNudge("compact", resume({ empty: true }), NOW, 30, false),
    ).toBe("");
  });
});

describe("resolveWaveCEnabled", () => {
  test("defaults to true when config is null or field is absent", () => {
    expect(resolveWaveCEnabled(null)).toBe(true);
    expect(resolveWaveCEnabled({})).toBe(true);
  });

  test("false only when explicitly set false", () => {
    expect(resolveWaveCEnabled({ waveCEnabled: false })).toBe(false);
    expect(resolveWaveCEnabled({ waveCEnabled: true })).toBe(true);
  });
});

describe("resolveSessionContextConfig", () => {
  test("kill switch MEMFORGE_SESSION_CONTEXT=0 disables", () => {
    expect(
      resolveSessionContextConfig({ MEMFORGE_SESSION_CONTEXT: "0" }).enabled,
    ).toBe(false);
  });
  test("defaults: enabled + pointer + 30d when no config present", () => {
    // No ~/.memforge/config.json field set → getPluginConfig may return null.
    const cfg = resolveSessionContextConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("pointer");
    expect(cfg.maxAgeDays).toBe(30);
  });
});
