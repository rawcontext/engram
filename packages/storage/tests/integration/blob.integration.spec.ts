/**
 * Integration tests for Blob Store.
 *
 * Tests FileSystemBlobStore against the local filesystem.
 * GCS tests require credentials and are skipped unless GCS_TEST_BUCKET is set.
 *
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/storage/tests/integration/blob.integration.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createBlobStore, FileSystemBlobStore, GCSBlobStore } from "../../src/blob";
import { shouldRunIntegrationTests } from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();
const hasGcsCredentials = !!process.env.GCS_TEST_BUCKET;

describe.skipIf(!runTests)("FileSystemBlobStore Integration", () => {
	const testBasePath = path.join(process.cwd(), "test-blobs-integration");
	let store: FileSystemBlobStore;

	beforeAll(async () => {
		// Ensure clean test directory
		try {
			await fs.rm(testBasePath, { recursive: true });
		} catch {
			// Directory may not exist
		}
		await fs.mkdir(testBasePath, { recursive: true });
		store = new FileSystemBlobStore(testBasePath);
	});

	afterAll(async () => {
		// Cleanup test directory
		try {
			await fs.rm(testBasePath, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("save", () => {
		it("should save string content", async () => {
			const content = "Hello, World!";
			const uri = await store.save(content);

			expect(uri).toStartWith("file://");
			expect(uri).toContain(testBasePath);
		});

		it("should save Buffer content", async () => {
			const content = Buffer.from("Binary content here");
			const uri = await store.save(content);

			expect(uri).toStartWith("file://");
		});

		it("should generate content-addressable URIs (same content = same URI)", async () => {
			const content = "Deterministic content";
			const uri1 = await store.save(content);
			const uri2 = await store.save(content);

			expect(uri1).toBe(uri2);
		});

		it("should generate different URIs for different content", async () => {
			const uri1 = await store.save("Content A");
			const uri2 = await store.save("Content B");

			expect(uri1).not.toBe(uri2);
		});

		it("should save JSON content", async () => {
			const jsonContent = JSON.stringify({ key: "value", nested: { a: 1 } });
			const uri = await store.save(jsonContent);

			expect(uri).toStartWith("file://");

			// Verify content can be read back
			const loaded = await store.load(uri);
			expect(JSON.parse(loaded)).toEqual({ key: "value", nested: { a: 1 } });
		});

		it("should save large content", async () => {
			const largeContent = "x".repeat(1024 * 1024); // 1MB
			const uri = await store.save(largeContent);

			expect(uri).toStartWith("file://");

			const loaded = await store.load(uri);
			expect(loaded.length).toBe(1024 * 1024);
		});
	});

	describe("load", () => {
		it("should load saved content", async () => {
			const content = "Test content for loading";
			const uri = await store.save(content);

			const loaded = await store.load(uri);
			expect(loaded).toBe(content);
		});

		it("should load Buffer content as string", async () => {
			const content = Buffer.from("Buffer test content");
			const uri = await store.save(content);

			const loaded = await store.load(uri);
			expect(loaded).toBe("Buffer test content");
		});

		it("should throw for invalid URI scheme", async () => {
			await expect(store.load("gs://bucket/file")).rejects.toThrow(
				"Invalid URI scheme for FileSystemBlobStore",
			);
		});

		it("should throw for nonexistent file", async () => {
			const fakeHash = "a".repeat(64);
			const uri = `file://${testBasePath}/${fakeHash}`;

			await expect(store.load(uri)).rejects.toThrow();
		});

		it("should throw for path traversal attempts", async () => {
			// Attempt to escape the base directory
			const maliciousUri = `file://${testBasePath}/../../../etc/passwd`;

			await expect(store.load(maliciousUri)).rejects.toThrow("Invalid blob filename format");
		});

		it("should throw for non-hash filenames", async () => {
			const invalidUri = `file://${testBasePath}/not-a-valid-hash`;

			await expect(store.load(invalidUri)).rejects.toThrow("Invalid blob filename format");
		});
	});

	describe("round-trip", () => {
		it("should preserve content through save/load cycle", async () => {
			const testCases = [
				"Simple string",
				"String with\nnewlines\nand\ttabs",
				"String with \"quotes\" and 'apostrophes'",
				"Unicode: 你好世界 🌍 émojis",
				JSON.stringify({ complex: { nested: { data: [1, 2, 3] } } }),
			];

			for (const content of testCases) {
				const uri = await store.save(content);
				const loaded = await store.load(uri);
				expect(loaded).toBe(content);
			}
		});
	});
});

describe.skipIf(!runTests || !hasGcsCredentials)("GCSBlobStore Integration", () => {
	const testBucket = process.env.GCS_TEST_BUCKET!;
	let store: GCSBlobStore;

	beforeAll(() => {
		store = new GCSBlobStore(testBucket);
	});

	describe("save", () => {
		it("should save content to GCS", async () => {
			const content = `GCS test content ${Date.now()}`;
			const uri = await store.save(content);

			expect(uri).toStartWith(`gs://${testBucket}/`);
		});

		it("should generate content-addressable URIs", async () => {
			const content = "GCS deterministic content";
			const uri1 = await store.save(content);
			const uri2 = await store.save(content);

			expect(uri1).toBe(uri2);
		});
	});

	describe("load", () => {
		it("should load saved content from GCS", async () => {
			const content = `GCS load test ${Date.now()}`;
			const uri = await store.save(content);

			const loaded = await store.load(uri);
			expect(loaded).toBe(content);
		});

		it("should throw for invalid URI scheme", async () => {
			await expect(store.load("file:///path/to/file")).rejects.toThrow(
				"Invalid URI scheme for GCSBlobStore",
			);
		});

		it("should throw for nonexistent blob", async () => {
			const fakeUri = `gs://${testBucket}/nonexistent-blob-${Date.now()}`;

			await expect(store.load(fakeUri)).rejects.toThrow("Blob not found");
		});
	});
});

describe.skipIf(!runTests)("createBlobStore Factory", () => {
	it("should create FileSystemBlobStore by default", () => {
		const store = createBlobStore();
		expect(store).toBeInstanceOf(FileSystemBlobStore);
	});

	it("should create FileSystemBlobStore when type is 'fs'", () => {
		const store = createBlobStore("fs");
		expect(store).toBeInstanceOf(FileSystemBlobStore);
	});

	it("should create GCSBlobStore when type is 'gcs'", () => {
		const store = createBlobStore("gcs");
		expect(store).toBeInstanceOf(GCSBlobStore);
	});
});
