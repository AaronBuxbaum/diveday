#!/usr/bin/env node
// Canonical's existing Noble renderer, without apt indexes or system installation.
// Pins: packages.ubuntu.com/noble/amd64/poppler-utils/download and
// packages.ubuntu.com/noble-updates/amd64/libpoppler134/download (2026-11-11).
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const PDF_VERSION = "24.02.0-1ubuntu9.11";
export const PDF_PACKAGES = [
  {
    name: "libpoppler134",
    size: 1117982,
    sha256: "fb25ad9d2bf31bf67840b8516bedc1a9bfc8f70d319c3eb9d341f722668e0151",
  },
  {
    name: "poppler-utils",
    size: 211678,
    sha256: "babf881b89893f843701116f9f32917d19fa94dec337940b6dbeb27fe1a26fc8",
  },
].map((pkg) => ({ ...pkg, file: `${pkg.name}_${PDF_VERSION}_amd64.deb` }));

export function verifyArchive(bytes, pkg) {
  if (bytes.length !== pkg.size || createHash("sha256").update(bytes).digest("hex") !== pkg.sha256)
    throw new Error(`PDF tools: size/SHA256 mismatch for ${pkg.file}`);
}

function checked(run, binary, args, options = {}) {
  const result = run(binary, args, {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `PDF tools: ${binary} failed: ${result.stderr || result.error || result.status}`,
    );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function acquireArchive(pkg, directory, run = runBounded) {
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, pkg.file);
  if (existsSync(target)) {
    verifyArchive(readFileSync(target), pkg);
    return target;
  }
  const partial = `${target}.partial`;
  try {
    checked(run, "curl", [
      "--fail",
      "--location",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--connect-timeout",
      "15",
      "--max-time",
      "60",
      "--max-filesize",
      String(pkg.size),
      "--output",
      partial,
      `https://security.ubuntu.com/ubuntu/pool/main/p/poppler/${pkg.file}`,
    ]);
    verifyArchive(readFileSync(partial), pkg);
    renameSync(partial, target);
    return target;
  } finally {
    rmSync(partial, { force: true });
  }
}

export function smokePdf() {
  const stream = "BT /F1 12 Tf 10 50 Td (DiveDay PDF check) Tj ET\n10 10 20 20 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export function verifyPdfBehavior(bin, directory, run = runBounded) {
  const pdf = path.join(directory, "smoke.pdf");
  writeFileSync(pdf, smokePdf());
  const text = checked(run, path.join(bin, "pdftotext"), ["-layout", pdf, "-"]);
  if (text.replace(/\s+/gu, " ").trim() !== "DiveDay PDF check")
    throw new Error("PDF tools: text extraction smoke failed");
  const bbox = checked(run, path.join(bin, "pdftotext"), ["-bbox", pdf, "-"]);
  if (!/<word\s+xMin="[\d.]+"[^>]*>DiveDay<\/word>/u.test(bbox))
    throw new Error("PDF tools: bounding-box smoke failed");
  const png = path.join(directory, "smoke");
  checked(run, path.join(bin, "pdftoppm"), ["-png", "-singlefile", "-scale-to", "100", pdf, png]);
  const image = readFileSync(`${png}.png`);
  if (
    image.length < 24 ||
    image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    image.readUInt32BE(16) !== 100 ||
    image.readUInt32BE(20) !== 50
  )
    throw new Error("PDF tools: PNG rendering smoke failed");
}

export function installPdfTools({
  temp,
  githubPath,
  run = runBounded,
  acquire = acquireArchive,
  host = {
    platform: process.platform,
    arch: process.arch,
    release: process.platform === "linux" ? readFileSync("/etc/os-release", "utf8") : "",
  },
}) {
  if (
    host.platform !== "linux" ||
    host.arch !== "x64" ||
    !/^ID=ubuntu$/mu.test(host.release) ||
    !/^VERSION_ID="24\.04"$/mu.test(host.release)
  )
    throw new Error("PDF tools: pinned packages require Ubuntu 24.04 amd64");
  const archives = PDF_PACKAGES.map((pkg) =>
    acquire(pkg, path.join(temp, "diveday-poppler-archives"), run),
  );
  const root = path.join(temp, "diveday-poppler");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, "bin"), { recursive: true });
  for (const [index, archive] of archives.entries()) {
    const fields = checked(run, "dpkg-deb", ["-f", archive, "Package", "Version", "Architecture"]);
    if (
      fields.trim() !==
      `Package: ${PDF_PACKAGES[index].name}\nVersion: ${PDF_VERSION}\nArchitecture: amd64`
    )
      throw new Error("PDF tools: package control fields do not match the pinned package");
    checked(run, "dpkg-deb", ["-x", archive, root]);
  }
  for (const binary of ["pdftotext", "pdftoppm"]) {
    const wrapper = path.join(root, "bin", binary);
    writeFileSync(
      wrapper,
      `#!/bin/sh\nroot="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexport LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu"\nexec "$root/usr/bin/${binary}" "$@"\n`,
      { mode: 0o755 },
    );
    if (!checked(run, wrapper, ["-v"]).includes(`${binary} version 24.02.0`))
      throw new Error(`PDF tools: unexpected ${binary} version`);
  }
  const scratch = mkdtempSync(path.join(temp, "diveday-pdf-smoke-"));
  try {
    verifyPdfBehavior(path.join(root, "bin"), scratch, run);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (githubPath) appendFileSync(githubPath, `${path.join(root, "bin")}\n`);
  console.log(
    `PDF tools: verified Ubuntu ${PDF_VERSION}; text, bounding boxes and PNG smoke passed`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.RUNNER_TEMP) throw new Error("PDF tools: RUNNER_TEMP is required");
  installPdfTools({ temp: process.env.RUNNER_TEMP, githubPath: process.env.GITHUB_PATH });
}
