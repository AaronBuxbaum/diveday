import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireArchive,
  installPdfTools,
  MICROMAMBA,
  PDF_PACKAGES,
  PDF_VERSION,
  smokePdf,
  verifyArchive,
  verifyPdfBehavior,
} from "./ci-pdf-tools.mjs";

const directories = [];
const temporary = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pdf-bootstrap-test-"));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const bytes = Buffer.from("an archive fixture");
const pkg = {
  file: "fixture.conda",
  url: "https://conda.anaconda.org/conda-forge/linux-64/fixture.conda",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

describe("installation publishes tools only after verification", () => {
  const host = { platform: "linux", arch: "x64", release: 'ID=ubuntu\nVERSION_ID="24.04"\n' };

  it("a corrupt restored archive never reaches extraction or GITHUB_PATH", () => {
    const temp = temporary();
    const githubPath = path.join(temp, "github-path");
    writeFileSync(githubPath, "original\n");
    const acquire = () => {
      throw new Error("PDF tools: size/SHA256 mismatch");
    };
    const run = vi.fn();
    expect(() => installPdfTools({ temp, githubPath, host, acquire, run })).toThrow(
      "SHA256 mismatch",
    );
    expect(run).not.toHaveBeenCalled();
    expect(readFileSync(githubPath, "utf8")).toBe("original\n");
  });

  it.each([
    "installer version",
    "install",
    "identity",
    "missing library",
    "wrong version",
    "smoke",
  ])("keeps GITHUB_PATH unchanged after %s failure", (failure) => {
    const temp = temporary();
    const githubPath = path.join(temp, "github-path");
    writeFileSync(githubPath, "original\n");
    const acquire = (pkg) => {
      const file = path.join(temp, pkg.file);
      writeFileSync(file, "fixture");
      return file;
    };
    const run = (binary, args, options) => {
      if (binary.endsWith(MICROMAMBA.file)) {
        if (args[0] === "--version")
          return {
            status: 0,
            stdout: failure === "installer version" ? "0.0.0" : MICROMAMBA.version,
          };
        expect(args).toContain("--offline");
        expect(args).toContain("--skip-run-link-scripts");
        expect(options.env.CONDA_PKGS_DIRS).toBe(path.join(temp, "diveday-poppler", "packages"));
        if (failure === "install") return { status: 1, stderr: "archive extraction failed" };
        const prefix = args[args.indexOf("--prefix") + 1];
        mkdirSync(path.join(prefix, "conda-meta"), { recursive: true });
        for (const pkg of PDF_PACKAGES) {
          const build = pkg.file.replace(/\.(conda|tar\.bz2)$/u, "");
          writeFileSync(
            path.join(prefix, "conda-meta", `${build}.json`),
            JSON.stringify({
              name: pkg.name,
              version: pkg.version,
              sha256: failure === "identity" ? "wrong" : pkg.sha256,
            }),
          );
        }
        return { status: 0 };
      }
      if (failure === "missing library") return { status: 127, stderr: "libpoppler not found" };
      if (args[0] === "-v")
        return {
          status: 0,
          stderr: `${path.basename(binary)} version ${failure === "wrong version" ? "24.02.0" : PDF_VERSION}\n`,
        };
      return { status: 0, stdout: "wrong extracted text" };
    };
    expect(() => installPdfTools({ temp, githubPath, host, acquire, run })).toThrow();
    expect(readFileSync(githubPath, "utf8")).toBe("original\n");
  });

  it("refuses an unsupported host before acquiring packages", () => {
    const acquire = vi.fn();
    expect(() =>
      installPdfTools({ temp: temporary(), host: { ...host, arch: "arm64" }, acquire }),
    ).toThrow("Ubuntu 24.04 amd64");
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe("verified PDF package acquisition", () => {
  it("locks the entire Linux package closure and the installer by publisher URL, size and SHA256", () => {
    expect(PDF_PACKAGES.find((p) => p.name === "poppler").version).toBe(PDF_VERSION);
    expect(new Set(PDF_PACKAGES.map((p) => p.name)).size).toBe(PDF_PACKAGES.length);
    for (const p of PDF_PACKAGES) {
      expect(p.url).toMatch(/^https:\/\/conda\.anaconda\.org\/conda-forge\/(linux-64|noarch)\//u);
      expect(new URL(p.url).pathname.split("/").at(-1)).toBe(p.file);
    }
    expect(MICROMAMBA.url).toMatch(
      /^https:\/\/github\.com\/mamba-org\/micromamba-releases\/releases\/download\//u,
    );
    for (const p of [...PDF_PACKAGES, MICROMAMBA]) {
      expect(p.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(p.size).toBeGreaterThan(0);
    }
  });
  it("rechecks a cached archive without network access", () => {
    const dir = temporary();
    writeFileSync(path.join(dir, pkg.file), bytes);
    const run = vi.fn();
    expect(acquireArchive(pkg, dir, run)).toBe(path.join(dir, pkg.file));
    expect(run).not.toHaveBeenCalled();
  });
  it("refuses a corrupt cache instead of extracting or silently trusting it", () => {
    const dir = temporary();
    writeFileSync(path.join(dir, pkg.file), Buffer.alloc(bytes.length));
    const run = vi.fn();
    expect(() => acquireArchive(pkg, dir, run)).toThrow("SHA256 mismatch");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects truncated and same-size substituted bytes", () => {
    expect(() => verifyArchive(bytes.subarray(1), pkg)).toThrow("size/SHA256");
    expect(() => verifyArchive(Buffer.alloc(bytes.length), pkg)).toThrow("size/SHA256");
  });
  it("publishes only a verified completed download and requires HTTPS", () => {
    const dir = temporary();
    const run = vi.fn((binary, args, options) => {
      expect(binary).toBe("curl");
      expect(args).toContain("=https");
      expect(args).toContain("--proto-redir");
      expect(args).toContain("--max-filesize");
      expect(args.at(-1)).toBe(pkg.url);
      expect(options.timeoutMs).toBeGreaterThan(0);
      writeFileSync(args[args.indexOf("--output") + 1], bytes);
      return { status: 0 };
    });
    expect(readFileSync(acquireArchive(pkg, dir, run))).toEqual(bytes);
    expect(existsSync(path.join(dir, `${pkg.file}.partial`))).toBe(false);
  });
  it.each(["network", "checksum"])("a %s failure never leaves a usable cache entry", (failure) => {
    const dir = temporary();
    const run = (_binary, args) => {
      writeFileSync(args[args.indexOf("--output") + 1], Buffer.alloc(bytes.length));
      return { status: failure === "network" ? 6 : 0, stderr: failure };
    };
    expect(() => acquireArchive(pkg, dir, run)).toThrow();
    expect(existsSync(path.join(dir, pkg.file))).toBe(false);
    expect(existsSync(path.join(dir, `${pkg.file}.partial`))).toBe(false);
  });
});

describe("actual PDF behavior gate", () => {
  it("writes a PDF with an accurate xref position", () => {
    const pdf = smokePdf();
    expect(pdf).toContain("(DiveDay PDF check)");
    const offset = Number(pdf.match(/startxref\n(\d+)/u)[1]);
    expect(pdf.slice(offset)).toMatch(/^xref\n/u);
  });
  it.each(["missing library", "wrong text", "missing boxes", "invalid PNG"])(
    "refuses %s",
    (failure) => {
      const run = (binary, args) => {
        if (failure === "missing library") return { status: 127, stderr: "libpoppler not found" };
        if (args[0] === "-layout")
          return { status: 0, stdout: failure === "wrong text" ? "" : "DiveDay PDF check\n\f" };
        if (args[0] === "-bbox")
          return {
            status: 0,
            stdout: failure === "missing boxes" ? "" : '<word xMin="10">DiveDay</word>',
          };
        expect(binary).toContain("pdftoppm");
        writeFileSync(`${args.at(-1)}.png`, "not a PNG");
        return { status: 0 };
      };
      expect(() => verifyPdfBehavior("/fixture/bin", temporary(), run)).toThrow();
    },
  );
});
