---
description: Write a session handoff before ending/clearing — what's done, what's next, open loops
---

Write a structured handoff so the next session (yours or another agent's) can pick up
without re-discovering context. Respond in the user's language.

1. **Derive the project**: Use the current working directory name, the repo name
   (`git remote get-url origin` if available), or ask the user if ambiguous. Do not
   guess silently on a genuinely unclear multi-project session — confirm with the user.

2. **Summarize completed work**: Review this session's conversation and produce a
   concise narrative — what was done and why, key decisions made, files touched.
   This becomes the `context` field.

3. **Enumerate next steps**: List concrete, imperative, actionable items for the next
   session (e.g. "Run the test suite and fix failures in X", not "testing"). This is
   required and must be non-empty — if there is truly nothing left, say so explicitly
   to the user instead of inventing filler steps.

4. **List open loops**: Unresolved questions, blockers, or threads that need a decision
   before work can continue (e.g. "Waiting on user to confirm schema field name").
   Omit this field if there are none — do not pad it.

5. **Call `mem_handoff`** with:
   - `project` (required)
   - `next_steps` (required, array of strings)
   - `context` (optional narrative)
   - `open_loops` (optional array of strings)
   - `agent_id` / `agent_type` if known

6. **Confirm to the user**: Report the handoff `id` returned, and a one-line summary
   of what was recorded (e.g. "Handoff #42 recorded for project X — 3 next steps, 1 open loop.").

Do not fabricate next steps or open loops that were not actually discussed in this
session — a handoff is only useful if it reflects reality.
