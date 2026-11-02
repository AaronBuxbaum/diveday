# H-20261014-unrelated-plugins-off: Turn off the plugins and connectors this project does not use?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Turn off the sales, legal, marketing, data and design plugins, and the Gmail, Calendar, Drive and Argos connectors, for this project?** Together they add about 9k tokens to every call (the 2026-10-14 best-practice comparison, row 13; prompt-loop sheet 2026-10-14, call 2).

## Minimum outcome to record

Yes or no, and who makes the change.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the token thread, "Do all recommended actions"):** yes.

What the Claude Code docs say (read 2026-10-14, code.claude.com/docs/en/plugins/loading and /en/mcp):

- The plugins arrive from the claude.ai account as `<name>@synced` (marketplace `knowledge-work-plugins`, installation preference "available", not required). A synced plugin is kept out of one project "in every environment" by setting `"<name>@synced": false` under `enabledPlugins` in the project's committed `.claude/settings.json`. So the plugin half can be done in the repository: `"enabledPlugins": { "sales@synced": false, "legal@synced": false, "marketing@synced": false, "data@synced": false, "design@synced": false }`.
- The connectors in a cloud session are passed in by the cloud host. `disableClaudeAiConnectors` acts only on connectors Claude Code fetches itself (terminal sessions), not on these; `deniedMcpServers` entries that reach a cloud session do filter delivered connectors, but the docs do not say which `serverName` the host gives each one. The reliable switch for the connectors is claude.ai's connector settings for this project or environment.

Agents may not edit `.claude/settings.json`, so the plugin lines wait for Aaron to add them or say an agent may.

## Unblocks / follow-up

Aaron: add the `enabledPlugins` lines above (or approve an agent doing it), and turn the four connectors off for this project on claude.ai.

Part of the [human decision log](README.md#decision-register).
