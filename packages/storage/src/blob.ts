import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ErrorCodes, StorageError } from "@engram/common";
import type { BlobStore } from "./interfaces";

// Re-export the interface for backward compatibility
export type { BlobStore } from "./interfaces";

export class FileSystemBlobStore implements BlobStore {
	private basePath: string;

	constructor(basePath: string) {
		this.basePath = basePath;
	}

	async save(content: string | Buffer): Promise<string> {
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(content);
		const hash = hasher.digest("hex");
		const filePath = path.join(this.basePath, hash);
		// Ensure directory exists
		await fs.mkdir(this.basePath, { recursive: true });
		await fs.writeFile(filePath, content, "utf-8");
		return `file://${filePath}`;
	}

	async load(uri: string): Promise<string> {
		if (!uri.startsWith("file://")) {
			throw new Error(`Invalid URI scheme for FileSystemBlobStore: ${uri}`);
		}

		// Extract and decode the file path from URI
		let filePath = uri.slice(7); // Remove 'file://'
		filePath = decodeURIComponent(filePath);

		// Get just the filename (should be a SHA-256 hash)
		const filename = path.basename(filePath);

		// Validate filename format (must be a 64-character hex string)
		if (!/^[a-f0-9]{64}$/.test(filename)) {
			throw new StorageError(
				`Invalid blob filename format: ${filename}`,
				ErrorCodes.STORAGE_INVALID_PATH,
				uri,
				undefined,
				"read",
			);
		}

		// Additional path traversal prevention: check for any path separators in filename
		// istanbul ignore next - Defense in depth: unreachable as regex already validates hex-only
		if (filename.includes("/") || filename.includes("\\") || filename.includes(path.sep)) {
			throw new StorageError(
				`Path traversal characters detected in filename: ${filename}`,
				ErrorCodes.STORAGE_INVALID_PATH,
				uri,
				undefined,
				"read",
			);
		}

		// Construct safe path using only the validated filename
		const safePath = path.join(this.basePath, filename);
		const resolvedPath = path.resolve(safePath);
		const resolvedBase = path.resolve(this.basePath);

		// Ensure the resolved path is exactly basePath/filename (defense in depth)
		const expectedPath = path.join(resolvedBase, filename);
		// istanbul ignore next - Defense in depth: path.basename + regex validation makes this unreachable
		if (resolvedPath !== expectedPath) {
			throw new StorageError(
				`Path traversal detected in URI: ${uri}`,
				ErrorCodes.STORAGE_INVALID_PATH,
				uri,
				undefined,
				"read",
			);
		}

		return fs.readFile(resolvedPath, "utf-8");
	}
}

export class GCSBlobStore implements BlobStore {
	private bucket: string;
	private storage: unknown; // Lazy loaded @google-cloud/storage client

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	/**
	 * Lazily initialize the Google Cloud Storage client.
	 * Uses Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS env var.
	 */
	private async getStorage() {
		if (!this.storage) {
			// Dynamic import to avoid bundling issues and make GCS optional
			const { Storage } = await import("@google-cloud/storage");
			this.storage = new Storage();
		}
		return this.storage as {
			bucket: (name: string) => {
				file: (name: string) => {
					save: (content: string, options?: { contentType?: string }) => Promise<void>;
					download: () => Promise<[Buffer]>;
					exists: () => Promise<[boolean]>;
				};
			};
		};
	}

	async save(content: string | Buffer): Promise<string> {
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(content);
		const hash = hasher.digest("hex");
		const fileName = hash;
		const contentStr = typeof content === "string" ? content : content.toString("utf-8");
		const uri = `gs://${this.bucket}/${fileName}`;

		try {
			const storage = await this.getStorage();
			const bucket = storage.bucket(this.bucket);
			const file = bucket.file(fileName);

			await file.save(contentStr, {
				contentType: "application/json",
			});

			return uri;
		} catch (error) {
			// Throw StorageError instead of returning stub URI - silent failures are dangerous
			const cause = error instanceof Error ? error : undefined;
			throw new StorageError(
				`Failed to upload blob to GCS: ${cause?.message || "unknown error"}`,
				ErrorCodes.STORAGE_WRITE_FAILED,
				uri,
				cause,
				"write",
			);
		}
	}

	async load(uri: string): Promise<string> {
		if (!uri.startsWith("gs://")) {
			throw new Error(`Invalid URI scheme for GCSBlobStore: ${uri}`);
		}

		// Parse gs://bucket/filename
		const withoutScheme = uri.slice(5); // Remove 'gs://'
		const slashIndex = withoutScheme.indexOf("/");
		if (slashIndex === -1) {
			throw new Error(`Invalid GCS URI format: ${uri}`);
		}
		const bucketName = withoutScheme.slice(0, slashIndex);
		const fileName = withoutScheme.slice(slashIndex + 1);

		try {
			const storage = await this.getStorage();
			const bucket = storage.bucket(bucketName);
			const file = bucket.file(fileName);

			const [exists] = await file.exists();
			if (!exists) {
				throw new StorageError(
					`Blob not found: ${uri}`,
					ErrorCodes.STORAGE_NOT_FOUND,
					uri,
					undefined,
					"read",
				);
			}

			const [contents] = await file.download();
			return contents.toString("utf-8");
		} catch (error) {
			// Re-throw StorageErrors as-is
			if (error instanceof StorageError) {
				throw error;
			}
			// Throw StorageError instead of returning empty string - silent failures are dangerous
			const cause = error instanceof Error ? error : undefined;
			throw new StorageError(
				`Failed to read blob from GCS: ${cause?.message || "unknown error"}`,
				ErrorCodes.STORAGE_READ_FAILED,
				uri,
				cause,
				"read",
			);
		}
	}
}

export const createBlobStore = (type: "fs" | "gcs" = "fs"): BlobStore => {
	if (type === "gcs") {
		return new GCSBlobStore(process.env.GCS_BUCKET || "engram-blobs");
	}
	return new FileSystemBlobStore(process.env.BLOB_STORAGE_PATH || "./data/blobs");
};
