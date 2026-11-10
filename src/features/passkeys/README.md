# passkeys

This module owns the browser capability decision for offering the optional staff passkey action. Its public contract is `index.ts`.

`rules.ts` checks a secure domain context and the browser API. It never infers that the device holds an account credential. Cryptographic verification, origin and relying-party binding, live staff sessions and factor management remain in the authentication substrate. Routes and UI stay in `src/app`.
