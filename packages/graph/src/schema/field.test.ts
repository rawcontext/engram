import { describe, expect, test } from "bun:test";
import { field } from "./field";

describe("field", () => {
	describe("string", () => {
		test("creates a string field", () => {
			const f = field.string();
			expect(f.kind).toBe("string");
			expect(f.config.optional).toBeUndefined();
			expect(f.config.defaultValue).toBeUndefined();
		});

		test("supports optional modifier", () => {
			const f = field.string().optional();
			expect(f.kind).toBe("string");
			expect(f.config.optional).toBe(true);
		});

		test("supports default modifier", () => {
			const f = field.string().default("hello");
			expect(f.kind).toBe("string");
			expect(f.config.defaultValue).toBe("hello");
		});

		test("supports max modifier", () => {
			const f = field.string().max(100);
			expect(f.kind).toBe("string");
			expect(f.config.maxLength).toBe(100);
		});

		test("supports chaining modifiers", () => {
			const f = field.string().max(100).optional().default("test");
			expect(f.kind).toBe("string");
			expect(f.config.maxLength).toBe(100);
			expect(f.config.optional).toBe(true);
			expect(f.config.defaultValue).toBe("test");
		});
	});

	describe("int", () => {
		test("creates an int field", () => {
			const f = field.int();
			expect(f.kind).toBe("int");
			expect(f.config.optional).toBeUndefined();
		});

		test("supports min and max modifiers", () => {
			const f = field.int().min(0).max(100);
			expect(f.kind).toBe("int");
			expect(f.config.min).toBe(0);
			expect(f.config.max).toBe(100);
		});

		test("supports default modifier", () => {
			const f = field.int().default(42);
			expect(f.kind).toBe("int");
			expect(f.config.defaultValue).toBe(42);
		});

		test("supports chaining modifiers", () => {
			const f = field.int().min(0).max(150).optional();
			expect(f.kind).toBe("int");
			expect(f.config.min).toBe(0);
			expect(f.config.max).toBe(150);
			expect(f.config.optional).toBe(true);
		});
	});

	describe("float", () => {
		test("creates a float field", () => {
			const f = field.float();
			expect(f.kind).toBe("float");
		});

		test("supports min and max modifiers", () => {
			const f = field.float().min(0.0).max(1.0);
			expect(f.kind).toBe("float");
			expect(f.config.min).toBe(0.0);
			expect(f.config.max).toBe(1.0);
		});
	});

	describe("boolean", () => {
		test("creates a boolean field", () => {
			const f = field.boolean();
			expect(f.kind).toBe("boolean");
		});

		test("supports default modifier", () => {
			const f = field.boolean().default(true);
			expect(f.kind).toBe("boolean");
			expect(f.config.defaultValue).toBe(true);
		});
	});

	describe("timestamp", () => {
		test("creates a timestamp field", () => {
			const f = field.timestamp();
			expect(f.kind).toBe("timestamp");
		});

		test("supports default modifier", () => {
			const now = Date.now();
			const f = field.timestamp().default(now);
			expect(f.kind).toBe("timestamp");
			expect(f.config.defaultValue).toBe(now);
		});
	});

	describe("array", () => {
		test("creates an array field", () => {
			const f = field.array(field.string());
			expect(f.kind).toBe("array");
			expect(f.config.inner.kind).toBe("string");
		});

		test("supports nested arrays", () => {
			const f = field.array(field.array(field.int()));
			expect(f.kind).toBe("array");
			expect(f.config.inner.kind).toBe("array");
		});

		test("supports default modifier", () => {
			const f = field.array(field.string()).default(["a", "b"]);
			expect(f.kind).toBe("array");
			expect(f.config.defaultValue).toEqual(["a", "b"]);
		});
	});

	describe("enum", () => {
		test("creates an enum field", () => {
			const f = field.enum(["admin", "user", "guest"] as const);
			expect(f.kind).toBe("enum");
			expect(f.config.values).toEqual(["admin", "user", "guest"]);
		});

		test("supports default modifier", () => {
			const f = field.enum(["admin", "user", "guest"] as const).default("user");
			expect(f.kind).toBe("enum");
			expect(f.config.defaultValue).toBe("user");
		});

		test("supports optional modifier", () => {
			const f = field.enum(["admin", "user"] as const).optional();
			expect(f.kind).toBe("enum");
			expect(f.config.optional).toBe(true);
		});
	});

	describe("vector", () => {
		test("creates a vector field", () => {
			const f = field.vector(1536);
			expect(f.kind).toBe("vector");
			expect(f.config.dimensions).toBe(1536);
		});

		test("supports optional modifier", () => {
			const f = field.vector(1536).optional();
			expect(f.kind).toBe("vector");
			expect(f.config.optional).toBe(true);
		});

		test("supports default modifier", () => {
			const defaultVec = new Array(3).fill(0);
			const f = field.vector(3).default(defaultVec);
			expect(f.kind).toBe("vector");
			expect(f.config.defaultValue).toEqual(defaultVec);
		});
	});

	describe("type inference", () => {
		test("string field infers string type", () => {
			const f = field.string();
			// TypeScript type test - this would fail compilation if wrong
			type Inferred = NonNullable<typeof f.__type>;
			const _typeTest: Inferred = "hello";
			expect(_typeTest).toBe("hello");
		});

		test("int field infers number type", () => {
			const f = field.int();
			type Inferred = NonNullable<typeof f.__type>;
			const _typeTest: Inferred = 42;
			expect(_typeTest).toBe(42);
		});

		test("array field infers array type", () => {
			const f = field.array(field.string());
			type Inferred = NonNullable<typeof f.__type>;
			const _typeTest: Inferred = ["a", "b"];
			expect(_typeTest).toEqual(["a", "b"]);
		});

		test("enum field infers literal union type", () => {
			const f = field.enum(["admin", "user"] as const);
			type Inferred = NonNullable<typeof f.__type>;
			const _typeTest: Inferred = "admin";
			expect(_typeTest).toBe("admin");
		});
	});

	describe("complex schema example", () => {
		test("defines a user schema with multiple field types", () => {
			const userSchema = {
				id: field.string(),
				name: field.string().max(100),
				age: field.int().min(0).max(150).optional(),
				email: field.string().default("user@example.com"),
				isActive: field.boolean().default(true),
				createdAt: field.timestamp(),
				tags: field.array(field.string()).default([]),
				role: field.enum(["admin", "user", "guest"] as const).default("user"),
				embedding: field.vector(1536).optional(),
			};

			// Verify field kinds
			expect(userSchema.id.kind).toBe("string");
			expect(userSchema.name.kind).toBe("string");
			expect(userSchema.age.kind).toBe("int");
			expect(userSchema.email.kind).toBe("string");
			expect(userSchema.isActive.kind).toBe("boolean");
			expect(userSchema.createdAt.kind).toBe("timestamp");
			expect(userSchema.tags.kind).toBe("array");
			expect(userSchema.role.kind).toBe("enum");
			expect(userSchema.embedding.kind).toBe("vector");

			// Verify modifiers
			expect(userSchema.name.config.maxLength).toBe(100);
			expect(userSchema.age.config.optional).toBe(true);
			expect(userSchema.email.config.defaultValue).toBe("user@example.com");
			expect(userSchema.embedding.config.optional).toBe(true);
		});
	});
});
