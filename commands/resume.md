---
description: Resume work: fetch latest handoff, open loops, and recent context for this project
---

Resume a project by pulling its handoff history. Respond in the user's language.

1. **Derive the project**: Use the current working directory name, the repo name
   (`git remote get-url origin` if available), or ask the user if ambiguous.

2. **Call `mem_resume`** with `project` (required) and optionally `limit` (max prior
   handoffs to include, default 3). The tool returns already-rendered text — present
   it to the user directly, do not re-parse or reformat it.

3. **If the output indicates no handoff history exists** (it will say plainly that
   none was found and suggest recording one): relay that guidance to the user, and
   suggest running `/forward` at the end of this session so the next one has
   something to resume from. Stop here.

4. **Otherwise, present the tool's output as-is** — it is already ordered as:
   - **NEXT STEPS** first — the most important part, numbered, from the latest handoff.
   - **OPEN LOOPS** next — unresolved questions/blockers, bulleted.
   - **Prior handoffs** — one line each (id/date), not full contents, so the user gets
     a sense of history without a wall of text.
   - **Latest retrospective excerpt**, if present — a short excerpt (not the full
     retrospective) so the user can decide whether to dig further.

5. Keep the presentation scannable — headers, short lines. This is meant to be read
   in a few seconds at the start of a session, not a full report.
