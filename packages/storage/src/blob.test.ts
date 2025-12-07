import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { FileSystemBlobStore, GCSBlobStore, createBlobStore } from "./blob";
import * as path from "node:path";

// Mock fs/promises
mock.module("node:fs/promises", () => ({
    mkdir: mock(async () => {}),
    writeFile: mock(async () => {}),
    readFile: mock(async () => "file content"),
}));

describe("Blob Storage", () => {
    describe("FileSystemBlobStore", () => {
        const store = new FileSystemBlobStore("/tmp/blobs");

        it("should save content and return file URI", async () => {
            const content = "Hello World";
            const uri = await store.save(content);
            
            expect(uri).toMatch(/^file:\/\/\/tmp\/blobs\/[a-f0-9]+$/);
            // Verify mock calls if needed?
        });

        it("should read content from file URI", async () => {
            const content = await store.read("file:///tmp/blobs/hash123");
            expect(content).toBe("file content");
        });

        it("should throw on invalid URI scheme", async () => {
            expect(store.read("gs://bucket/hash")).rejects.toThrow("Invalid URI scheme");
        });
    });

    describe("GCSBlobStore", () => {
        // Stub implementation tests
        const store = new GCSBlobStore("test-bucket");
        
        let originalLog: any;
        let mockLog: any;

        beforeEach(() => {
            originalLog = console.log;
            mockLog = mock(() => {});
            console.log = mockLog;
        });

        afterEach(() => {
            console.log = originalLog;
        });

        it("should log on save", async () => {
            const uri = await store.save("content");
            expect(uri).toMatch(/^gs:\/\/test-bucket\/[a-f0-9]+$/);
            expect(mockLog).toHaveBeenCalled();
        });

        it("should log on read", async () => {
            await store.read("gs://test-bucket/hash");
            expect(mockLog).toHaveBeenCalled();
        });
    });

    describe("Factory", () => {
        it("should create FS store by default", () => {
            const store = createBlobStore();
            expect(store.save).toBeFunction();
            expect((store as any).basePath).toBeDefined(); // Property specific to FileSystemBlobStore
        });

        it("should create GCS store when requested", () => {
            const store = createBlobStore("gcs");
            expect(store.save).toBeFunction();
            expect((store as any).bucket).toBeDefined(); // Property specific to GCSBlobStore
        });
    });
});
