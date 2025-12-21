import * as fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlobStore, FileSystemBlobStore, GCSBlobStore } from "./blob";

// Mock functions for GCS operations
const mockSave = vi.fn();
const mockDownload = vi.fn();
const mockExists = vi.fn();
const mockFile = vi.fn(() => ({
	save: mockSave,
	download: mockDownload,
	exists: mockExists,
}));
const mockBucket = vi.fn(() => ({
	file: mockFile,
}));

// Mock the @google-cloud/storage module with a class
vi.mock("@google-cloud/storage", () => ({
	Storage: class MockStorage {
		bucket = mockBucket;
	},
}));

describe("Blob Storage", () => {
	const testDir = `/tmp/engram-blob-test-${Date.now()}`;

	afterEach(async () => {
		// Clean up test directory
		try {
			await fs.rm(testDir, { recursive: true });
		} catch {
			// Directory may not exist, ignore
		}
	});

	describe("FileSystemBlobStore", () => {
		it("should save content and return file URI", async () => {
			const store = new FileSystemBlobStore(testDir);
			const content = "Hello World";
			const uri = await store.save(content);

			expect(uri).toMatch(/^file:\/\//);
			expect(uri).toContain(testDir);
		});

		it("should generate deterministic hash-based filenames", async () => {
			const store = new FileSystemBlobStore(testDir);

			const uri1 = await store.save("same content");
			const uri2 = await store.save("same content");

			expect(uri1).toBe(uri2);
		});

		it("should generate different filenames for different content", async () => {
			const store = new FileSystemBlobStore(testDir);

			const uri1 = await store.save("content 1");
			const uri2 = await store.save("content 2");

			expect(uri1).not.toBe(uri2);
		});

		it("should load saved content", async () => {
			const store = new FileSystemBlobStore(testDir);
			const content = "hello world";

			const uri = await store.save(content);
			const readContent = await store.load(uri);

			expect(readContent).toBe(content);
		});

		it("should create directory if it does not exist", async () => {
			const nestedDir = `${testDir}/nested/dir`;
			const store = new FileSystemBlobStore(nestedDir);

			await store.save("content");

			const stat = await fs.stat(nestedDir);
			expect(stat.isDirectory()).toBe(true);
		});

		it("should throw on invalid URI scheme", async () => {
			const store = new FileSystemBlobStore(testDir);

			await expect(store.load("gs://bucket/hash")).rejects.toThrow("Invalid URI scheme");
		});

		it("should throw on non-existent file load", async () => {
			const store = new FileSystemBlobStore(testDir);

			await expect(store.load("file:///nonexistent/file")).rejects.toThrow();
		});

		it("should handle empty content", async () => {
			const store = new FileSystemBlobStore(testDir);

			const uri = await store.save("");
			const content = await store.load(uri);

			expect(content).toBe("");
		});

		it("should handle large content", async () => {
			const store = new FileSystemBlobStore(testDir);
			const largeContent = "x".repeat(100000);

			const uri = await store.save(largeContent);
			const content = await store.load(uri);

			expect(content).toBe(largeContent);
		});

		it("should handle unicode content", async () => {
			const store = new FileSystemBlobStore(testDir);
			const unicodeContent = "Hello World! Special chars";

			const uri = await store.save(unicodeContent);
			const content = await store.load(uri);

			expect(content).toBe(unicodeContent);
		});

		it("should handle JSON content", async () => {
			const store = new FileSystemBlobStore(testDir);
			const jsonContent = JSON.stringify({ key: "value", nested: { array: [1, 2, 3] } });

			const uri = await store.save(jsonContent);
			const content = await store.load(uri);

			expect(JSON.parse(content)).toEqual({ key: "value", nested: { array: [1, 2, 3] } });
		});

		it("should reject filenames with forward slashes", async () => {
			const store = new FileSystemBlobStore(testDir);

			// Try to load a URI with path traversal using forward slash in filename
			const maliciousUri = "file://abc/def";
			await expect(store.load(maliciousUri)).rejects.toThrow("Invalid blob filename format");
		});

		it("should reject filenames with backslashes", async () => {
			const store = new FileSystemBlobStore(testDir);

			// Try to load a URI with backslash
			const maliciousUri = "file://abc\\def";
			await expect(store.load(maliciousUri)).rejects.toThrow("Invalid blob filename format");
		});

		it("should handle Buffer input", async () => {
			const store = new FileSystemBlobStore(testDir);
			const buffer = Buffer.from("buffer content");

			const uri = await store.save(buffer);
			const content = await store.load(uri);

			expect(content).toBe("buffer content");
		});

		it("should reject filenames with platform-specific path separator", async () => {
			const store = new FileSystemBlobStore(testDir);
			const path = require("node:path");

			// Create a filename with platform path separator
			// This will be caught by the hash format validation on most platforms
			const maliciousUri = `file://abc${path.sep}def`;
			// Will throw either "Invalid blob filename format" or "Path traversal characters detected"
			await expect(store.load(maliciousUri)).rejects.toThrow();
		});

		it("should reject URIs with path traversal after validation", async () => {
			const store = new FileSystemBlobStore(testDir);

			// Valid hash format but would resolve outside basePath
			// This tests the defense-in-depth check at lines 67-74
			const uri = `file://${testDir}/0000000000000000000000000000000000000000000000000000000000000000`;

			// First save a valid file
			await store.save("test content");

			// Now try to load with manipulated path that still has valid hash format
			// The path resolution checks should catch this
			await expect(
				store.load(
					`file://${testDir}/../${testDir.split("/").pop()}/0000000000000000000000000000000000000000000000000000000000000000`,
				),
			).rejects.toThrow();
		});

		it("should handle URL-encoded paths correctly", async () => {
			const store = new FileSystemBlobStore(testDir);

			// Save content
			const uri = await store.save("test content");

			// Extract filename and URL-encode it
			const filename = uri.split("/").pop();
			const encodedUri = `file://${encodeURIComponent(testDir)}/${filename}`;

			// Should decode and load correctly
			const content = await store.load(encodedUri);
			expect(content).toBe("test content");
		});
	});

	describe("GCSBlobStore", () => {
		beforeEach(() => {
			vi.clearAllMocks();
			// Reset default mock implementations
			mockSave.mockResolvedValue(undefined);
			mockExists.mockResolvedValue([true]);
			mockDownload.mockResolvedValue([Buffer.from("test content")]);
		});

		it("should generate GCS URI on save", async () => {
			const store = new GCSBlobStore("test-bucket");

			const uri = await store.save("test content");

			expect(uri).toMatch(/^gs:\/\/test-bucket\/[a-f0-9]+$/);
			expect(mockSave).toHaveBeenCalledWith("test content", { contentType: "application/json" });
		});

		it("should generate deterministic hash-based filenames", async () => {
			const store = new GCSBlobStore("test-bucket");

			const uri1 = await store.save("same content");
			const uri2 = await store.save("same content");

			expect(uri1).toBe(uri2);
		});

		it("should throw on invalid URI scheme", async () => {
			const store = new GCSBlobStore("test-bucket");

			await expect(store.load("file:///local/file")).rejects.toThrow("Invalid URI scheme");
		});

		it("should throw on invalid GCS URI format", async () => {
			const store = new GCSBlobStore("test-bucket");

			await expect(store.load("gs://bucket-only")).rejects.toThrow("Invalid GCS URI format");
		});

		it("should throw StorageError on GCS load failure", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockExists.mockRejectedValueOnce(new Error("Network error"));

			await expect(store.load("gs://test-bucket/somefile")).rejects.toThrow(
				"Failed to read blob from GCS",
			);
		});

		it("should throw StorageError on GCS save failure", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockSave.mockRejectedValueOnce(new Error("Network error"));

			await expect(store.save("test content")).rejects.toThrow("Failed to upload blob to GCS");
		});

		it("should throw StorageError when blob not found", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockExists.mockResolvedValueOnce([false]);

			await expect(store.load("gs://test-bucket/somefile")).rejects.toThrow("Blob not found");
		});

		it("should load content successfully", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockExists.mockResolvedValueOnce([true]);
			mockDownload.mockResolvedValueOnce([Buffer.from("loaded content")]);

			const content = await store.load("gs://test-bucket/somefile");

			expect(content).toBe("loaded content");
		});

		it("should handle Buffer input for save", async () => {
			const store = new GCSBlobStore("test-bucket");
			const buffer = Buffer.from("buffer test content");

			const uri = await store.save(buffer);

			expect(uri).toMatch(/^gs:\/\/test-bucket\/[a-f0-9]+$/);
			expect(mockSave).toHaveBeenCalledWith("buffer test content", {
				contentType: "application/json",
			});
		});

		it("should re-throw StorageError from load without wrapping", async () => {
			const { StorageError, ErrorCodes } = await import("@engram/common");
			const store = new GCSBlobStore("test-bucket");

			const originalError = new StorageError(
				"Blob not found",
				ErrorCodes.STORAGE_NOT_FOUND,
				"gs://test-bucket/missing",
				undefined,
				"read",
			);

			mockExists.mockResolvedValueOnce([true]);
			mockDownload.mockRejectedValueOnce(originalError);

			// Should re-throw the StorageError without wrapping
			const error = await store.load("gs://test-bucket/missing").catch((e) => e);
			expect(error).toBeInstanceOf(StorageError);
			expect(error.message).toBe("Blob not found");
		});

		it("should wrap non-StorageError load failures", async () => {
			const store = new GCSBlobStore("test-bucket");
			const genericError = new Error("Network timeout");

			mockExists.mockResolvedValueOnce([true]);
			mockDownload.mockRejectedValueOnce(genericError);

			await expect(store.load("gs://test-bucket/somefile")).rejects.toThrow(
				"Failed to read blob from GCS",
			);
		});

		it("should handle save failure with non-Error cause", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockSave.mockRejectedValueOnce("String error");

			await expect(store.save("test")).rejects.toThrow("Failed to upload blob to GCS");
		});

		it("should handle load failure with non-Error cause", async () => {
			const store = new GCSBlobStore("test-bucket");
			mockExists.mockResolvedValueOnce([true]);
			mockDownload.mockRejectedValueOnce("String error");

			await expect(store.load("gs://test-bucket/file")).rejects.toThrow(
				"Failed to read blob from GCS",
			);
		});
	});

	describe("Factory", () => {
		it("should create FS store by default", () => {
			const store = createBlobStore();
			expect(store.save).toBeDefined();
			expect(store).toBeInstanceOf(FileSystemBlobStore);
		});

		it("should create FS store when type is fs", () => {
			const store = createBlobStore("fs");
			expect(store).toBeInstanceOf(FileSystemBlobStore);
		});

		it("should create GCS store when requested", () => {
			const store = createBlobStore("gcs");
			expect(store.save).toBeDefined();
			expect(store).toBeInstanceOf(GCSBlobStore);
		});
	});
});
