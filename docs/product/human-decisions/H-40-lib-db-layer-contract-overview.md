# H-40: The lib/db layer contract: overview.md calls src/lib "framework-free," but lib/auth.ts imports next-auth and getDb,…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

The lib/db layer contract: `overview.md` calls `src/lib` "framework-free," but `lib/auth.ts` imports next-auth and `getDb`, `src/db` imports `src/lib` in ~80 files, and the direction is unchecked either way (`comprehensive-review-20260802` HD-21, ARCH-1).

## Minimum outcome to record

Bless the status quo (one layer, pure/IO naming — fix the "framework-free" claim in `overview.md` to match) or choose to enforce lib→db type-only imports.

## Unblocks / follow-up

Either answer is fine; the standing contradiction between doc and code is the only bad option.

Part of the [human decision log](README.md#decision-register).
