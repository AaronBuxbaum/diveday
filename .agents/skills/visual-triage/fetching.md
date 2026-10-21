# Visual triage: fetching the report as an agent

Part of the **visual-triage** skill ([SKILL.md](SKILL.md)). Read it when you need the report's images in a cloud or sandboxed session.

## Fetching the report as an agent

`reg-suit` prints an `index.html` report link, but that page is a client-rendered SPA — its body is
literally `<div id="app"></div>` until JS runs, so a text-only fetch (WebFetch, `curl` without a
browser) sees nothing. Never try to read that link directly. Instead:

```bash
pnpm visual:report                      # current HEAD's commit
pnpm visual:report --commit <sha>       # a specific commit (e.g. a PR's head, from CI logs)
pnpm visual:report --all                # also pull passed items, not just changed/new/deleted
```

This pulls `out.json` and the relevant `expected`/`actual`/`diff` PNGs straight from the same public
S3 bucket (`regconfig.json`'s `reg-publish-s3-plugin` — no AWS credentials needed, the bucket is
public-read) into `.reg-report/<commit>/`, alongside a `REPORT.md` listing each changed/new/deleted
item with the local paths to its images. Read `REPORT.md`, then open each PNG path with the provider's image-viewing tool — inspect the pixels directly, which is the actual point: raw pixels beat any text description of them.
This works from a fresh checkout without ever running Playwright locally, as long as CI has already
published a report for that commit.

`REPORT.md` leads with the same verdict headline as the PR comment, above the counts, and prints how
many baseline images were downloaded — so a run that compared nothing cannot read as a clean one
here either. Beside those counts it says how many changed captures **moved geometry**, and each
item's section states its expected and actual dimensions and the signed height delta. Read those
before opening a single image: `unchanged` means the pixels moved inside a stable box, and a height
delta means the surface itself got taller or shorter.

For local work, `scripts/visual-review.mjs` writes a separate uniquely scoped manifest, private images and probe report under `.agent-out/visual-review/`. It never claims a CI comparison or completed review.
