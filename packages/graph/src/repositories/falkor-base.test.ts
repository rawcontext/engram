import type { GraphClient } from "@engram/storage";
import { spyOn, beforeEach, describe, expect, it, mock } from "bun:test";
import { spyOn, MAX_DATE } from "../utils/time";
import { FalkorBaseRepository } from "./falkor-base";

class TestRepository extends FalkorBaseRepository {
	public testGenerateId() {
		return this.generateId();
	}

	public testCreateBitemporal(validFrom?: number) {
		return this.createBitemporal(validFrom);
	}

	public testCreateQueryBuilder() {
		return this.createQueryBuilder();
	}

	public testBuildPropertyString(obj: Record<string, unknown>) {
		return this.buildPropertyString(obj);
	}

	public testBuildSetClause(updates: Record<string, unknown>, alias?: string) {
		return this.buildSetClause(updates, alias);
	}

	public testSnakeToCamel<T extends Record<string, unknown>>(obj: T) {
		return this.snakeToCamel(obj);
	}

	public testCamelToSnake<T extends Record<string, unknown>>(obj: T) {
		return this.camelToSnake(obj);
	}

	public testQuery<T>(cypher: string, params?: Record<string, unknown>) {
		return this.query<T>(cypher, params);
	}

	public testExists(label: string, condition: string, params: Record<string, unknown>) {
		return this.exists(label, condition, params);
	}

	public testSoftDelete(label: string, id: string) {
		return this.softDelete(label, id);
	}

	public testMaxDate() {
		return this.maxDate;
	}

	public testNow() {
		return this.now;
	}
}

describe("FalkorBaseRepository", () => {
	let mockClient: GraphClient;
	let repository: TestRepository;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new TestRepository(mockClient);
	});

	describe("generateId", () => {
		it("should generate a ULID", () => {
			const id = repository.testGenerateId();
			expect(id).toBeTruthy();
			expect(typeof id).toBe("string");
			expect(id.length).toBe(26); // ULID is 26 characters
		});

		it("should generate unique IDs", () => {
			const id1 = repository.testGenerateId();
			const id2 = repository.testGenerateId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("createBitemporal", () => {
		it("should create bitemporal properties with current time", () => {
			const result = repository.testCreateBitemporal();
			expect(result).toHaveProperty("vt_start");
			expect(result).toHaveProperty("vt_end", MAX_DATE);
			expect(result).toHaveProperty("tt_start");
			expect(result).toHaveProperty("tt_end", MAX_DATE);
			expect(result.vt_start).toBeLessThanOrEqual(Date.now());
		});

		it("should create bitemporal properties with custom validFrom", () => {
			const customTime = 1234567890000;
			const result = repository.testCreateBitemporal(customTime);
			expect(result.vt_start).toBe(customTime);
			expect(result.vt_end).toBe(MAX_DATE);
			expect(result.tt_end).toBe(MAX_DATE);
		});
	});

	describe("createQueryBuilder", () => {
		it("should create a QueryBuilder instance", () => {
			const builder = repository.testCreateQueryBuilder();
			expect(builder).toBeDefined();
			expect(typeof builder.match).toBe("function");
			expect(typeof builder.where).toBe("function");
			expect(typeof builder.return).toBe("function");
			expect(typeof builder.at).toBe("function");
			expect(typeof builder.build).toBe("function");
		});
	});

	describe("buildPropertyString", () => {
		it("should build Cypher property string from object", () => {
			const obj = { id: "abc", name: "test", age: 30 };
			const result = repository.testBuildPropertyString(obj);
			expect(result).toBe("id: $id, name: $name, age: $age");
		});

		it("should handle single property", () => {
			const obj = { id: "abc" };
			const result = repository.testBuildPropertyString(obj);
			expect(result).toBe("id: $id");
		});

		it("should handle empty object", () => {
			const result = repository.testBuildPropertyString({});
			expect(result).toBe("");
		});
	});

	describe("buildSetClause", () => {
		it("should build SET clause with default alias", () => {
			const updates = { name: "new", age: 30 };
			const result = repository.testBuildSetClause(updates);
			expect(result).toBe("n.name = $name, n.age = $age");
		});

		it("should build SET clause with custom alias", () => {
			const updates = { name: "new", age: 30 };
			const result = repository.testBuildSetClause(updates, "s");
			expect(result).toBe("s.name = $name, s.age = $age");
		});

		it("should handle single property", () => {
			const updates = { name: "new" };
			const result = repository.testBuildSetClause(updates, "x");
			expect(result).toBe("x.name = $name");
		});

		it("should handle empty object", () => {
			const result = repository.testBuildSetClause({});
			expect(result).toBe("");
		});
	});

	describe("snakeToCamel", () => {
		it("should convert snake_case to camelCase", () => {
			const obj = { user_id: "123", started_at: 1234567890000, agent_type: "test" };
			const result = repository.testSnakeToCamel(obj);
			expect(result).toEqual({
				userId: "123",
				startedAt: 1234567890000,
				agentType: "test",
			});
		});

		it("should handle mixed case", () => {
			const obj = { id: "123", user_id: "456", normalField: "value" };
			const result = repository.testSnakeToCamel(obj);
			expect(result).toEqual({
				id: "123",
				userId: "456",
				normalField: "value",
			});
		});

		it("should handle empty object", () => {
			const result = repository.testSnakeToCamel({});
			expect(result).toEqual({});
		});
	});

	describe("camelToSnake", () => {
		it("should convert camelCase to snake_case", () => {
			const obj = { userId: "123", startedAt: 1234567890000, agentType: "test" };
			const result = repository.testCamelToSnake(obj);
			expect(result).toEqual({
				user_id: "123",
				started_at: 1234567890000,
				agent_type: "test",
			});
		});

		it("should skip undefined values", () => {
			const obj = { userId: "123", undefinedField: undefined, normalField: "value" };
			const result = repository.testCamelToSnake(obj);
			expect(result).toEqual({
				user_id: "123",
				normal_field: "value",
			});
		});

		it("should handle mixed case", () => {
			const obj = { id: "123", userId: "456", normalfield: "value" };
			const result = repository.testCamelToSnake(obj);
			expect(result).toEqual({
				id: "123",
				user_id: "456",
				normalfield: "value",
			});
		});

		it("should handle empty object", () => {
			const result = repository.testCamelToSnake({});
			expect(result).toEqual({});
		});
	});

	describe("query", () => {
		it("should execute query through graphClient", async () => {
			const mockData = [{ id: "123", name: "test" }];
			spyOn(mockClient, "query").mockResolvedValueOnce(mockData);

			const result = await repository.testQuery("MATCH (n) RETURN n", { id: "123" });

			expect(mockClient.query).toHaveBeenCalledWith("MATCH (n) RETURN n", { id: "123" });
			expect(result).toEqual(mockData);
		});

		it("should execute query without params", async () => {
			const mockData = [{ count: 5 }];
			spyOn(mockClient, "query").mockResolvedValueOnce(mockData);

			const result = await repository.testQuery("MATCH (n) RETURN count(n) as count");

			expect(mockClient.query).toHaveBeenCalledWith("MATCH (n) RETURN count(n) as count", {});
			expect(result).toEqual(mockData);
		});
	});

	describe("exists", () => {
		it("should return true when node exists", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 1 }]);

			const result = await repository.testExists("Session", "id: $id", { id: "123" });

			expect(result).toBe(true);
			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("MATCH (n:Session {id: $id})"),
				{ id: "123" },
			);
		});

		it("should return false when node does not exist", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([{ cnt: 0 }]);

			const result = await repository.testExists("Session", "id: $id", { id: "999" });

			expect(result).toBe(false);
		});

		it("should return false when query returns empty array", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.testExists("Session", "id: $id", { id: "999" });

			expect(result).toBe(false);
		});
	});

	describe("softDelete", () => {
		it("should close transaction time for node", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.testSoftDelete("Session", "123");

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET n.tt_end = $t"),
				expect.objectContaining({ id: "123", t: expect.any(Number) }),
			);
		});

		it("should only affect nodes with open transaction time", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.testSoftDelete("Turn", "turn-123");

			const call = (mockClient.query as any).mock.calls[0];
			expect(call[0]).toContain(`n.tt_end = ${MAX_DATE}`);
		});
	});

	describe("maxDate", () => {
		it("should return MAX_DATE constant", () => {
			const result = repository.testMaxDate();
			expect(result).toBe(MAX_DATE);
		});
	});

	describe("now", () => {
		it("should return current timestamp", () => {
			const before = Date.now();
			const result = repository.testNow();
			const after = Date.now();

			expect(result).toBeGreaterThanOrEqual(before);
			expect(result).toBeLessThanOrEqual(after);
		});
	});
});
