import type { VirtualFileSystem } from "@engram/vfs";
import type { Rehydrator } from "./rehydrator";

export class TimeTravelService {
	constructor(private rehydrator: Rehydrator) {}

	async getFilesystemState(sessionId: string, targetTime: number): Promise<VirtualFileSystem> {
		return this.rehydrator.rehydrate(sessionId, targetTime);
	}

	async getZippedState(sessionId: string, targetTime: number): Promise<Buffer> {
		const vfs = await this.rehydrator.rehydrate(sessionId, targetTime);
		// Use VFS's built-in snapshot method which handles gzipping internally
		return vfs.createSnapshot();
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
