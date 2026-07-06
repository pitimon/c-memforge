/**
 * Tests for mem_resume formatting (memforge #74 — lifetime-memory Wave 2).
 *
 * F2 regression: the server's GET /api/v1/resume returns
 * `latest_retrospective = {id, created_at, title, narrative}`
 * (see memforge `formatRetrospective` in docker/scripts/api/routes/session.ts).
 * The fixtures below use those EXACT server keys — not the client's own
 * `RetrospectiveRecord` type re-encoded — so a future type/decode mismatch
 * fails this test instead of silently dropping the section.
 */

import { describe, test, expect } from "bun:test";
import { formatResume, type ResumeResponse } from "../handlers/session-handlers";

describe("formatResume", () => {
  test("renders the Latest Retrospective section from a literal server-shaped fixture", () => {
    // Literal JSON as GET /api/v1/resume actually returns it — server keys only.
    const serverResponse: ResumeResponse = JSON.parse(`{
      "latest_handoff": {
        "id": 42,
        "project": "memforge",
        "next_steps": ["Ship fix 1"],
        "context": "Investigated F2 retrospective drop.",
        "open_loops": [],
        "created_at": "2026-07-01T00:00:00.000Z"
      },
      "prior_handoffs": [],
      "latest_retrospective": {
        "id": 7,
        "created_at": "2026-06-30T00:00:00.000Z",
        "title": "Session Handoff Wave 2 Retro",
        "narrative": "We shipped mem_handoff/mem_resume; the retrospective field mismatch was caught in review before release."
      },
      "open_loops": [],
      "empty": false
    }`);

    const output = formatResume("memforge", serverResponse);

    expect(output).toContain("## Latest Retrospective");
    expect(output).toContain("Session Handoff Wave 2 Retro");
    expect(output).toContain(
      "We shipped mem_handoff/mem_resume; the retrospective field mismatch was caught in review before release.",
    );
  });

  test("excerpts a long retrospective narrative to <= 300 chars", () => {
    const longNarrative = "x".repeat(500);
    const serverResponse: ResumeResponse = {
      latest_handoff: null,
      prior_handoffs: [],
      latest_retrospective: {
        id: 1,
        created_at: "2026-06-30T00:00:00.000Z",
        title: "Long Retro",
        narrative: longNarrative,
      },
      open_loops: [],
      empty: false,
    };

    const output = formatResume("memforge", serverResponse);
    const retroSection = output.split("## Latest Retrospective")[1] ?? "";

    // 300 chars of "x" plus the "..." ellipsis marker, no more.
    expect(retroSection).toContain("x".repeat(300) + "...");
    expect(retroSection).not.toContain("x".repeat(301));
  });

  test("omits the Latest Retrospective section when latest_retrospective is null", () => {
    const serverResponse: ResumeResponse = {
      latest_handoff: null,
      prior_handoffs: [],
      latest_retrospective: null,
      open_loops: [],
      empty: false,
    };

    const output = formatResume("memforge", serverResponse);

    expect(output).not.toContain("## Latest Retrospective");
  });

  test("renders the empty-state guidance when empty is true", () => {
    const serverResponse: ResumeResponse = {
      latest_handoff: null,
      prior_handoffs: [],
      latest_retrospective: null,
      open_loops: [],
      empty: true,
      guidance: "No handoff recorded for memforge yet. Use mem_handoff at session end to leave one.",
    };

    const output = formatResume("memforge", serverResponse);

    expect(output).toContain(
      "No handoff history found for project \"memforge\".",
    );
    expect(output).toContain("No handoff recorded for memforge yet.");
  });

  test("renders next steps, open loops, context, and prior handoffs", () => {
    const serverResponse: ResumeResponse = {
      latest_handoff: {
        id: 1,
        project: "memforge",
        next_steps: ["Do A", "Do B"],
        context: "Some narrative context.",
        open_loops: ["Unresolved question"],
        created_at: "2026-07-01T00:00:00.000Z",
      },
      prior_handoffs: [
        { id: 0, project: "memforge", created_at: "2026-06-01T00:00:00.000Z" },
      ],
      latest_retrospective: null,
      open_loops: [],
      empty: false,
    };

    const output = formatResume("memforge", serverResponse);

    expect(output).toContain("## NEXT STEPS");
    expect(output).toContain("1. Do A");
    expect(output).toContain("2. Do B");
    expect(output).toContain("## OPEN LOOPS");
    expect(output).toContain("- Unresolved question");
    expect(output).toContain("## Context");
    expect(output).toContain("Some narrative context.");
    expect(output).toContain("## Prior Handoffs");
    expect(output).toContain("1 prior handoff(s)");
  });
});
