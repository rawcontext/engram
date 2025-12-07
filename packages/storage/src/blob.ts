import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface BlobStore {
  save(content: string): Promise<string>;
  read(uri: string): Promise<string>;
}

export class FileSystemBlobStore implements BlobStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async save(content: string): Promise<string> {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const filePath = path.join(this.basePath, hash);
    // Ensure directory exists
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return `file://${filePath}`;
  }

  async read(uri: string): Promise<string> {
    if (!uri.startsWith('file://')) {
      throw new Error(`Invalid URI scheme for FileSystemBlobStore: ${uri}`);
    }
    const filePath = uri.slice(7); // Remove 'file://'
    return fs.readFile(filePath, 'utf-8');
  }
}

export class GCSBlobStore implements BlobStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async save(content: string): Promise<string> {
    // Stub implementation
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    console.log(`[GCS Stub] Uploading to gs://${this.bucket}/${hash}`);
    return `gs://${this.bucket}/${hash}`;
  }

  async read(uri: string): Promise<string> {
    // Stub implementation
    console.log(`[GCS Stub] Reading from ${uri}`);
    return "";
  }
}

export const createBlobStore = (type: 'fs' | 'gcs' = 'fs'): BlobStore => {
    if (type === 'gcs') {
        return new GCSBlobStore(process.env.GCS_BUCKET || 'soul-blobs');
    }
    return new FileSystemBlobStore(process.env.BLOB_STORAGE_PATH || './data/blobs');
};
