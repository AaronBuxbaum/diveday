# Demo starting places

The first-arrival demo strip offers the existing feature-page roles for roll call, desk
check-in and public booking. `index.ts` is the public entry point.

`rules.ts` holds the closed start identifiers and resolves their feature-page role. `store.ts`
reads at most one upcoming, live, scheduled departure from a demo shop; a captain destination
must belong to a departure the demo captain crews. The role-switch action calls this only after
its existing demo-seat authorization and sign-in. A missing departure falls back to Today.

The server shells resolve choices and translations before passing them to shared client
components. Dismissal lives in session storage per demo slug and changes no shop data.
