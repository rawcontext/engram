import { describe, expect, it, mock, spyOn } from "bun:test";
import { runMigrations } from "./migrate";

describe("runMigrations", () => {
	it("should run migrations successfully", async () => {
		const mockDb = {
			query: mock(() => Promise.resolve({ rowCount: 0 })),
		};
		const mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		// Mock Bun.file to return a mock BunFile with text() method
		const bunFileSpy = spyOn(Bun, "file").mockReturnValue({
			text: () => Promise.resolve("CREATE TABLE IF NOT EXISTS test (id TEXT);"),
		} as any);

		await runMigrations(mockDb as any, mockLogger as any);

		expect(mockLogger.info).toHaveBeenCalledTimes(2);
		expect(mockDb.query).toHaveBeenCalled();

		bunFileSpy.mockRestore();
	});

	it("should throw and log error if migration fails", async () => {
		const mockDb = {
			query: mock(() => Promise.reject(new Error("Database error"))),
		};
		const mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		const bunFileSpy = spyOn(Bun, "file").mockReturnValue({
			text: () => Promise.resolve("INVALID SQL;"),
		} as any);

		await expect(runMigrations(mockDb as any, mockLogger as any)).rejects.toThrow("Database error");

		expect(mockLogger.error).toHaveBeenCalled();

		bunFileSpy.mockRestore();
	});

	it("should throw if schema file cannot be read", async () => {
		const mockDb = {
			query: mock(() => Promise.resolve({ rowCount: 0 })),
		};
		const mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		const bunFileSpy = spyOn(Bun, "file").mockReturnValue({
			text: () => Promise.reject(new Error("File not found")),
		} as any);

		await expect(runMigrations(mockDb as any, mockLogger as any)).rejects.toThrow("File not found");

		expect(mockLogger.error).toHaveBeenCalled();

		bunFileSpy.mockRestore();
	});
});
