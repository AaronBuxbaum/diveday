Date: 2026-10-14
Project: agent-tooling
Symptom: In a cloud session the shell resets to /home/claude/diveday after every command, so scripts/guard-push.mjs reads the main checkout's verify stamp. A worktree's green pnpm verify:push is refused even with cd <worktree> && git push or git -C <worktree> push.
Fix: Pushed with DIVEDAY_PUSH_UNVERIFIED naming the worktree's green run, on the owner's OK. The guard should resolve the stamp from the cd or -C target it already parses.
