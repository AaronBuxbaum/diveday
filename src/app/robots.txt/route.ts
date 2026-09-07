import { publicAppUrl } from "@/lib/notifications";
import { renderRobotsTxt } from "@/lib/robots";

/**
 * `robots.txt`, rendered from `src/lib/robots.ts` rather than Next's
 * `robots.ts` convention — the convention has no slot for the one comment
 * line that points an agent at `/llms.txt` (issue #1427). Everything else the
 * convention emitted is emitted here unchanged.
 */
export function GET() {
  const origin = publicAppUrl() ?? "http://localhost:3000";
  return new Response(renderRobotsTxt(origin), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
