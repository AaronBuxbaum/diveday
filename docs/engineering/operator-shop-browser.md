# Browse shops as a database operator

An operator is someone who already has access to the intended database. This tool does not grant
that access and never interprets a shop owner or manager as an administrator.

With `DATABASE_URL` supplied through the operator's existing secure environment, run:

```sh
pnpm exec tsx scripts/shop-browser.ts
```

Open the private loopback URL printed by the command. Search a generated name or slug, or page
through shops. Each page shows at most fifty names, slugs and demo flags. No customer, staff,
medical or payment data is part of the directory.

Choose **Show demo sign-in** beside the desired demo. The tool returns only an existing sample
owner login when the demo and reserved account namespace checks pass. Use the ordinary sign-in
page; real shops have no recovery or impersonation action here. Demo content is temporary and may
already have been removed. The visitor's typed shop name remains cookie-only and cannot be found
by this tool.

The server binds to `127.0.0.1`, not a public interface. Keep the printed launch URL private;
refreshing after its fragment has been removed requires reopening that URL. Stop with Ctrl+C.
Use a read-only database credential where available. Every query is additionally executed inside
a read-only transaction. Do not expose this listener through a reverse proxy or public tunnel.

This implementation was developed without production database access, production settings changes,
real credential creation or sending real emails. Ordinary account email sign-in is a separate
application flow; the operator browser neither sends nor reveals those links.
