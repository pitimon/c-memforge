---
description: Write a first-person session retrospective (AI Diary + Honest Feedback) into memforge
---

Write a first-person retrospective of this session and submit it to memforge via
`mem_ingest`. Respond in the user's language for any commentary to the user, but write
the retrospective narrative itself in clear prose (English is fine unless the session
was conducted in another language).

## Required structure — HARD RULE

The retrospective narrative MUST contain exactly these two sections, with these exact
headings:

```
## AI Diary
<first-person narrative of the session: what I did, what surprised me, how decisions
felt in the moment, where I hesitated or changed approach>

## Honest Feedback
<frank assessment: what went poorly, what the human could have done better or
communicated more clearly, what I could have done better>
```

**REFUSE to submit if either section is missing or empty.** If you find yourself about
to call `mem_ingest` without a genuine, non-trivial "AI Diary" or "Honest Feedback"
section, STOP — do not submit a placeholder or a one-line stub. Instead, generate the
missing section properly first (actually reflect on the session), or ask the user for
input on the missing part, then proceed. A retrospective with a blank or token section
is worse than no retrospective at all — do not let politeness or a rush to finish
produce empty sections.

## Steps

1. **Derive the project**: current working directory name, repo name, or ask the user
   if ambiguous.

2. **Write the "AI Diary" section**: a genuine first-person account of this session —
   what was attempted, what worked, what surprised you, where you changed course, how
   ambiguous instructions were resolved.

3. **Write the "Honest Feedback" section**: a frank, specific assessment — what went
   poorly, what the human could improve (unclear instructions, missing context, etc.),
   and what you (the AI) could have done better. Do not soften this into generic
   praise — the value of this section is candor.

4. **Verify both sections are present and non-empty** before proceeding. If either is
   missing, go back to step 2/3 — do not submit.

5. **Submit via `mem_ingest`** with:
   ```json
   {
     "items": [
       {
         "type": "retrospective",
         "title": "Retrospective: <project> <date>",
         "narrative": "<full text, including both ## AI Diary and ## Honest Feedback sections>",
         "project": "<project>"
       }
     ]
   }
   ```

6. **Confirm to the user**: report the observation id returned and confirm both
   sections were included.
