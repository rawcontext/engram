import { describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
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

		// Mock readFile to return a simple SQL schema
		const readFileSpy = spyOn(fs, "readFile").mockResolvedValue(
			"CREATE TABLE IF NOT EXISTS test (id TEXT);",
		);

		await runMigrations(mockDb as any, mockLogger as any);

		expect(mockLogger.info).toHaveBeenCalledTimes(2);
		expect(mockDb.query).toHaveBeenCalled();

		readFileSpy.mockRestore();
	});

	it("should throw and log error if migration fails", async () => {
		const mockDb = {
			query: mock(() => Promise.reject(new Error("Database error"))),
		};
		const mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		const readFileSpy = spyOn(fs, "readFile").mockResolvedValue("INVALID SQL;");

		await expect(runMigrations(mockDb as any, mockLogger as any)).rejects.toThrow("Database error");

		expect(mockLogger.error).toHaveBeenCalled();

		readFileSpy.mockRestore();
	});

	it("should throw if schema file cannot be read", async () => {
		const mockDb = {
			query: mock(() => Promise.resolve({ rowCount: 0 })),
		};
		const mockLogger = {
			info: mock(() => {}),
			error: mock(() => {}),
		};

		const readFileSpy = spyOn(fs, "readFile").mockRejectedValue(new Error("File not found"));

		await expect(runMigrations(mockDb as any, mockLogger as any)).rejects.toThrow("File not found");

		expect(mockLogger.error).toHaveBeenCalled();

		readFileSpy.mockRestore();
	});
});
