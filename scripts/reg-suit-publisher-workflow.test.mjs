import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/reg-suit-publish.yml"), "utf8");
const CI_WORKFLOW = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const VISUAL_PUBLISH_CALL = CI_WORKFLOW.slice(
  CI_WORKFLOW.indexOf("\n  visual-publish:\n"),
  CI_WORKFLOW.indexOf("\n  visual-report:\n"),
);
const PREPARE = WORKFLOW.slice(
  WORKFLOW.indexOf("\n  prepare:\n"),
  WORKFLOW.indexOf("\n  publish:\n"),
);
const PUBLISH = WORKFLOW.slice(WORKFLOW.indexOf("\n  publish:\n"));
const PUBLISH_STEP = PUBLISH.slice(
  PUBLISH.indexOf("      - name: Publish the precompressed reg-suit bundle"),
);
const PUBLISH_SCRIPT = (() => {
  const runStart = PUBLISH_STEP.indexOf("        run: |\n");
  if (runStart < 0) throw new Error("publisher step shell block was not found");
  const lines = PUBLISH_STEP.slice(runStart + "        run: |\n".length).split("\n");
  const scriptLines = [];
  for (const line of lines) {
    if (line.trim() === "") {
      scriptLines.push("");
      continue;
    }
    if (!line.startsWith("          ")) break;
    scriptLines.push(line.slice(10));
  }
  // The workflow runs on Ubuntu's Bash 5. macOS Bash 3 lacks lowercase expansion.
  return scriptLines
    .join("\n")
    .replace(
      'object_path_lower="${object_path,,}"',
      'object_path_lower="$(printf "%s" "$object_path" | tr "[:upper:]" "[:lower:]")"',
    );
})();

function publisherFixture({
  existingSnapshot = false,
  existingPr = "3325",
  existingMode = "exact",
  prNumber = "3325",
  failKey = "",
  manifestContent,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-reg-suit-publisher-"));
  const bundle = path.join(root, "bundle");
  const payload = path.join(bundle, "payload");
  const bin = path.join(root, "bin");
  mkdirSync(path.join(payload, "actual"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["actual/one.png", "actual/two.png", "index.html", "out.json"]) {
    const fullPath = path.join(payload, `${file}.gz`);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "opaque compressed payload");
  }
  writeFileSync(
    path.join(bundle, "manifest.tsv"),
    manifestContent ??
      "actual/one.png\timage/png\nactual/two.png\timage/png\nindex.html\ttext/html\nout.json\tapplication/json\n",
  );
  const eventsPath = path.join(root, "events.log");
  writeFileSync(eventsPath, "");
  const awsPath = path.join(bin, "aws");
  const realpathPath = path.join(bin, "realpath");
  writeFileSync(
    awsPath,
    `#!/bin/bash
set -euo pipefail
operation="$2"
key=""
query=""
content_encoding=""
content_type=""
metadata=""
while (($#)); do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    --query) query="$2"; shift 2 ;;
    --content-encoding) content_encoding="$2"; shift 2 ;;
    --content-type) content_type="$2"; shift 2 ;;
    --metadata) metadata="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$operation" == "head-object" ]]; then
  printf 'HEAD\\t%s\\t%s\\n' "$key" "$query" >> "$EVENTS_PATH"
  if [[ "$EXISTING_SNAPSHOT" == "true" ]]; then
    object_path="\${key#"$REG_ACTUAL_KEY/"}"
    if [[ "$EXISTING_MODE" == "missing-object" && "$object_path" == "actual/two.png" ]]; then
      echo 'An error occurred (404) when calling the HeadObject operation: Not Found' >&2
      exit 1
    fi
    payload="$VISUAL_PUBLISH_BUNDLE/payload/$object_path.gz"
    sha256="$(sha256sum "$payload")"
    sha256="\${sha256%% *}"
    size="$(wc -c < "$payload" | tr -d '[:space:]')"
    encoding="gzip"
    case "$object_path" in
      actual/*.png) type="image/png" ;;
      index.html) type="text/html" ;;
      out.json) type="application/json" ;;
      *) type="application/octet-stream" ;;
    esac
    owner="$EXISTING_PR"
    case "$EXISTING_MODE:$object_path" in
      changed-report:out.json) sha256="$(printf changed | sha256sum)"; sha256="\${sha256%% *}" ;;
      changed-asset:actual/one.png) sha256="$(printf changed | sha256sum)"; sha256="\${sha256%% *}" ;;
      wrong-size:*) size=$((size + 1)) ;;
      wrong-type:actual/one.png) type="text/plain" ;;
      wrong-encoding:actual/one.png) encoding="identity" ;;
      missing-metadata:*) sha256="None"; size="None" ;;
    esac
    if [[ "$query" == '[ContentLength,ContentType,ContentEncoding,Metadata."diveday-sha256",Metadata."diveday-size",Metadata."diveday-pr-number"]' ]]; then
      printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$size" "$type" "$encoding" "$sha256" "$size" "$owner"
      exit 0
    fi
    echo "unexpected head query: $query" >&2
    exit 2
  fi
  echo 'An error occurred (404) when calling the HeadObject operation: Not Found' >&2
  exit 1
fi
if [[ "$operation" == "put-object" ]]; then
  [[ "$content_encoding" == "gzip" ]]
  payload="$VISUAL_PUBLISH_BUNDLE/payload/\${key#"$REG_ACTUAL_KEY/"}.gz"
  sha256="$(sha256sum "$payload")"
  sha256="\${sha256%% *}"
  size="$(wc -c < "$payload" | tr -d '[:space:]')"
  if [[ -n "$PR_NUMBER" ]]; then
    [[ "$metadata" == "diveday-sha256=$sha256,diveday-size=$size,diveday-pr-number=$PR_NUMBER" ]]
  else
    [[ "$metadata" == "diveday-sha256=$sha256,diveday-size=$size" ]]
  fi
  printf 'PUT\\t%s\\t%s\\n' "$key" "$metadata" >> "$EVENTS_PATH"
  [[ "$key" != "$FAIL_KEY" ]] || exit 1
  sleep 0.03
  printf 'DONE\\t%s\\n' "$key" >> "$EVENTS_PATH"
  printf 'etag\\n'
  exit 0
fi
echo "unexpected aws operation: $operation" >&2
exit 2
`,
  );
  chmodSync(awsPath, 0o755);
  writeFileSync(
    realpathPath,
    `#!/bin/bash
set -euo pipefail
[[ "$1" == "-e" ]]
shift
[[ "$1" == "--" ]] && shift
target="$1"
[[ -e "$target" ]]
if [[ -d "$target" ]]; then
  cd -P "$target"
  pwd
else
  directory="$(cd -P "$(dirname "$target")" && pwd)"
  printf '%s/%s\\n' "$directory" "$(basename "$target")"
fi
`,
  );
  chmodSync(realpathPath, 0o755);
  const result = spawnSync("/bin/bash", ["-c", PUBLISH_SCRIPT], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      EVENTS_PATH: eventsPath,
      EXISTING_SNAPSHOT: String(existingSnapshot),
      EXISTING_PR: existingPr,
      EXISTING_MODE: existingMode,
      FAIL_KEY: failKey,
      REG_ACTUAL_KEY: "a".repeat(40),
      REG_SUIT_AWS_REGION: "us-east-1",
      REG_SUIT_S3_BUCKET_NAME: "diveday-vrt",
      PR_NUMBER: prNumber,
      VISUAL_PUBLISH_BUNDLE: bundle,
    },
  });
  expect(result.error).toBeUndefined();
  const events = readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean);
  return { root, result, events };
}

describe("reg-suit publisher workflow", () => {
  it("pins the caller to the publisher revision that contains its runtime scripts", () => {
    expect(VISUAL_PUBLISH_CALL).toContain(
      "uses: AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@" +
        "0957f47220668dd3c1f280c79a977b62d1c63f90 # v1.0.1",
    );
  });

  it("accepts workflow calls only and repeats the same-repository fork guard", () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}workflow_call:/mu);
    expect(WORKFLOW).toContain("repository: ${{ job.workflow_repository }}");
    expect(WORKFLOW).toContain("ref: ${{ job.workflow_sha }}");
    expect(WORKFLOW).not.toContain("github.workflow_sha");
    expect(WORKFLOW).not.toContain("github.event.repository.default_branch");
    expect(WORKFLOW.match(/DEFAULT_BRANCH: main/g)).toHaveLength(2);
    expect(WORKFLOW).toContain(
      "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == " +
        "github.repository",
    );
    expect(WORKFLOW).toContain('REG_SUIT_TRUSTED_BASE_CODE: "true"');
  });

  it("keeps the image-processing job without OIDC and limits the publisher permission", () => {
    expect(PREPARE).toContain("      contents: read");
    expect(PREPARE).not.toContain("id-token:");
    const permissionStart = PUBLISH.indexOf("    permissions:\n");
    const permissionEnd = PUBLISH.indexOf("    outputs:\n", permissionStart);
    const publisherPermissions = PUBLISH.slice(permissionStart, permissionEnd);
    expect(publisherPermissions.trim()).toBe("permissions:\n      id-token: write");
    expect(publisherPermissions).not.toContain("contents:");
    expect(publisherPermissions).not.toContain("pull-requests:");
  });

  it("allows WebAssembly only for reg-suit's root detector asset", () => {
    expect(PUBLISH).toContain('object_path_lower="${object_path,,}"');
    const wasmGuard =
      'if [[ "$object_path_lower" == *.wasm && "$object_path:$content_type" != "detector.wasm:application/wasm" ]]; then';
    expect(PUBLISH).toContain(wasmGuard);
    expect(PUBLISH).toContain('case "$object_path:$content_type" in');
    expect(PUBLISH).toContain("detector.wasm:application/wasm) ;;");
    expect(PUBLISH).toContain("detector.wasm:*|*:application/wasm) exit 1 ;;");
    expect(PUBLISH.indexOf('case "$object_path:$content_type" in')).toBeGreaterThan(
      PUBLISH.indexOf(wasmGuard),
    );
  });

  it("decodes and compares in the unprivileged job, then uploads only a fixed bundle", () => {
    expect(WORKFLOW).toContain("name: visual-screenshots-1");
    expect(WORKFLOW).not.toContain("pattern: visual-screenshots-*");
    expect(WORKFLOW).not.toContain("path: e2e/screenshots");
    expect(WORKFLOW).toContain("node scripts/visual-publish-artifacts.mjs --validate-selection");
    expect(
      WORKFLOW.match(/if: \$\{\{ contains\(fromJSON\(inputs\.capture-shards\), [1-8]\) \}\}/gu),
    ).toHaveLength(8);
    expect(WORKFLOW.match(/name: visual-screenshots-[1-8]/gu)).toHaveLength(8);
    expect(WORKFLOW).toContain(
      "VISUAL_FILL_FROM_EXPECTED: ${{ inputs.capture-mode == 'affected' || inputs.capture-mode == 'light' }}",
    );
    expect(WORKFLOW).toContain('VISUAL_VERIFY_COMPLETE: "true"');
    const sanitizeAt = PREPARE.indexOf("node scripts/visual-publish-artifacts.mjs");
    const baselineAt = PREPARE.indexOf("node scripts/visual-prepare-baseline.mjs");
    const compareAt = PREPARE.indexOf("run: pnpm visual:compare");
    const inventoryAt = PREPARE.indexOf(
      "node scripts/visual-publish-artifacts.mjs --verify-complete",
    );
    const bundleAt = PREPARE.indexOf("node scripts/visual-build-publish-bundle.mjs");
    const uploadArtifactAt = PREPARE.indexOf("name: reg-suit-publish-bundle");
    const assumeAt = PUBLISH.indexOf("name: Assume the reg-suit publisher role");
    const putAt = PUBLISH.indexOf("aws s3api put-object");
    expect(sanitizeAt).toBeGreaterThanOrEqual(0);
    expect(baselineAt).toBeGreaterThan(sanitizeAt);
    expect(compareAt).toBeGreaterThan(baselineAt);
    expect(inventoryAt).toBeGreaterThan(compareAt);
    expect(bundleAt).toBeGreaterThan(compareAt);
    expect(uploadArtifactAt).toBeGreaterThan(bundleAt);
    expect(assumeAt).toBeGreaterThanOrEqual(0);
    expect(putAt).toBeGreaterThan(assumeAt);
    expect(PREPARE).toContain('VISUAL_EXPECTED_READY: "true"');
    expect(PREPARE).toContain('REG_SUIT_COMPARE_ONLY: "true"');
    expect(PUBLISH).toContain("REG_ACTUAL_KEY: ${{ needs.prepare.outputs.actual_key }}");
    expect(PUBLISH).toContain("--content-encoding gzip");
    expect(PUBLISH).toContain('--key "$REG_ACTUAL_KEY/$object_path"');
    expect(PUBLISH).not.toMatch(
      /actions\/checkout|pnpm|node scripts|visual:compare|run:\s*reg-suit (?:run|publish)/u,
    );
    expect(PUBLISH.slice(assumeAt)).not.toMatch(/^\s+- uses:/mu);
  });

  it("refuses to overwrite a snapshot owned by main or another PR", () => {
    expect(PUBLISH).toContain("aws s3api head-object");
    expect(PUBLISH).toContain('Metadata."diveday-pr-number"');
    expect(PUBLISH).toContain('Metadata."diveday-sha256"');
    expect(PUBLISH).toContain('Metadata."diveday-size"');
    expect(PUBLISH).toContain("404|Not Found|NoSuchKey");
    expect(PUBLISH).toContain(
      '--metadata "diveday-sha256=$payload_sha256,diveday-size=$payload_size,diveday-pr-number=$PR_NUMBER"',
    );
    expect(PUBLISH).toContain('cat "$head_error" >&2');
  });

  it("validates the full upload manifest before publishing with bounded concurrency", () => {
    const manifestValidationAt = PUBLISH.indexOf('done < "$manifest"');
    const uploadAt = PUBLISH.indexOf('xargs -r -P "$publish_parallelism" -n 4 bash -c');
    const publishAt = PUBLISH.indexOf("aws s3api put-object");
    const markerAt = PUBLISH.lastIndexOf("publish_object");

    expect(PUBLISH).toContain('validated_manifest="$RUNNER_TEMP/reg-suit-manifest.validated.tsv"');
    expect(PUBLISH).toContain('payload_manifest="$RUNNER_TEMP/reg-suit-manifest.payload.tsv"');
    expect(PUBLISH).toContain('integrity_manifest="$RUNNER_TEMP/reg-suit-manifest.integrity.tsv"');
    expect(PUBLISH).toContain('sha256sum "$payload"');
    expect(PUBLISH).toContain("ContentLength,ContentType,ContentEncoding");
    expect(PUBLISH).toContain("publish_parallelism=8");
    expect(PUBLISH).toContain('test "$marker_count" -eq 1');
    expect(PUBLISH).toContain('[[ "$object_path" == "out.json" ]]');
    expect(manifestValidationAt).toBeGreaterThanOrEqual(0);
    expect(uploadAt).toBeGreaterThan(manifestValidationAt);
    expect(publishAt).toBeGreaterThan(manifestValidationAt);
    expect(markerAt).toBeGreaterThan(uploadAt);
    expect(PUBLISH).toContain(`' _ < "$payload_manifest"`);
    expect(PUBLISH).toContain("cancel-in-progress: false");
    expect(PUBLISH).toContain("group: reg-suit-publish-${{ needs.prepare.outputs.actual_key }}");
    expect(PUBLISH.slice(0, manifestValidationAt)).not.toContain("aws s3api put-object");
  });

  it("publishes out.json only after every bounded asset upload succeeds", () => {
    const run = publisherFixture();
    try {
      expect(run.result.status).toBe(0);
      const puts = run.events.filter((event) => event.startsWith("PUT\t"));
      expect(puts.at(-1)).toMatch(
        new RegExp(
          `^PUT\\t${"a".repeat(40)}/out\\.json\\tdiveday-sha256=[0-9a-f]{64},diveday-size=[0-9]+,diveday-pr-number=3325$`,
        ),
      );
      expect(run.events.filter((event) => event.startsWith("DONE\t"))).toHaveLength(4);
      expect(run.events.at(-1)).toBe(`DONE\t${"a".repeat(40)}/out.json`);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it("publishes a main snapshot without PR ownership metadata", () => {
    const run = publisherFixture({ prNumber: "" });
    try {
      expect(run.result.status, run.result.stderr).toBe(0);
      const puts = run.events.filter((event) => event.startsWith("PUT\t"));
      expect(puts).toHaveLength(4);
      expect(
        puts.every((event) => /\tdiveday-sha256=[0-9a-f]{64},diveday-size=[0-9]+$/.test(event)),
      ).toBe(true);
      expect(puts.every((event) => !event.includes("diveday-pr-number"))).toBe(true);
      expect(puts.at(-1)).toMatch(
        new RegExp(
          `^PUT\\t${"a".repeat(40)}/out\\.json\\tdiveday-sha256=[0-9a-f]{64},diveday-size=[0-9]+$`,
        ),
      );
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it("does not publish out.json when any asset upload fails", () => {
    const key = `${"a".repeat(40)}/actual/two.png`;
    const run = publisherFixture({ failKey: key });
    try {
      expect(run.result.status).not.toBe(0);
      expect(run.events.filter((event) => event.startsWith("PUT\t"))).not.toContain(
        `PUT\t${"a".repeat(40)}/out.json`,
      );
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it("reuses a complete same-SHA snapshot after every object matches provenance metadata", () => {
    const run = publisherFixture({ existingSnapshot: true });
    try {
      expect(run.result.status, run.result.stderr).toBe(0);
      expect(run.result.stdout).toContain("provenance-verified");
      expect(run.events.filter((event) => event.startsWith("PUT\t"))).toHaveLength(0);
      expect(run.events.filter((event) => event.startsWith("HEAD\t"))).toHaveLength(5);
      expect(run.events[0]).toContain(
        '[ContentLength,ContentType,ContentEncoding,Metadata."diveday-sha256"',
      );
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["changed report", "changed-report", "3325", "3325"],
    ["changed asset", "changed-asset", "3325", "3325"],
    ["missing provenance metadata", "missing-metadata", "3325", "3325"],
    ["missing object", "missing-object", "3325", "3325"],
    ["changed size", "wrong-size", "3325", "3325"],
    ["changed content type", "wrong-type", "3325", "3325"],
    ["changed content encoding", "wrong-encoding", "3325", "3325"],
    ["different PR ownership", "exact", "3180", "3325"],
    ["PR to main ownership", "exact", "3325", ""],
    ["main to PR ownership", "exact", "None", "3325"],
  ])(
    "refuses existing snapshots with %s without uploading",
    (_label, existingMode, existingPr, prNumber) => {
      const run = publisherFixture({ existingSnapshot: true, existingMode, existingPr, prNumber });
      try {
        expect(run.result.status).not.toBe(0);
        expect(run.result.stdout).toContain("provenance mismatch");
        expect(run.events.filter((event) => event.startsWith("PUT\t"))).toHaveLength(0);
      } finally {
        rmSync(run.root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["missing marker", "actual/one.png\timage/png\n"],
    ["duplicate marker", "out.json\tapplication/json\nout.json\tapplication/json\n"],
    ["incorrect marker type", "out.json\ttext/plain\n"],
  ])("rejects a manifest with %s before any upload", (_label, manifestContent) => {
    const run = publisherFixture({ manifestContent });
    try {
      expect(run.result.status).not.toBe(0);
      expect(run.events.filter((event) => event.startsWith("PUT\t"))).toHaveLength(0);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  });
});
