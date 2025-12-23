import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConfigSchema, loadConfig } from "./config";

describe("ConfigSchema", () => {
	it("should validate correct config", () => {
		const config = ConfigSchema.parse({
			port: 6174,
			falkordbUrl: "redis://localhost:6179",
			postgresUrl: "postgresql://postgres:postgres@localhost:6183/engram",
			redisUrl: "redis://localhost:6179",
			searchUrl: "http://localhost:6176",
			logLevel: "info",
			rateLimitRpm: 60,
		});

		expect(config.port).toBe(6174);
		expect(config.logLevel).toBe("info");
	});

	it("should use default values when not provided", () => {
		const config = ConfigSchema.parse({});

		expect(config.port).toBe(6174);
		expect(config.falkordbUrl).toBe("redis://localhost:6179");
		expect(config.postgresUrl).toBe("postgresql://postgres:postgres@localhost:6183/engram");
		expect(config.redisUrl).toBe("redis://localhost:6179");
		expect(config.searchUrl).toBe("http://localhost:6176");
		expect(config.logLevel).toBe("info");
		expect(config.rateLimitRpm).toBe(60);
	});

	it("should reject invalid port numbers", () => {
		expect(() => ConfigSchema.parse({ port: 0 })).toThrow();
		expect(() => ConfigSchema.parse({ port: 70000 })).toThrow();
		expect(() => ConfigSchema.parse({ port: -1 })).toThrow();
	});

	it("should reject invalid log levels", () => {
		expect(() => ConfigSchema.parse({ logLevel: "invalid" })).toThrow();
	});

	it("should accept all valid log levels", () => {
		const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
		for (const level of levels) {
			const config = ConfigSchema.parse({ logLevel: level });
			expect(config.logLevel).toBe(level);
		}
	});

	it("should reject non-integer rate limits", () => {
		expect(() => ConfigSchema.parse({ rateLimitRpm: 60.5 })).toThrow();
	});
});

describe("loadConfig", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should load defaults when no env vars set", () => {
		delete process.env.PORT;
		delete process.env.FALKORDB_URL;
		delete process.env.POSTGRES_URL;
		delete process.env.REDIS_URL;
		delete process.env.SEARCH_URL;
		delete process.env.LOG_LEVEL;
		delete process.env.RATE_LIMIT_RPM;

		const config = loadConfig();

		expect(config.port).toBe(6174);
		expect(config.falkordbUrl).toBe("redis://localhost:6179");
		expect(config.logLevel).toBe("info");
		expect(config.rateLimitRpm).toBe(60);
	});

	it("should load port from env", () => {
		process.env.PORT = "3000";
		const config = loadConfig();
		expect(config.port).toBe(3000);
	});

	it("should load all env vars", () => {
		process.env.PORT = "9000";
		process.env.FALKORDB_URL = "redis://custom:6380";
		process.env.POSTGRES_URL = "postgresql://user:pass@host:5433/db";
		process.env.REDIS_URL = "redis://custom:6381";
		process.env.SEARCH_URL = "http://search:5003";
		process.env.LOG_LEVEL = "debug";
		process.env.RATE_LIMIT_RPM = "120";

		const config = loadConfig();

		expect(config.port).toBe(9000);
		expect(config.falkordbUrl).toBe("redis://custom:6380");
		expect(config.postgresUrl).toBe("postgresql://user:pass@host:5433/db");
		expect(config.redisUrl).toBe("redis://custom:6381");
		expect(config.searchUrl).toBe("http://search:5003");
		expect(config.logLevel).toBe("debug");
		expect(config.rateLimitRpm).toBe(120);
	});
});
