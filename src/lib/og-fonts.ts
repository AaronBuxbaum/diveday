import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The fonts every `ImageResponse` card renders with, read off disk and awaited
 * *before* the response is constructed.
 *
 * This is not a style preference — it is the fix for a real failure. Given no
 * `fonts` option, `@vercel/og` acquires a face lazily, from inside the stream
 * that is already being piped to the client. When that acquisition doesn't
 * produce a usable face, satori emits an empty SVG, the rasterizer rejects it
 * ("Input buffer contains unsupported image format"), and the throw happens
 * *after* the 200 and its headers are already on the wire. There is no error
 * page left to render at that point, so Next can only destroy the socket: the
 * client sees a bare `socket hang up` with nothing to explain it, and the real
 * cause is a stack in the server's stderr that nobody is reading. That is
 * exactly how `/recap/<bad-token>/opengraph-image` failed on CI while passing
 * everywhere else, and why it looked like a sharp/librsvg problem for so long —
 * sharp was the messenger, reporting an empty buffer handed to it.
 *
 * Resolving the fonts up front moves the whole class of failure to *before* the
 * response exists, where a throw is an ordinary 500 with a stack, not a severed
 * connection. Next's own `opengraph-image` docs describe this same
 * `readFile(join(process.cwd(), ...))` shape.
 *
 * Both weights the cards actually use are registered. Supplying only one would
 * leave satori looking for the other at render time, which is the lazy path
 * again by a different door.
 */
const FONT_FILES = [
  { file: "Geist-400.ttf", weight: 400 },
  { file: "Geist-600.ttf", weight: 600 },
] as const;

/** The family name the cards reference in `fontFamily`. */
export const OG_FONT_FAMILY = "Geist";

/**
 * `weight` is a literal union rather than `number` on purpose: satori's own
 * `Weight` type is the nine hundred-steps, so a widened `number` is not
 * assignable and `ImageResponse` rejects the array at the type level.
 */
export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: (typeof FONT_FILES)[number]["weight"];
  style: "normal";
};

let cached: Promise<OgFont[]> | undefined;

async function read(): Promise<OgFont[]> {
  return Promise.all(
    FONT_FILES.map(async ({ file, weight }) => {
      // `process.cwd()`-relative, per Next's documented pattern: the server runs
      // from the project root, and a path built this way is what the build's
      // file tracing follows into the deployment bundle.
      const bytes = await readFile(join(process.cwd(), "assets", "fonts", file));
      return {
        name: OG_FONT_FAMILY,
        // A Node Buffer is a view onto a possibly larger pooled ArrayBuffer, so
        // handing over `bytes.buffer` can ship unrelated bytes and a wrong
        // length. Slice to exactly this file's range.
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        weight,
        style: "normal" as const,
      };
    }),
  );
}

/**
 * Reads the card fonts once per process and reuses them.
 *
 * A rejected read is deliberately not kept: caching a failure would turn one
 * unlucky read into a permanently broken OG route for the life of the process,
 * and the next request should get another chance.
 */
export function loadOgFonts(): Promise<OgFont[]> {
  cached ??= read().catch((error) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
