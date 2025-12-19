import { promisify } from "node:util";
import * as zlib from "node:zlib";
import type { VirtualFileSystem } from "@engram/vfs";
import type { Rehydrator } from "./rehydrator";

const gzip = promisify(zlib.gzip);

export class TimeTravelService {
	constructor(private rehydrator: Rehydrator) {}

	async getFilesystemState(sessionId: string, targetTime: number): Promise<VirtualFileSystem> {
		return this.rehydrator.rehydrate(sessionId, targetTime);
	}

	async getZippedState(sessionId: string, targetTime: number): Promise<Buffer> {
		const vfs = await this.rehydrator.rehydrate(sessionId, targetTime);
		// Create a simple JSON dump for now as "Zip"
		// In a real implementation, we'd use a zip library like 'jszip' or 'archiver'
		// to create a downloadable archive of the VFS content.
		// For V1, returning the gzipped JSON state of the VFS root is sufficient for "State Reconstruction".
		const state = JSON.stringify(vfs.root);
		return gzip(state);
	}

	async listFiles(sessionId: string, targetTime: number, path = "/"): Promise<string[]> {
		const vfs = await this.rehydrator.rehydrate(sessionId, targetTime);
		try {
			return vfs.readDir(path);
		} catch (_e) {
			return [];
		}
	}
}
