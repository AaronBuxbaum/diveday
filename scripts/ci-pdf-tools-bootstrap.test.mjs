import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireArchive,
  installPdfTools,
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
  file: "fixture.deb",
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

  it.each(["identity", "missing library", "wrong version", "smoke"])(
    "keeps GITHUB_PATH unchanged after %s failure",
    (failure) => {
      const temp = temporary();
      const githubPath = path.join(temp, "github-path");
      writeFileSync(githubPath, "original\n");
      const acquire = (pkg) => pkg.file;
      const run = (binary, args) => {
        if (binary === "dpkg-deb" && args[0] === "-f") {
          const name = args[1].split("_")[0];
          return {
            status: 0,
            stdout: `Package: ${name}\nVersion: ${PDF_VERSION}\nArchitecture: ${failure === "identity" ? "arm64" : "amd64"}\n`,
          };
        }
        if (binary === "dpkg-deb") return { status: 0 };
        if (failure === "missing library") return { status: 127, stderr: "libpoppler not found" };
        if (args[0] === "-v")
          return {
            status: 0,
            stderr: `${path.basename(binary)} version ${failure === "wrong version" ? "26.11.0" : "24.02.0"}\n`,
          };
        return { status: 0, stdout: "wrong extracted text" };
      };
      expect(() => installPdfTools({ temp, githubPath, host, acquire, run })).toThrow();
      expect(readFileSync(githubPath, "utf8")).toBe("original\n");
    },
  );

  it("refuses an unsupported host before acquiring packages", () => {
    const acquire = vi.fn();
    expect(() =>
      installPdfTools({ temp: temporary(), host: { ...host, arch: "arm64" }, acquire }),
    ).toThrow("Ubuntu 24.04 amd64");
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe("verified PDF package acquisition", () => {
  it("pins the same Ubuntu release and complete SHA256 digests for both packages", () => {
    expect(PDF_PACKAGES.map((p) => p.name)).toEqual(["libpoppler134", "poppler-utils"]);
    for (const p of PDF_PACKAGES) {
      expect(p.file).toBe(`${p.name}_${PDF_VERSION}_amd64.deb`);
      expect(p.sha256).toMatch(/^[a-f0-9]{64}$/u);
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
      expect(args.at(-1)).toBe(
        "https://security.ubuntu.com/ubuntu/pool/main/p/poppler/fixture.deb",
      );
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
