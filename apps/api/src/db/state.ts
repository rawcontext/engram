import type { PostgresClient } from "@engram/storage";

export interface TofuState {
	id: string;
	state: Record<string, unknown>;
	lockId: string | null;
	lockInfo: LockInfo | null;
	lockedAt: Date | null;
	serial: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface LockInfo {
	ID: string;
	Operation: string;
	Info: string;
	Who: string;
	Version: string;
	Created: string;
	Path: string;
}

interface DbTofuState {
	id: string;
	state: Record<string, unknown>;
	lock_id: string | null;
	lock_info: LockInfo | null;
	locked_at: Date | null;
	serial: number;
	created_at: Date;
	updated_at: Date;
}

/**
 * Repository for OpenTofu state operations
 * Implements HTTP backend protocol for remote state storage
 */
export class StateRepository {
	constructor(private readonly db: PostgresClient) {}

	/**
	 * Get state by ID
	 */
	async get(id: string): Promise<TofuState | null> {
		const row = await this.db.queryOne<DbTofuState>(
			`SELECT id, state, lock_id, lock_info, locked_at, serial, created_at, updated_at
			 FROM tofu_state WHERE id = $1`,
			[id],
		);

		return row ? this.mapFromDb(row) : null;
	}

	/**
	 * Create or update state
	 */
	async put(id: string, state: Record<string, unknown>): Promise<TofuState> {
		const row = await this.db.queryOne<DbTofuState>(
			`INSERT INTO tofu_state (id, state, serial)
			 VALUES ($1, $2, 1)
			 ON CONFLICT (id) DO UPDATE SET
				state = $2,
				serial = tofu_state.serial + 1
			 RETURNING id, state, lock_id, lock_info, locked_at, serial, created_at, updated_at`,
			[id, JSON.stringify(state)],
		);

		if (!row) {
			throw new Error("Failed to save state");
		}

		return this.mapFromDb(row);
	}

	/**
	 * Delete state
	 */
	async delete(id: string): Promise<void> {
		await this.db.query(`DELETE FROM tofu_state WHERE id = $1`, [id]);
	}

	/**
	 * Acquire lock on state
	 * Returns true if lock acquired, false if already locked by another
	 */
	async lock(
		id: string,
		lockInfo: LockInfo,
	): Promise<{ success: boolean; existingLock?: LockInfo }> {
		// First check if state exists
		const existing = await this.get(id);

		if (!existing) {
			// Create empty state with lock
			await this.db.query(
				`INSERT INTO tofu_state (id, state, lock_id, lock_info, locked_at)
				 VALUES ($1, '{}', $2, $3, NOW())
				 ON CONFLICT (id) DO NOTHING`,
				[id, lockInfo.ID, JSON.stringify(lockInfo)],
			);
		}

		// Try to acquire lock (only if unlocked or we own it)
		const result = await this.db.queryOne<DbTofuState>(
			`UPDATE tofu_state
			 SET lock_id = $2, lock_info = $3, locked_at = NOW()
			 WHERE id = $1 AND (lock_id IS NULL OR lock_id = $2)
			 RETURNING id, state, lock_id, lock_info, locked_at, serial, created_at, updated_at`,
			[id, lockInfo.ID, JSON.stringify(lockInfo)],
		);

		if (result) {
			return { success: true };
		}

		// Lock failed - get current lock info
		const current = await this.get(id);
		return {
			success: false,
			existingLock: current?.lockInfo ?? undefined,
		};
	}

	/**
	 * Release lock on state
	 */
	async unlock(id: string, lockId: string): Promise<{ success: boolean; existingLock?: LockInfo }> {
		const result = await this.db.queryOne<DbTofuState>(
			`UPDATE tofu_state
			 SET lock_id = NULL, lock_info = NULL, locked_at = NULL
			 WHERE id = $1 AND lock_id = $2
			 RETURNING id, state, lock_id, lock_info, locked_at, serial, created_at, updated_at`,
			[id, lockId],
		);

		if (result) {
			return { success: true };
		}

		// Unlock failed - get current lock info
		const current = await this.get(id);
		if (!current?.lockId) {
			// No lock exists, consider it a success
			return { success: true };
		}

		return {
			success: false,
			existingLock: current.lockInfo ?? undefined,
		};
	}

	/**
	 * Force unlock (admin operation)
	 */
	async forceUnlock(id: string): Promise<void> {
		await this.db.query(
			`UPDATE tofu_state SET lock_id = NULL, lock_info = NULL, locked_at = NULL WHERE id = $1`,
			[id],
		);
	}

	private mapFromDb(row: DbTofuState): TofuState {
		return {
			id: row.id,
			state: row.state,
			lockId: row.lock_id,
			lockInfo: row.lock_info,
			lockedAt: row.locked_at,
			serial: row.serial,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
