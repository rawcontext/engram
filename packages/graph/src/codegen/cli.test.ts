import { describe, expect, test } from "bun:test";
import path from "node:path";

// Note: The CLI is an executable script, so we test it by spawning a subprocess.
// The CLI file path is relative to the monorepo root.

// Get the monorepo root (packages/graph/src/codegen -> packages/graph -> packages -> root)
const cliPath = path.resolve(import.meta.dir, "cli.ts");

describe("cli", () => {
	describe("help and version flags", () => {
		test("--help exits with code 0", async () => {
			const proc = Bun.spawn(["bun", "run", cliPath, "--help"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Engram Schema Code Generator");
			expect(stdout).toContain("--dry-run");
			expect(stdout).toContain("--output");
		});

		test("-h is alias for --help", async () => {
			const proc = Bun.spawn(["bun", "run", cliPath, "-h"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Engram Schema Code Generator");
		});

		test("--version shows version", async () => {
			const proc = Bun.spawn(["bun", "run", cliPath, "--version"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("engram-codegen v");
		});

		test("-v is alias for --version", async () => {
			const proc = Bun.spawn(["bun", "run", cliPath, "-v"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await proc.exited;
			const stdout = await new Response(proc.stdout).text();

			expect(exitCode).toBe(0);
			expect(stdout).toContain("engram-codegen v");
		});
	});

	describe("quiet mode", () => {
		test("--quiet with --dry-run suppresses output", async () => {
			const proc = Bun.spawn(["bun", "run", cliPath, "--quiet", "--dry-run"], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdout = await new Response(proc.stdout).text();

			// In quiet mode, there should be minimal or no output
			expect(stdout.length).toBeLessThan(50);
		});
	});
});
