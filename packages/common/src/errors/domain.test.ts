/**
 * Tests for @engram/common/errors/domain
 */

import { describe, expect, it } from "vitest";
import {
	ContextAssemblyError,
	ErrorCodes,
	GraphOperationError,
	ParseError,
	RehydrationError,
	SearchError,
	StorageError,
	ValidationError,
} from "./domain";

describe("ErrorCodes", () => {
	it("should export all error codes", () => {
		// Assert
		expect(ErrorCodes.GRAPH_QUERY_FAILED).toBe("GRAPH_QUERY_FAILED");
		expect(ErrorCodes.GRAPH_CONNECTION_FAILED).toBe("GRAPH_CONNECTION_FAILED");
		expect(ErrorCodes.GRAPH_TRANSACTION_FAILED).toBe("GRAPH_TRANSACTION_FAILED");
		expect(ErrorCodes.PARSE_JSON_FAILED).toBe("PARSE_JSON_FAILED");
		expect(ErrorCodes.PARSE_CYPHER_FAILED).toBe("PARSE_CYPHER_FAILED");
		expect(ErrorCodes.PARSE_EVENT_FAILED).toBe("PARSE_EVENT_FAILED");
		expect(ErrorCodes.VALIDATION_FAILED).toBe("VALIDATION_FAILED");
		expect(ErrorCodes.VALIDATION_SCHEMA_FAILED).toBe("VALIDATION_SCHEMA_FAILED");
		expect(ErrorCodes.VALIDATION_CONSTRAINT_FAILED).toBe("VALIDATION_CONSTRAINT_FAILED");
		expect(ErrorCodes.CONTEXT_ASSEMBLY_FAILED).toBe("CONTEXT_ASSEMBLY_FAILED");
		expect(ErrorCodes.CONTEXT_TIMEOUT).toBe("CONTEXT_TIMEOUT");
		expect(ErrorCodes.CONTEXT_LIMIT_EXCEEDED).toBe("CONTEXT_LIMIT_EXCEEDED");
		expect(ErrorCodes.REHYDRATION_FAILED).toBe("REHYDRATION_FAILED");
		expect(ErrorCodes.REHYDRATION_NOT_FOUND).toBe("REHYDRATION_NOT_FOUND");
		expect(ErrorCodes.REHYDRATION_CORRUPTED).toBe("REHYDRATION_CORRUPTED");
		expect(ErrorCodes.STORAGE_READ_FAILED).toBe("STORAGE_READ_FAILED");
		expect(ErrorCodes.STORAGE_WRITE_FAILED).toBe("STORAGE_WRITE_FAILED");
		expect(ErrorCodes.STORAGE_NOT_FOUND).toBe("STORAGE_NOT_FOUND");
		expect(ErrorCodes.STORAGE_INVALID_PATH).toBe("STORAGE_INVALID_PATH");
		expect(ErrorCodes.SEARCH_QUERY_FAILED).toBe("SEARCH_QUERY_FAILED");
		expect(ErrorCodes.SEARCH_INDEX_FAILED).toBe("SEARCH_INDEX_FAILED");
		expect(ErrorCodes.SEARCH_EMBEDDING_FAILED).toBe("SEARCH_EMBEDDING_FAILED");
	});
});

describe("GraphOperationError", () => {
	it("should create error with message and query", () => {
		// Arrange
		const query = "MATCH (n) RETURN n";

		// Act
		const error = new GraphOperationError("Query failed", query);

		// Assert
		expect(error.message).toBe("Query failed");
		expect(error.code).toBe(ErrorCodes.GRAPH_QUERY_FAILED);
		expect(error.query).toBe(query);
		expect(error.name).toBe("GraphOperationError");
	});

	it("should include cause error", () => {
		// Arrange
		const causeError = new Error("Connection lost");

		// Act
		const error = new GraphOperationError("Query failed", "MATCH (n)", causeError);

		// Assert
		expect(error.cause).toBe(causeError);
	});

	it("should include query parameters", () => {
		// Arrange
		const params = { id: "123", name: "test" };

		// Act
		const error = new GraphOperationError("Query failed", "MATCH (n)", undefined, params);

		// Assert
		expect(error.params).toEqual(params);
	});

	it("should not expose query/params in JSON", () => {
		// Arrange
		const query = "MATCH (n:Secret) RETURN n";
		const params = { apiKey: "secret123" };
		const error = new GraphOperationError("Query failed", query, undefined, params);

		// Act
		const json = error.toJSON();

		// Assert
		expect(json).not.toHaveProperty("query");
		expect(json).not.toHaveProperty("params");
		expect(json.code).toBe(ErrorCodes.GRAPH_QUERY_FAILED);
	});
});

describe("ParseError", () => {
	it("should create error with message and input", () => {
		// Arrange
		const input = '{"invalid": json}';

		// Act
		const error = new ParseError("Invalid JSON", input);

		// Assert
		expect(error.message).toBe("Invalid JSON");
		expect(error.code).toBe(ErrorCodes.PARSE_JSON_FAILED);
		expect(error.input).toBe(input);
		expect(error.name).toBe("ParseError");
	});

	it("should truncate long input", () => {
		// Arrange
		const longInput = "x".repeat(1000);

		// Act
		const error = new ParseError("Parse failed", longInput);

		// Assert
		expect(error.input).toHaveLength(500);
		expect(error.input).toBe("x".repeat(500));
	});

	it("should include expected format", () => {
		// Arrange
		const expected = "ISO8601 datetime";

		// Act
		const error = new ParseError("Parse failed", "invalid", undefined, expected);

		// Assert
		expect(error.expected).toBe(expected);
	});

	it("should serialize to JSON with input and expected", () => {
		// Act
		const error = new ParseError("Parse failed", "bad-input", undefined, "JSON object");

		// Assert
		const json = error.toJSON();
		expect(json.input).toBe("bad-input");
		expect(json.expected).toBe("JSON object");
	});
});

describe("ValidationError", () => {
	it("should create error with field name", () => {
		// Act
		const error = new ValidationError("Email is required", "email");

		// Assert
		expect(error.message).toBe("Email is required");
		expect(error.code).toBe(ErrorCodes.VALIDATION_FAILED);
		expect(error.field).toBe("email");
		expect(error.name).toBe("ValidationError");
	});

	it("should include value and constraint", () => {
		// Act
		const error = new ValidationError("Invalid age", "age", undefined, {
			value: -5,
			constraint: "must be positive",
		});

		// Assert
		expect(error.field).toBe("age");
		expect(error.value).toBe(-5);
		expect(error.constraint).toBe("must be positive");
	});

	it("should serialize to JSON with all fields", () => {
		// Act
		const error = new ValidationError("Invalid input", "username", undefined, {
			value: "a",
			constraint: "min length 3",
		});

		// Assert
		const json = error.toJSON();
		expect(json.field).toBe("username");
		expect(json.value).toBe("a");
		expect(json.constraint).toBe("min length 3");
	});
});

describe("ContextAssemblyError", () => {
	it("should create error with session ID", () => {
		// Act
		const error = new ContextAssemblyError("Assembly timeout", "session-123");

		// Assert
		expect(error.message).toBe("Assembly timeout");
		expect(error.code).toBe(ErrorCodes.CONTEXT_ASSEMBLY_FAILED);
		expect(error.sessionId).toBe("session-123");
		expect(error.name).toBe("ContextAssemblyError");
	});

	it("should include partial context", () => {
		// Arrange
		const partialContext = { turns: [1, 2], files: [] };

		// Act
		const error = new ContextAssemblyError("Failed", "sess-1", undefined, partialContext);

		// Assert
		expect(error.partialContext).toEqual(partialContext);
	});

	it("should serialize to JSON with hasPartialContext flag", () => {
		// Act
		const error1 = new ContextAssemblyError("Failed", "sess-1", undefined, { data: "partial" });
		const error2 = new ContextAssemblyError("Failed", "sess-2");

		// Assert
		const json1 = error1.toJSON();
		const json2 = error2.toJSON();
		expect(json1.hasPartialContext).toBe(true);
		expect(json2.hasPartialContext).toBe(false);
		expect(json1.sessionId).toBe("sess-1");
	});
});

describe("RehydrationError", () => {
	it("should create error with entity ID and type", () => {
		// Act
		const error = new RehydrationError("State corrupted", "entity-456", undefined, "Session");

		// Assert
		expect(error.message).toBe("State corrupted");
		expect(error.code).toBe(ErrorCodes.REHYDRATION_FAILED);
		expect(error.entityId).toBe("entity-456");
		expect(error.entityType).toBe("Session");
		expect(error.name).toBe("RehydrationError");
	});

	it("should serialize to JSON with entity info", () => {
		// Act
		const error = new RehydrationError("Failed", "ent-1", undefined, "Turn");

		// Assert
		const json = error.toJSON();
		expect(json.entityId).toBe("ent-1");
		expect(json.entityType).toBe("Turn");
	});
});

describe("StorageError", () => {
	it("should create error with URI and operation", () => {
		// Act
		const error = new StorageError(
			"Read failed",
			ErrorCodes.STORAGE_READ_FAILED,
			"gs://bucket/file.txt",
			undefined,
			"read",
		);

		// Assert
		expect(error.message).toBe("Read failed");
		expect(error.code).toBe(ErrorCodes.STORAGE_READ_FAILED);
		expect(error.uri).toBe("gs://bucket/file.txt");
		expect(error.operation).toBe("read");
		expect(error.name).toBe("StorageError");
	});

	it("should support different storage operations", () => {
		// Act
		const readError = new StorageError(
			"Read failed",
			ErrorCodes.STORAGE_READ_FAILED,
			"uri",
			undefined,
			"read",
		);
		const writeError = new StorageError(
			"Write failed",
			ErrorCodes.STORAGE_WRITE_FAILED,
			"uri",
			undefined,
			"write",
		);
		const deleteError = new StorageError(
			"Delete failed",
			ErrorCodes.STORAGE_NOT_FOUND,
			"uri",
			undefined,
			"delete",
		);
		const listError = new StorageError(
			"List failed",
			ErrorCodes.STORAGE_READ_FAILED,
			"uri",
			undefined,
			"list",
		);

		// Assert
		expect(readError.operation).toBe("read");
		expect(writeError.operation).toBe("write");
		expect(deleteError.operation).toBe("delete");
		expect(listError.operation).toBe("list");
	});

	it("should serialize to JSON with uri and operation", () => {
		// Act
		const error = new StorageError(
			"Failed",
			ErrorCodes.STORAGE_WRITE_FAILED,
			"file://path",
			undefined,
			"write",
		);

		// Assert
		const json = error.toJSON();
		expect(json.uri).toBe("file://path");
		expect(json.operation).toBe("write");
	});
});

describe("SearchError", () => {
	it("should create error with query and operation", () => {
		// Act
		const error = new SearchError(
			"Embedding failed",
			ErrorCodes.SEARCH_EMBEDDING_FAILED,
			"test query",
			undefined,
			"embed",
		);

		// Assert
		expect(error.message).toBe("Embedding failed");
		expect(error.code).toBe(ErrorCodes.SEARCH_EMBEDDING_FAILED);
		expect(error.query).toBe("test query");
		expect(error.operation).toBe("embed");
		expect(error.name).toBe("SearchError");
	});

	it("should support different search operations", () => {
		// Act
		const queryError = new SearchError(
			"Query failed",
			ErrorCodes.SEARCH_QUERY_FAILED,
			"q",
			undefined,
			"query",
		);
		const indexError = new SearchError(
			"Index failed",
			ErrorCodes.SEARCH_INDEX_FAILED,
			"q",
			undefined,
			"index",
		);
		const embedError = new SearchError(
			"Embed failed",
			ErrorCodes.SEARCH_EMBEDDING_FAILED,
			"q",
			undefined,
			"embed",
		);
		const rerankError = new SearchError(
			"Rerank failed",
			ErrorCodes.SEARCH_QUERY_FAILED,
			"q",
			undefined,
			"rerank",
		);

		// Assert
		expect(queryError.operation).toBe("query");
		expect(indexError.operation).toBe("index");
		expect(embedError.operation).toBe("embed");
		expect(rerankError.operation).toBe("rerank");
	});

	it("should serialize to JSON with query and operation", () => {
		// Act
		const error = new SearchError(
			"Failed",
			ErrorCodes.SEARCH_QUERY_FAILED,
			"search terms",
			undefined,
			"query",
		);

		// Assert
		const json = error.toJSON();
		expect(json.query).toBe("search terms");
		expect(json.operation).toBe("query");
	});
});
