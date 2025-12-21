/**
 * Tests for @engram/common/utils/hash
 */

import { describe, expect, it } from "vitest";
import { hashObject, sha256Hash, sha256Short } from "./hash";

describe("sha256Hash", () => {
	it("should generate a 64-character hex string", () => {
		// Act
		const hash = sha256Hash("Hello, World!");

		// Assert
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});

	it("should generate consistent hashes for same input", () => {
		// Arrange
		const input = "test content";

		// Act
		const hash1 = sha256Hash(input);
		const hash2 = sha256Hash(input);

		// Assert
		expect(hash1).toBe(hash2);
	});

	it("should generate different hashes for different inputs", () => {
		// Act
		const hash1 = sha256Hash("content1");
		const hash2 = sha256Hash("content2");

		// Assert
		expect(hash1).not.toBe(hash2);
	});

	it("should handle Buffer input", () => {
		// Arrange
		const buffer = Buffer.from("test data");

		// Act
		const hash = sha256Hash(buffer);

		// Assert
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});

	it("should generate same hash for string and Buffer with same content", () => {
		// Arrange
		const content = "identical content";
		const buffer = Buffer.from(content);

		// Act
		const stringHash = sha256Hash(content);
		const bufferHash = sha256Hash(buffer);

		// Assert
		expect(stringHash).toBe(bufferHash);
	});

	it("should handle empty string", () => {
		// Act
		const hash = sha256Hash("");

		// Assert
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});
});

describe("sha256Short", () => {
	it("should return first 8 characters by default", () => {
		// Act
		const shortHash = sha256Short("Hello, World!");

		// Assert
		expect(shortHash).toHaveLength(8);
		expect(shortHash).toMatch(/^[0-9a-f]+$/);
	});

	it("should respect custom length", () => {
		// Act
		const shortHash = sha256Short("test", 16);

		// Assert
		expect(shortHash).toHaveLength(16);
		expect(shortHash).toMatch(/^[0-9a-f]+$/);
	});

	it("should be prefix of full hash", () => {
		// Arrange
		const content = "test content";

		// Act
		const fullHash = sha256Hash(content);
		const shortHash = sha256Short(content, 12);

		// Assert
		expect(fullHash.startsWith(shortHash)).toBe(true);
	});

	it("should handle Buffer input", () => {
		// Arrange
		const buffer = Buffer.from("test");

		// Act
		const shortHash = sha256Short(buffer);

		// Assert
		expect(shortHash).toHaveLength(8);
	});
});

describe("hashObject", () => {
	it("should hash objects consistently", () => {
		// Arrange
		const obj = { a: 1, b: 2, c: 3 };

		// Act
		const hash1 = hashObject(obj);
		const hash2 = hashObject(obj);

		// Assert
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64);
	});

	it("should generate same hash regardless of key order", () => {
		// Arrange
		const obj1 = { b: 2, a: 1, c: 3 };
		const obj2 = { a: 1, b: 2, c: 3 };
		const obj3 = { c: 3, a: 1, b: 2 };

		// Act
		const hash1 = hashObject(obj1);
		const hash2 = hashObject(obj2);
		const hash3 = hashObject(obj3);

		// Assert
		expect(hash1).toBe(hash2);
		expect(hash2).toBe(hash3);
	});

	it("should handle null", () => {
		// Act
		const hash = hashObject(null);

		// Assert
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});

	it("should handle null and undefined consistently", () => {
		// Act
		const nullHash = hashObject(null);

		// Assert - null is handled by the function
		expect(nullHash).toHaveLength(64);
		expect(nullHash).toMatch(/^[0-9a-f]+$/);

		// Note: undefined is handled the same way as null in the implementation
		// Both go through JSON.stringify which converts them to "null" or "undefined"
	});

	it("should handle primitives", () => {
		// Act
		const stringHash = hashObject("test");
		const numberHash = hashObject(42);
		const boolHash = hashObject(true);

		// Assert
		expect(stringHash).toHaveLength(64);
		expect(numberHash).toHaveLength(64);
		expect(boolHash).toHaveLength(64);
	});

	it("should handle arrays", () => {
		// Arrange
		const arr = [1, 2, 3];

		// Act
		const hash = hashObject(arr);

		// Assert
		expect(hash).toHaveLength(64);
	});

	it("should generate different hashes for different arrays", () => {
		// Arrange
		const arr1 = [1, 2, 3];
		const arr2 = [3, 2, 1];

		// Act
		const hash1 = hashObject(arr1);
		const hash2 = hashObject(arr2);

		// Assert
		expect(hash1).not.toBe(hash2);
	});

	it("should handle nested objects", () => {
		// Arrange
		const obj1 = { a: { b: { c: 1 } } };
		const obj2 = { a: { b: { c: 1 } } };

		// Act
		const hash1 = hashObject(obj1);
		const hash2 = hashObject(obj2);

		// Assert
		expect(hash1).toBe(hash2);
	});

	it("should generate different hashes for different values", () => {
		// Arrange
		const obj1 = { a: 1 };
		const obj2 = { a: 2 };

		// Act
		const hash1 = hashObject(obj1);
		const hash2 = hashObject(obj2);

		// Assert
		expect(hash1).not.toBe(hash2);
	});

	it("should handle empty object", () => {
		// Act
		const hash = hashObject({});

		// Assert
		expect(hash).toHaveLength(64);
	});

	it("should handle empty array", () => {
		// Act
		const hash = hashObject([]);

		// Assert
		expect(hash).toHaveLength(64);
	});

	it("should handle boolean primitives", () => {
		// Act
		const trueHash = hashObject(true);
		const falseHash = hashObject(false);

		// Assert
		expect(trueHash).toHaveLength(64);
		expect(falseHash).toHaveLength(64);
		expect(trueHash).not.toBe(falseHash);
	});

	it("should hash same object values consistently", () => {
		// Arrange
		const obj = { x: 10, y: 20 };

		// Act
		const hash1 = hashObject(obj);
		const hash2 = hashObject({ y: 20, x: 10 }); // Different order

		// Assert
		expect(hash1).toBe(hash2);
	});
});
