import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** No live URL: token-bearing routes must be supplied as route templates by the reviewer. */
export function writeCaptureEvidence({
  directory,
  image,
  build,
  viewport,
  browser,
  title,
  contract,
  locale,
}) {
  mkdirSync(directory, { recursive: true });
  const storedImage = path.join(directory, path.basename(image));
  if (path.resolve(storedImage) !== path.resolve(image)) copyFileSync(image, storedImage);
  const evidence = {
    version: 1,
    image: storedImage,
    imageSha256: createHash("sha256").update(readFileSync(image)).digest("hex"),
    build,
    viewport,
    browser,
    title,
    locale,
    contract: contract ?? null,
    stateEvidence: contract?.expectedVisible ? "positive-visible-assertion-passed" : "not-declared",
    review: "not-reviewed",
  };
  writeFileSync(
    path.join(directory, `${path.basename(image)}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

/** A route template, never a token-bearing live URL, is persisted in evidence. */
export function matchesRoute(template, pathname) {
  if (!template?.startsWith("/") || template.includes("?") || template.includes("#")) return false;
  const segments = template.split("/").map((segment) => {
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return ".+";
    if (/^\[[^\]]+\]$/.test(segment)) return "[^/]+";
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${segments.join("/")}/?$`).test(pathname);
}

/** Hash at worker/spec boundaries, not for every image. Drift invalidates the run. */
export function captureBuildBoundary(checkFresh) {
  let build = null;
  return {
    begin() {
      build = checkFresh();
    },
    current() {
      if (!build) throw new Error("Visual build guard must run before capturing.");
      return build;
    },
    end() {
      const after = checkFresh();
      if (!build || after.fingerprint !== build.fingerprint || after.buildId !== build.buildId) {
        throw new Error(
          "Build changed during visual capture; evidence is invalid. Rerun against one fresh build.",
        );
      }
    },
  };
}
