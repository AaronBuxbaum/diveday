---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when a topic needs researching or docs and API facts need gathering.
---

Research in the current session by default. Delegate to a background agent when independent review or parallel work is useful under the repository's delegation rules, or when the user asks for delegation. Start each delegated agent with a fresh context window and keep no more than three in flight.

Whether you or a delegated agent does the research:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
4. Hand back the file's path plus at most ten lines. The file is the result; the caller reads it there, not in the hand-back.
