import { connection, NextResponse } from "next/server";
import RecapOpenGraphImage from "@/app/recap/[token]/opengraph-image";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * TEMPORARY DIAGNOSTIC — delete with `e2e/diagnose-og.spec.ts` and
 * `scripts/diagnose-og-sharp.mjs` once the recap OG-image failure is fixed.
 *
 * `e2e/recap.spec.ts`'s bad-token unfurl test fails on CI and only on CI, with
 * a socket hang up on `GET /recap/<bad>/opengraph-image` and, server-side,
 * `failed to pipe response` caused by sharp's "Input buffer contains
 * unsupported image format".
 *
 * The standalone probe (`scripts/diagnose-og-sharp.mjs`) already cleared the
 * *environment*: on the very same runner, in the same CI run, minutes before
 * the failure, sharp reported librsvg 2.62.90, rasterized an SVG, and
 * `ImageResponse` produced a byte-identical PNG to the one it produces locally.
 * So the runner is fine and the variable is the **server process** — which a
 * bare `node` script cannot reach.
 *
 * This runs the identical work *inside* the running Next server, and calls the
 * real route module rather than a lookalike, so nothing about the comparison is
 * approximate. Three outcomes, each pointing somewhere different:
 *
 *   - `ogModule` fails → the render genuinely breaks in this process, and its
 *     `cause` says how. Compare `sharpSvgToPng` to tell a sharp problem from a
 *     satori one.
 *   - `ogModule` succeeds → the render is fine and the fault is downstream, in
 *     how Next serves a metadata route and pipes the body. That would redirect
 *     the search entirely, away from sharp and toward `pipe-readable`.
 *   - It throws before either → the report says where.
 *
 * Guarded like every `/api/test` route: an env-var predicate plus the
 * `DIVEDAY_E2E_SECRET` bearer token, so it is unreachable in a deployment.
 */
export async function GET(request: Request) {
  // Load-bearing, and a trap worth naming: every other `/api/test` route is a
  // `POST`, which Next never prerenders. A `GET` route handler *is* prerendered
  // at build time under Cache Components — and `pnpm e2e:build` sets
  // `DIVEDAY_E2E` but not `DIVEDAY_E2E_SECRET`, so `e2eTestRouteAuthorized`
  // returned false during the build (bailing before it read any request header,
  // so nothing marked the route dynamic) and Next baked that `404
  // not_available` in as a static response — which then answered every runtime
  // request regardless of the token sent. `connection()` is the Cache
  // Components way to say "per request"; the older `dynamic = "force-dynamic"`
  // is rejected outright by this config.
  await connection();
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const report: Record<string, unknown> = {};

  try {
    const sharp = (await import("sharp")).default;
    report.sharpResolved = true;
    report.libvips = sharp.versions?.vips ?? null;
    report.rsvg = sharp.versions?.rsvg ?? "ABSENT";
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
    );
    try {
      const png = await sharp(svg).resize(20).png().toBuffer();
      report.sharpSvgToPng = `ok (${png.length} bytes)`;
    } catch (error) {
      report.sharpSvgToPng = `FAILED: ${(error as Error).message}`;
    }
  } catch (error) {
    // `@vercel/og` only takes its sharp branch when this import resolves; if it
    // fails here it would be using resvg instead, which is its own answer.
    report.sharpResolved = false;
    report.sharpImportError = (error as Error).message;
  }

  try {
    // The real module, with the exact token the failing test uses — so this
    // renders `genericCard()` down the same branch.
    const response = await RecapOpenGraphImage({
      params: Promise.resolve({ token: "not-a-real-token" }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    report.ogModule = `ok (${bytes.length} bytes, png=${bytes.subarray(1, 4).toString() === "PNG"})`;
  } catch (error) {
    const cause = (error as { cause?: Error })?.cause;
    report.ogModule = `FAILED: ${(error as Error)?.message}${cause ? ` | cause: ${cause.message ?? cause}` : ""}`;
  }

  return NextResponse.json(report);
}
