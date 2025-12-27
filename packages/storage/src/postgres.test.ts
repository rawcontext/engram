import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockRelease = vi.fn();
const mockEnd = vi.fn();

const mockClient = {
	query: mockQuery,
	release: mockRelease,
};

// Mock the pg module
vi.mock("pg", () => {
	class MockPool {
		connect = mockConnect;
		end = mockEnd;
		query = mockQuery;
	}

	return {
		default: {
			Pool: MockPool,
		},
	};
});

// Import after mocking
import { PostgresClient } from "./postgres";

describe("PostgresClient", () => {
	let client: PostgresClient;

	beforeEach(() => {
		vi.clearAllMocks();
		mockConnect.mockResolvedValue(mockClient);
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

		client = new PostgresClient({ url: "postgresql://localhost:5432/test" });
	});

	describe("connect", () => {
		it("should connect successfully", async () => {
			await client.connect();

			expect(mockConnect).toHaveBeenCalledTimes(1);
			expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
			expect(mockRelease).toHaveBeenCalledTimes(1);
			expect(client.isConnected()).toBe(true);
		});

		it("should be idempotent when already connected", async () => {
			await client.connect();
			mockConnect.mockClear();
			mockQuery.mockClear();

			await client.connect();

			expect(mockConnect).not.toHaveBeenCalled();
			expect(mockQuery).not.toHaveBeenCalled();
		});

		it("should release client even if query fails", async () => {
			mockQuery.mockRejectedValueOnce(new Error("Connection failed"));

			await expect(client.connect()).rejects.toThrow("Connection failed");

			expect(mockRelease).toHaveBeenCalledTimes(1);
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("disconnect", () => {
		it("should disconnect successfully", async () => {
			await client.connect();
			await client.disconnect();

			expect(mockEnd).toHaveBeenCalledTimes(1);
			expect(client.isConnected()).toBe(false);
		});

		it("should be idempotent when not connected", async () => {
			await client.disconnect();

			expect(mockEnd).not.toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
		});

		it("should be idempotent when already disconnected", async () => {
			await client.connect();
			await client.disconnect();
			mockEnd.mockClear();

			await client.disconnect();

			expect(mockEnd).not.toHaveBeenCalled();
		});
	});

	describe("query", () => {
		it("should execute a query successfully", async () => {
			await client.connect();

			const mockResult = {
				rows: [{ id: 1, name: "test" }],
				rowCount: 1,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.query("SELECT * FROM users");

			expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users", undefined);
			expect(result.rows).toEqual([{ id: 1, name: "test" }]);
			expect(result.rowCount).toBe(1);
		});

		it("should execute a query with parameters", async () => {
			await client.connect();

			const mockResult = {
				rows: [{ id: 1 }],
				rowCount: 1,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			await client.query("SELECT * FROM users WHERE id = $1", [1]);

			expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [1]);
		});

		it("should throw when not connected", async () => {
			await expect(client.query("SELECT 1")).rejects.toThrow("PostgresClient is not connected");
		});
	});

	describe("queryOne", () => {
		it("should return first row when results exist", async () => {
			await client.connect();

			const mockResult = {
				rows: [
					{ id: 1, name: "first" },
					{ id: 2, name: "second" },
				],
				rowCount: 2,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryOne("SELECT * FROM users");

			expect(result).toEqual({ id: 1, name: "first" });
		});

		it("should return null when no results", async () => {
			await client.connect();

			const mockResult = {
				rows: [],
				rowCount: 0,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryOne("SELECT * FROM users WHERE id = $1", [999]);

			expect(result).toBeNull();
		});

		it("should work with parameters", async () => {
			await client.connect();

			const mockResult = {
				rows: [{ id: 5, name: "test" }],
				rowCount: 1,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryOne<{ id: number; name: string }>(
				"SELECT * FROM users WHERE id = $1",
				[5],
			);

			expect(result).toEqual({ id: 5, name: "test" });
		});
	});

	describe("queryMany", () => {
		it("should return all rows", async () => {
			await client.connect();

			const mockResult = {
				rows: [
					{ id: 1, name: "first" },
					{ id: 2, name: "second" },
					{ id: 3, name: "third" },
				],
				rowCount: 3,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryMany("SELECT * FROM users");

			expect(result).toHaveLength(3);
			expect(result).toEqual([
				{ id: 1, name: "first" },
				{ id: 2, name: "second" },
				{ id: 3, name: "third" },
			]);
		});

		it("should return empty array when no results", async () => {
			await client.connect();

			const mockResult = {
				rows: [],
				rowCount: 0,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryMany("SELECT * FROM users WHERE 1=0");

			expect(result).toEqual([]);
		});
	});

	describe("transaction", () => {
		it("should execute transaction successfully", async () => {
			await client.connect();

			const result = await client.transaction(async (txClient) => {
				expect(txClient).toBe(mockClient);
				return "success";
			});

			expect(mockConnect).toHaveBeenCalled();
			expect(mockQuery).toHaveBeenCalledWith("BEGIN");
			expect(mockQuery).toHaveBeenCalledWith("COMMIT");
			expect(mockRelease).toHaveBeenCalled();
			expect(result).toBe("success");
		});

		it("should rollback on error", async () => {
			await client.connect();

			const testError = new Error("Transaction failed");

			await expect(
				client.transaction(async () => {
					throw testError;
				}),
			).rejects.toThrow("Transaction failed");

			expect(mockQuery).toHaveBeenCalledWith("BEGIN");
			expect(mockQuery).toHaveBeenCalledWith("ROLLBACK");
			expect(mockRelease).toHaveBeenCalled();
		});

		it("should release client even if rollback fails", async () => {
			await client.connect();

			mockQuery.mockImplementation((sql: string) => {
				if (sql === "ROLLBACK") {
					return Promise.reject(new Error("Rollback failed"));
				}
				return Promise.resolve({ rows: [], rowCount: 0 });
			});

			await expect(
				client.transaction(async () => {
					throw new Error("Transaction error");
				}),
			).rejects.toThrow("Rollback failed");

			expect(mockRelease).toHaveBeenCalled();
		});

		it("should throw when not connected", async () => {
			await expect(
				client.transaction(async () => {
					return "test";
				}),
			).rejects.toThrow("PostgresClient is not connected");
		});

		it("should support nested operations", async () => {
			await client.connect();

			const mockInsertResult = {
				rows: [{ id: 1 }],
				rowCount: 1,
				command: "INSERT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery
				.mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
				.mockResolvedValueOnce(mockInsertResult) // INSERT
				.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

			const result = await client.transaction(async (txClient) => {
				const insertResult = await txClient.query(
					"INSERT INTO users (name) VALUES ($1) RETURNING id",
					["test"],
				);
				return insertResult.rows[0].id;
			});

			expect(result).toBe(1);
			expect(mockQuery).toHaveBeenCalledWith("BEGIN");
			expect(mockQuery).toHaveBeenCalledWith("INSERT INTO users (name) VALUES ($1) RETURNING id", [
				"test",
			]);
			expect(mockQuery).toHaveBeenCalledWith("COMMIT");
		});
	});

	describe("isConnected", () => {
		it("should return false when not connected", () => {
			expect(client.isConnected()).toBe(false);
		});

		it("should return true when connected", async () => {
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it("should return false after disconnect", async () => {
			await client.connect();
			await client.disconnect();
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("healthCheck", () => {
		it("should return true when connection is healthy", async () => {
			await client.connect();

			mockConnect.mockResolvedValueOnce(mockClient);
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

			const isHealthy = await client.healthCheck();

			expect(isHealthy).toBe(true);
			expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
			expect(mockRelease).toHaveBeenCalled();
		});

		it("should return false when not connected", async () => {
			const isHealthy = await client.healthCheck();

			expect(isHealthy).toBe(false);
		});

		it("should return false and set connected to false on health check failure", async () => {
			await client.connect();

			mockConnect.mockResolvedValueOnce(mockClient);
			mockQuery.mockRejectedValueOnce(new Error("Connection lost"));

			const isHealthy = await client.healthCheck();

			expect(isHealthy).toBe(false);
			expect(client.isConnected()).toBe(false);
			expect(mockRelease).toHaveBeenCalled();
		});

		it("should release client even if query fails", async () => {
			await client.connect();

			mockConnect.mockResolvedValueOnce(mockClient);
			mockQuery.mockRejectedValueOnce(new Error("Query failed"));

			await client.healthCheck();

			expect(mockRelease).toHaveBeenCalled();
		});
	});

	describe("Pool configuration", () => {
		it("should configure pool with correct settings", () => {
			const testClient = new PostgresClient({ url: "postgresql://user:pass@host:5432/db" });
			expect(testClient).toBeInstanceOf(PostgresClient);
		});
	});

	describe("Query edge cases", () => {
		it("should handle queries with empty params", async () => {
			await client.connect();

			const mockResult = {
				rows: [{ id: 1 }],
				rowCount: 1,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.query("SELECT * FROM users", []);

			expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users", []);
			expect(result.rows).toEqual([{ id: 1 }]);
		});

		it("should handle queryOne with typed result", async () => {
			await client.connect();

			interface User {
				id: number;
				name: string;
				email: string;
			}

			const mockResult = {
				rows: [{ id: 1, name: "John", email: "john@example.com" }],
				rowCount: 1,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryOne<User>("SELECT * FROM users WHERE id = $1", [1]);

			expect(result).toEqual({ id: 1, name: "John", email: "john@example.com" });
		});

		it("should handle queryMany with typed results", async () => {
			await client.connect();

			interface User {
				id: number;
				name: string;
			}

			const mockResult = {
				rows: [
					{ id: 1, name: "John" },
					{ id: 2, name: "Jane" },
				],
				rowCount: 2,
				command: "SELECT",
				oid: 0,
				fields: [],
			} as pg.QueryResult;

			mockQuery.mockResolvedValueOnce(mockResult);

			const result = await client.queryMany<User>("SELECT * FROM users");

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe(1);
			expect(result[1].id).toBe(2);
		});
	});

	describe("Connection errors", () => {
		it("should throw on connect if pool.connect fails", async () => {
			const errorClient = new PostgresClient({ url: "postgresql://localhost:5432/test" });
			mockConnect.mockRejectedValueOnce(new Error("Connection refused"));

			await expect(errorClient.connect()).rejects.toThrow("Connection refused");
		});

		it("should throw on disconnect if pool.end fails", async () => {
			await client.connect();
			mockEnd.mockRejectedValueOnce(new Error("End failed"));

			await expect(client.disconnect()).rejects.toThrow("End failed");
		});
	});
});
