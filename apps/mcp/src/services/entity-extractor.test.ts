import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EntityExtractorService, EntityType, RelationshipType } from "./entity-extractor";

describe("EntityExtractorService", () => {
	let mockServer: McpServer;
	let mockLogger: any;
	let service: EntityExtractorService;
	const mockGeminiApiKey = "test-gemini-api-key";

	beforeEach(() => {
		// Mock logger
		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		// Mock MCP server
		mockServer = {
			server: {
				getClientCapabilities: mock(() => ({ sampling: false })),
				createMessage: mock(async () => null),
			},
		} as unknown as McpServer;

		service = new EntityExtractorService(mockServer, mockLogger, mockGeminiApiKey);
	});

	describe("extract - sampling mode", () => {
		it("should extract entities from decision memory using MCP sampling", async () => {
			const content = "Use pytest for testing instead of unittest due to better fixtures";
			const memoryType = "decision";

			// Enable sampling capability
			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			// Mock successful sampling response
			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "pytest",
						type: "tool",
						context: "Chosen for testing framework",
						confidence: 0.95,
					},
					{
						name: "unittest",
						type: "tool",
						context: "Rejected in favor of pytest",
						confidence: 0.9,
					},
					{
						name: "testing",
						type: "concept",
						context: "Core concept being discussed",
						confidence: 0.85,
					},
				],
				relationships: [
					{
						from: "pytest",
						to: "testing",
						type: "RELATED_TO",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(3);
			expect(result.entities[0].name).toBe("pytest");
			expect(result.entities[0].type).toBe(EntityType.TOOL);
			expect(result.relationships).toHaveLength(1);
			expect(result.relationships[0].from).toBe("pytest");
			expect(result.relationships[0].to).toBe("testing");
			expect(result.model_used).toBe("sampling");
			expect(result.took_ms).toBeGreaterThanOrEqual(0);
		});

		it("should extract entities from insight memory using MCP sampling", async () => {
			const content = "The flaky test was caused by timezone assumptions in the date parser";
			const memoryType = "insight";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "timezone",
						type: "concept",
						context: "Root cause of test flakiness",
						confidence: 0.9,
					},
					{
						name: "date parser",
						type: "concept",
						context: "Component with the bug",
						confidence: 0.85,
					},
				],
				relationships: [
					{
						from: "date parser",
						to: "timezone",
						type: "DEPENDS_ON",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(2);
			expect(result.entities[0].name).toBe("timezone");
			expect(result.entities[0].type).toBe(EntityType.CONCEPT);
			expect(result.relationships).toHaveLength(1);
			expect(result.relationships[0].type).toBe(RelationshipType.DEPENDS_ON);
			expect(result.model_used).toBe("sampling");
		});

		it("should extract entities from preference memory using MCP sampling", async () => {
			const content = "User prefers tabs over spaces for indentation in TypeScript files";
			const memoryType = "preference";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "TypeScript",
						type: "technology",
						context: "Programming language for preference",
						confidence: 0.95,
					},
					{
						name: "indentation",
						type: "concept",
						context: "Code formatting preference",
						confidence: 0.8,
					},
				],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(2);
			expect(result.entities[0].name).toBe("TypeScript");
			expect(result.entities[0].type).toBe(EntityType.TECHNOLOGY);
			expect(result.relationships).toHaveLength(0);
			expect(result.model_used).toBe("sampling");
		});
	});

	describe("extract - relationship detection", () => {
		it("should detect IMPLEMENTS relationship", async () => {
			const content = "UserRepository class implements the repository pattern for data access";
			const memoryType = "decision";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "UserRepository",
						type: "file",
						context: "Class implementing the pattern",
						confidence: 0.9,
					},
					{
						name: "repository pattern",
						type: "pattern",
						context: "Design pattern being implemented",
						confidence: 0.95,
					},
				],
				relationships: [
					{
						from: "UserRepository",
						to: "repository pattern",
						type: "IMPLEMENTS",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.relationships).toHaveLength(1);
			expect(result.relationships[0].type).toBe(RelationshipType.IMPLEMENTS);
			expect(result.relationships[0].from).toBe("UserRepository");
			expect(result.relationships[0].to).toBe("repository pattern");
		});

		it("should detect DEPENDS_ON relationship", async () => {
			const content = "API service depends on PostgreSQL database for persistence";
			const memoryType = "fact";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "API service",
						type: "project",
						context: "Service with dependency",
						confidence: 0.9,
					},
					{
						name: "PostgreSQL",
						type: "technology",
						context: "Database dependency",
						confidence: 0.95,
					},
				],
				relationships: [
					{
						from: "API service",
						to: "PostgreSQL",
						type: "DEPENDS_ON",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.relationships).toHaveLength(1);
			expect(result.relationships[0].type).toBe(RelationshipType.DEPENDS_ON);
			expect(result.relationships[0].from).toBe("API service");
			expect(result.relationships[0].to).toBe("PostgreSQL");
		});

		it("should detect PART_OF relationship", async () => {
			const content = "auth.ts file is part of the authentication module";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "auth.ts",
						type: "file",
						context: "File in the module",
						confidence: 0.95,
					},
					{
						name: "authentication module",
						type: "project",
						context: "Parent module",
						confidence: 0.9,
					},
				],
				relationships: [
					{
						from: "auth.ts",
						to: "authentication module",
						type: "PART_OF",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.relationships).toHaveLength(1);
			expect(result.relationships[0].type).toBe(RelationshipType.PART_OF);
		});

		it("should detect multiple relationships between different entities", async () => {
			const content =
				"React component implements MVC pattern and depends on Redux for state management";
			const memoryType = "decision";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "React",
						type: "technology",
						context: "Frontend framework",
						confidence: 0.95,
					},
					{
						name: "MVC pattern",
						type: "pattern",
						context: "Architectural pattern",
						confidence: 0.9,
					},
					{
						name: "Redux",
						type: "technology",
						context: "State management library",
						confidence: 0.95,
					},
				],
				relationships: [
					{
						from: "React",
						to: "MVC pattern",
						type: "IMPLEMENTS",
					},
					{
						from: "React",
						to: "Redux",
						type: "DEPENDS_ON",
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.relationships).toHaveLength(2);
			expect(result.relationships[0].type).toBe(RelationshipType.IMPLEMENTS);
			expect(result.relationships[1].type).toBe(RelationshipType.DEPENDS_ON);
		});
	});

	describe("extract - Gemini fallback", () => {
		beforeEach(() => {
			// Clear any mocked fetch from previous tests
			delete (global as any).fetch;
		});

		it("should fallback to Gemini when sampling is unavailable", async () => {
			const content = "Use Docker for containerization in production";
			const memoryType = "decision";

			// Disable sampling capability
			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: false });

			// Mock Gemini API response
			const geminiResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										entities: [
											{
												name: "Docker",
												type: "tool",
												context: "Containerization tool",
												confidence: 0.95,
											},
											{
												name: "containerization",
												type: "concept",
												context: "Deployment approach",
												confidence: 0.85,
											},
										],
										relationships: [
											{
												from: "Docker",
												to: "containerization",
												type: "RELATED_TO",
											},
										],
									}),
								},
							],
						},
					},
				],
			};

			global.fetch = mock(async () => ({
				ok: true,
				json: async () => geminiResponse,
			})) as any;

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(2);
			expect(result.entities[0].name).toBe("Docker");
			expect(result.relationships).toHaveLength(1);
			expect(result.model_used).toBe("gemini");
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should fallback to Gemini when sampling throws error", async () => {
			const content = "Testing content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });
			spyOn(mockServer.server, "createMessage").mockRejectedValue(new Error("Sampling failed"));

			const geminiResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										entities: [
											{
												name: "test",
												type: "concept",
												context: "Testing",
												confidence: 0.8,
											},
										],
										relationships: [],
									}),
								},
							],
						},
					},
				],
			};

			global.fetch = mock(async () => ({
				ok: true,
				json: async () => geminiResponse,
			})) as any;

			const result = await service.extract(content, memoryType);

			expect(result.model_used).toBe("gemini");
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(Error) }),
				"MCP sampling failed, falling back to Gemini",
			);
		});

		it("should return empty result when Gemini API key is not configured", async () => {
			const serviceWithoutKey = new EntityExtractorService(mockServer, mockLogger, undefined);
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: false });

			const result = await serviceWithoutKey.extract(content, memoryType);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
			expect(result.model_used).toBe("gemini");
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it("should handle Gemini API errors gracefully", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: false });

			global.fetch = mock(async () => ({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			})) as any;

			const result = await service.extract(content, memoryType);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
			expect(result.model_used).toBe("gemini");
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("extract - edge cases", () => {
		it("should handle empty content gracefully", async () => {
			const content = "";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
			expect(result.model_used).toBe("sampling");
		});

		it("should handle minimal content gracefully", async () => {
			const content = "Yes";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
		});

		it("should handle malformed JSON response gracefully", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: "This is not valid JSON",
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ responseText: expect.any(String) }),
				"Failed to parse LLM response, returning empty result",
			);
		});

		it("should extract JSON from markdown code blocks", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const markdownResponse = `\`\`\`json
{
  "entities": [
    {
      "name": "test",
      "type": "concept",
      "context": "Testing",
      "confidence": 0.8
    }
  ],
  "relationships": []
}
\`\`\``;

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: markdownResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(1);
			expect(result.entities[0].name).toBe("test");
			expect(result.relationships).toEqual([]);
		});

		it("should clamp confidence values to [0, 1]", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "over",
						type: "concept",
						context: "Over limit",
						confidence: 1.5, // Over 1.0
					},
					{
						name: "under",
						type: "concept",
						context: "Under limit",
						confidence: -0.2, // Under 0.0
					},
					{
						name: "valid",
						type: "concept",
						context: "Valid range",
						confidence: 0.75,
					},
				],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			expect(result.entities).toHaveLength(3);
			expect(result.entities[0].confidence).toBe(1.0); // Clamped to max
			expect(result.entities[1].confidence).toBe(0.0); // Clamped to min
			expect(result.entities[2].confidence).toBe(0.75); // Unchanged
		});

		it("should handle non-text MCP response type", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "image", // Not text
					data: "base64data",
				},
			} as any);

			// Should fall back to Gemini
			const geminiResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										entities: [],
										relationships: [],
									}),
								},
							],
						},
					},
				],
			};

			global.fetch = mock(async () => ({
				ok: true,
				json: async () => geminiResponse,
			})) as any;

			const result = await service.extract(content, memoryType);

			expect(result.model_used).toBe("gemini");
		});

		it("should validate entity types and reject invalid ones", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "valid",
						type: "tool",
						context: "Valid entity",
						confidence: 0.9,
					},
					{
						name: "invalid",
						type: "invalid_type", // Invalid type
						context: "Invalid entity",
						confidence: 0.9,
					},
				],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			// Should return empty due to validation error
			expect(result.entities).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it("should validate relationship types and reject invalid ones", async () => {
			const content = "Test content";
			const memoryType = "context";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "entity1",
						type: "tool",
						context: "First entity",
						confidence: 0.9,
					},
					{
						name: "entity2",
						type: "tool",
						context: "Second entity",
						confidence: 0.9,
					},
				],
				relationships: [
					{
						from: "entity1",
						to: "entity2",
						type: "INVALID_RELATIONSHIP", // Invalid type
					},
				],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			const result = await service.extract(content, memoryType);

			// Should return empty due to validation error
			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("buildPrompt", () => {
		it("should include memory type and content in prompt", () => {
			const content = "Test content";
			const memoryType = "decision";

			const prompt = service.buildPrompt(content, memoryType);

			expect(prompt).toContain(`Type: ${memoryType}`);
			expect(prompt).toContain(`Content: ${content}`);
			expect(prompt).toContain("ENTITY TYPES:");
			expect(prompt).toContain("RELATIONSHIP TYPES:");
		});

		it("should include existing entities when provided", () => {
			const content = "Test content";
			const memoryType = "decision";
			const existingEntities = ["pytest", "Docker", "PostgreSQL"];

			const prompt = service.buildPrompt(content, memoryType, existingEntities);

			expect(prompt).toContain("EXISTING ENTITIES");
			expect(prompt).toContain("- pytest");
			expect(prompt).toContain("- Docker");
			expect(prompt).toContain("- PostgreSQL");
		});

		it("should not include existing entities section when none provided", () => {
			const content = "Test content";
			const memoryType = "decision";

			const prompt = service.buildPrompt(content, memoryType);

			expect(prompt).not.toContain("EXISTING ENTITIES");
		});

		it("should include all entity types in prompt", () => {
			const prompt = service.buildPrompt("content", "decision");

			expect(prompt).toContain("tool:");
			expect(prompt).toContain("concept:");
			expect(prompt).toContain("pattern:");
			expect(prompt).toContain("file:");
			expect(prompt).toContain("person:");
			expect(prompt).toContain("project:");
			expect(prompt).toContain("technology:");
		});

		it("should include all relationship types in prompt", () => {
			const prompt = service.buildPrompt("content", "decision");

			expect(prompt).toContain("RELATED_TO:");
			expect(prompt).toContain("DEPENDS_ON:");
			expect(prompt).toContain("IMPLEMENTS:");
			expect(prompt).toContain("PART_OF:");
		});
	});

	describe("parseResponse", () => {
		it("should parse valid JSON response", () => {
			const responseText = JSON.stringify({
				entities: [
					{
						name: "test",
						type: "tool",
						context: "Testing tool",
						confidence: 0.9,
					},
				],
				relationships: [
					{
						from: "test",
						to: "other",
						type: "RELATED_TO",
					},
				],
			});

			const result = service.parseResponse(responseText);

			expect(result.entities).toHaveLength(1);
			expect(result.relationships).toHaveLength(1);
		});

		it("should return empty result on invalid JSON", () => {
			const responseText = "not valid JSON";

			const result = service.parseResponse(responseText);

			expect(result.entities).toEqual([]);
			expect(result.relationships).toEqual([]);
		});

		it("should normalize entity fields to correct types", () => {
			const responseText = JSON.stringify({
				entities: [
					{
						name: 123, // Will be converted to string
						type: "tool",
						context: true, // Will be converted to string
						confidence: 0.9,
					},
				],
				relationships: [],
			});

			const result = service.parseResponse(responseText);

			expect(result.entities[0].name).toBe("123");
			expect(result.entities[0].context).toBe("true");
		});
	});

	describe("extract - with existing entities", () => {
		it("should pass existing entities to the prompt", async () => {
			const content = "Use pytest for testing";
			const memoryType = "decision";
			const existingEntities = ["pytest", "Docker"];

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const buildPromptSpy = spyOn(service, "buildPrompt").mockReturnValue("mock prompt");

			const samplingResponse = JSON.stringify({
				entities: [],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			await service.extract(content, memoryType, existingEntities);

			expect(buildPromptSpy).toHaveBeenCalledWith(content, memoryType, existingEntities);
		});
	});

	describe("extract - logging", () => {
		it("should log extraction start and completion", async () => {
			const content = "Test content";
			const memoryType = "decision";

			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });

			const samplingResponse = JSON.stringify({
				entities: [
					{
						name: "test",
						type: "tool",
						context: "Test",
						confidence: 0.9,
					},
				],
				relationships: [],
			});

			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: {
					type: "text",
					text: samplingResponse,
				},
			} as any);

			await service.extract(content, memoryType);

			// Check debug logging was called
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					memoryType,
					contentLength: content.length,
				}),
				"Extracting entities from memory content",
			);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					entityCount: 1,
					relationshipCount: 0,
					took_ms: expect.any(Number),
					modelUsed: "sampling",
				}),
				"Entity extraction complete",
			);
		});
	});
});
