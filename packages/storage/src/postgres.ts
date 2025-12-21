import pg from "pg";

const { Pool } = pg;

export interface PostgresClientOptions {
	url: string;
}

/**
 * PostgreSQL client wrapper
 *
 * Provides connection pooling and query execution for Postgres databases.
 */
export class PostgresClient {
	private pool: pg.Pool;
	private connected = false;

	constructor(options: PostgresClientOptions) {
		this.pool = new Pool({
			connectionString: options.url,
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		});
	}

	/**
	 * Connect to the database
	 */
	async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		// Test connection with actual query to validate health
		const client = await this.pool.connect();
		try {
			await client.query("SELECT 1");
			this.connected = true;
		} finally {
			client.release();
		}
	}

	/**
	 * Disconnect from the database
	 */
	async disconnect(): Promise<void> {
		if (!this.connected) {
			return;
		}

		await this.pool.end();
		this.connected = false;
	}

	/**
	 * Execute a query
	 */
	async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
		text: string,
		params?: unknown[],
	): Promise<pg.QueryResult<T>> {
		if (!this.connected) {
			throw new Error("PostgresClient is not connected");
		}

		return this.pool.query<T>(text, params);
	}

	/**
	 * Execute a query and return a single row
	 */
	async queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
		text: string,
		params?: unknown[],
	): Promise<T | null> {
		const result = await this.query<T>(text, params);
		return result.rows[0] ?? null;
	}

	/**
	 * Execute a query and return all rows
	 */
	async queryMany<T extends pg.QueryResultRow = pg.QueryResultRow>(
		text: string,
		params?: unknown[],
	): Promise<T[]> {
		const result = await this.query<T>(text, params);
		return result.rows;
	}

	/**
	 * Execute a transaction
	 */
	async transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
		if (!this.connected) {
			throw new Error("PostgresClient is not connected");
		}

		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const result = await callback(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Verify connection health by executing a test query
	 */
	async healthCheck(): Promise<boolean> {
		if (!this.connected) {
			return false;
		}

		try {
			const client = await this.pool.connect();
			try {
				await client.query("SELECT 1");
				return true;
			} finally {
				client.release();
			}
		} catch {
			this.connected = false;
			return false;
		}
	}
}
