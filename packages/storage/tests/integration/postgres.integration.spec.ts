/**
 * Integration tests for PostgreSQL client.
 *
 * Tests PostgresClient against real PostgreSQL.
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/storage/tests/integration/postgres.integration.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PostgresClient } from "../../src/postgres";
import {
	createTestId,
	getPostgresUrl,
	shouldRunIntegrationTests,
	startPostgresContainer,
	stopAllContainers,
} from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("PostgresClient Integration", () => {
	let client: PostgresClient;
	const testTableName = `test_table_${Date.now()}`;

	beforeAll(async () => {
		await startPostgresContainer();
		const url = getPostgresUrl();
		client = new PostgresClient({ url });
		await client.connect();

		// Create test table
		await client.query(`
			CREATE TABLE IF NOT EXISTS ${testTableName} (
				id VARCHAR(255) PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				value INTEGER,
				created_at TIMESTAMP DEFAULT NOW()
			)
		`);
	});

	afterAll(async () => {
		if (client && client.isConnected()) {
			// Drop test table
			await client.query(`DROP TABLE IF EXISTS ${testTableName}`);
			await client.disconnect();
		}
		await stopAllContainers();
	});

	describe("Connection Lifecycle", () => {
		it("should connect successfully", async () => {
			expect(client.isConnected()).toBe(true);
		});

		it("should handle multiple connect calls", async () => {
			await client.connect();
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it("should report connection status correctly", () => {
			expect(client.isConnected()).toBe(true);
		});
	});

	describe("Query Operations", () => {
		it("should execute simple queries", async () => {
			const result = await client.query("SELECT 1 as num");
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].num).toBe(1);
		});

		it("should execute parameterized queries", async () => {
			const result = await client.query<{ sum: number }>(
				"SELECT $1::int + $2::int as sum",
				[10, 20],
			);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].sum).toBe(30);
		});

		it("should insert and query data", async () => {
			const testId = createTestId("row");

			// Insert
			await client.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
				testId,
				"Test Name",
				42,
			]);

			// Query
			const result = await client.query<{ id: string; name: string; value: number }>(
				`SELECT * FROM ${testTableName} WHERE id = $1`,
				[testId],
			);

			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].id).toBe(testId);
			expect(result.rows[0].name).toBe("Test Name");
			expect(result.rows[0].value).toBe(42);
		});

		it("should update data", async () => {
			const testId = createTestId("update");

			// Insert
			await client.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
				testId,
				"Original",
				1,
			]);

			// Update
			await client.query(`UPDATE ${testTableName} SET name = $1, value = $2 WHERE id = $3`, [
				"Updated",
				2,
				testId,
			]);

			// Verify
			const result = await client.query<{ name: string; value: number }>(
				`SELECT name, value FROM ${testTableName} WHERE id = $1`,
				[testId],
			);

			expect(result.rows[0].name).toBe("Updated");
			expect(result.rows[0].value).toBe(2);
		});

		it("should delete data", async () => {
			const testId = createTestId("delete");

			// Insert
			await client.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
				testId,
				"To Delete",
				0,
			]);

			// Delete
			const deleteResult = await client.query(`DELETE FROM ${testTableName} WHERE id = $1`, [
				testId,
			]);
			expect(deleteResult.rowCount).toBe(1);

			// Verify deletion
			const selectResult = await client.query(`SELECT * FROM ${testTableName} WHERE id = $1`, [
				testId,
			]);
			expect(selectResult.rows).toHaveLength(0);
		});
	});

	describe("queryOne", () => {
		it("should return single row", async () => {
			const testId = createTestId("one");

			await client.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
				testId,
				"Single",
				100,
			]);

			const row = await client.queryOne<{ id: string; name: string }>(
				`SELECT id, name FROM ${testTableName} WHERE id = $1`,
				[testId],
			);

			expect(row).not.toBeNull();
			expect(row!.id).toBe(testId);
			expect(row!.name).toBe("Single");
		});

		it("should return null for no results", async () => {
			const row = await client.queryOne(`SELECT * FROM ${testTableName} WHERE id = $1`, [
				"nonexistent",
			]);

			expect(row).toBeNull();
		});
	});

	describe("queryMany", () => {
		it("should return multiple rows", async () => {
			const prefix = createTestId("many");

			// Insert multiple rows
			await client.query(
				`INSERT INTO ${testTableName} (id, name, value) VALUES
				($1, $4, 1), ($2, $4, 2), ($3, $4, 3)`,
				[`${prefix}-1`, `${prefix}-2`, `${prefix}-3`, "Many"],
			);

			const rows = await client.queryMany<{ id: string; value: number }>(
				`SELECT id, value FROM ${testTableName} WHERE name = $1 ORDER BY value`,
				["Many"],
			);

			expect(rows.length).toBeGreaterThanOrEqual(3);
		});

		it("should return empty array for no results", async () => {
			const rows = await client.queryMany(`SELECT * FROM ${testTableName} WHERE name = $1`, [
				"NonexistentName",
			]);

			expect(rows).toEqual([]);
		});
	});

	describe("Transactions", () => {
		it("should commit successful transaction", async () => {
			const testId = createTestId("tx-commit");

			await client.transaction(async (txClient) => {
				await txClient.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
					testId,
					"Transaction",
					999,
				]);
			});

			// Verify data was committed
			const result = await client.queryOne<{ value: number }>(
				`SELECT value FROM ${testTableName} WHERE id = $1`,
				[testId],
			);

			expect(result).not.toBeNull();
			expect(result!.value).toBe(999);
		});

		it("should rollback failed transaction", async () => {
			const testId = createTestId("tx-rollback");

			try {
				await client.transaction(async (txClient) => {
					await txClient.query(
						`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`,
						[testId, "Will Rollback", 0],
					);

					// Force an error
					throw new Error("Intentional error for rollback test");
				});
			} catch (error) {
				// Expected error
				expect((error as Error).message).toBe("Intentional error for rollback test");
			}

			// Verify data was rolled back
			const result = await client.queryOne(`SELECT * FROM ${testTableName} WHERE id = $1`, [
				testId,
			]);

			expect(result).toBeNull();
		});

		it("should support multiple operations in transaction", async () => {
			const id1 = createTestId("tx-multi-1");
			const id2 = createTestId("tx-multi-2");

			await client.transaction(async (txClient) => {
				await txClient.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
					id1,
					"Multi 1",
					100,
				]);

				await txClient.query(`INSERT INTO ${testTableName} (id, name, value) VALUES ($1, $2, $3)`, [
					id2,
					"Multi 2",
					200,
				]);

				// Update first row
				await txClient.query(`UPDATE ${testTableName} SET value = value + 50 WHERE id = $1`, [id1]);
			});

			// Verify all operations were committed
			const row1 = await client.queryOne<{ value: number }>(
				`SELECT value FROM ${testTableName} WHERE id = $1`,
				[id1],
			);
			const row2 = await client.queryOne<{ value: number }>(
				`SELECT value FROM ${testTableName} WHERE id = $1`,
				[id2],
			);

			expect(row1!.value).toBe(150);
			expect(row2!.value).toBe(200);
		});
	});

	describe("Health Check", () => {
		it("should return true when connected", async () => {
			const healthy = await client.healthCheck();
			expect(healthy).toBe(true);
		});
	});

	describe("Error Handling", () => {
		it("should throw error for query on disconnected client", async () => {
			const tempClient = new PostgresClient({ url: getPostgresUrl() });
			// Don't connect

			await expect(tempClient.query("SELECT 1")).rejects.toThrow("PostgresClient is not connected");
		});

		it("should throw error for invalid SQL", async () => {
			await expect(client.query("INVALID SQL SYNTAX HERE")).rejects.toThrow();
		});
	});

	describe("Disconnect", () => {
		it("should disconnect successfully", async () => {
			const tempClient = new PostgresClient({ url: getPostgresUrl() });
			await tempClient.connect();
			expect(tempClient.isConnected()).toBe(true);

			await tempClient.disconnect();
			expect(tempClient.isConnected()).toBe(false);
		});

		it("should handle multiple disconnect calls", async () => {
			const tempClient = new PostgresClient({ url: getPostgresUrl() });
			await tempClient.connect();
			await tempClient.disconnect();
			await tempClient.disconnect(); // Should not throw
			expect(tempClient.isConnected()).toBe(false);
		});
	});
});
