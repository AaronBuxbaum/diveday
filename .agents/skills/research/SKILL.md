---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when a topic needs researching, docs or API facts need gathering, or reading is delegated to a background agent.
---

Do the research in this context by default. Hand it to a **background agent** only when the reading would bloat the context, the questions are independent and can run in parallel (at most three), or the user asked for one; then you keep working while it reads.

The research:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
4. If delegated, hand back the file's path plus at most ten lines; otherwise name the path in your reply. The file is the result; the caller reads it there, not in the hand-back.
