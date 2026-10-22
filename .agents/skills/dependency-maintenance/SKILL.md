---
name: dependency-maintenance
description: Upgrade dependencies with compatibility evidence.
---

# Update a dependency with bounded evidence

1. Identify direct users with `rg` and read the installed package's changelog/docs for the target version. Confirm the Node and package-manager pins first.
2. Change the smallest compatible dependency group. New runtime dependencies need an ADR; upgrades must explain breaking API or configuration changes.
3. Use the existing package manager to update the lockfile; never read the generated lockfile whole or hand-edit resolutions.
4. Run affected contract tests and the repository verification gate. Framework upgrades also require build and browser evidence for affected routes.
5. Capture versions, commands, failures and remaining CI runs in the task state. Avoid mixing unrelated cleanup into dependency fixes.
