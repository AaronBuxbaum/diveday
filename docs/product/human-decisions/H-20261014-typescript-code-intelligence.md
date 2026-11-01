# H-20261014-typescript-code-intelligence: Install the TypeScript code-intelligence plugin?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Install the TypeScript code-intelligence plugin?** One go-to-definition replaces a grep and several reads (the 2026-10-14 best-practice comparison, row 11; prompt-loop sheet 2026-10-14, call 3).

## Minimum outcome to record

Yes or no.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the token thread, "Do all recommended actions"):** yes.

What the Claude Code docs say (read 2026-10-14, code.claude.com/docs/en/plugins/code-intelligence and /en/discover-plugins): the plugin is `typescript-lsp@claude-plugins-official` and needs `typescript-language-server` on PATH (`npm install -g typescript-language-server typescript`). **In cloud sessions Claude Code does not start plugin language servers**, and a cloud session does not load plugins a repository's `.claude/settings.json` turns on. So a project `enabledPlugins` line would do nothing for the cloud threads this project runs in; the plugin helps only in a terminal session on Aaron's own machine (`/plugin install typescript-lsp@claude-plugins-official`, project or user scope).

## Unblocks / follow-up

Aaron, on a machine where he runs Claude Code in a terminal: install the binary and the plugin. Nothing to do for cloud threads until Claude Code starts language servers there.

Part of the [human decision log](README.md#decision-register).
