Date: 2026-10-14
Project: scripts
Symptom: The Stop hook (scripts/stray-processes.mjs) labelled a background shell this session started with run_in_background (PGLITE_DATA_DIR=memory pnpm dev, writing to this session's own scratchpad) as [ANOTHER session], told me never to kill it, and the auto-mode classifier then refused a plain kill of my own pid. TaskStop on the task id worked.
Fix: Attribute a shell to the current session when its command line names this session's scratchpad or task directory (the session id appears in the path), not only by parent pid; and name TaskStop <task-id> as the correct form in the refusal message.
