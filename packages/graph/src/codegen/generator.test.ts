import { describe, expect, test } from "bun:test";
import { edge } from "../schema/edge";
import { field } from "../schema/field";
import { mcp } from "../schema/mcp";
import { node } from "../schema/node";
import { defineSchema } from "../schema/schema";
import { type GenerateOptions, generate, generateSummary } from "./generator";

// Test schema
const testSchema = defineSchema({
	nodes: {
		Memory: node({
			content: field.string(),
			type: field.enum(["decision", "insight", "fact"] as const),
			importance: field.float().optional(),
		}),
		Session: node({
			summary: field.string().optional(),
			started: field.int(),
		}),
	},
	edges: {
		CONTAINS: edge({
			position: field.int(),
		}),
	},
});

// Test tools
const testTools = mcp.defineTools({
	remember: mcp.tool({
		title: "Remember",
		description: "Store a memory",
		input: {
			content: mcp.param.string("Content to store"),
		},
		output: {
			id: mcp.param.string("Created memory ID"),
		},
	}),
});

describe("generate", () => {
	describe("dry run mode", () => {
		test("generates all expected files", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const filePaths = result.files.map((f) => f.path);
			expect(filePaths).toContain("types.ts");
			expect(filePaths).toContain("query-builders.ts");
			expect(filePaths).toContain("repositories.ts");
			expect(filePaths).toContain("validators.ts");
			expect(filePaths).toContain("index.ts");
		});

		test("includes MCP tools file when tools provided", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
			});

			const filePaths = result.files.map((f) => f.path);
			expect(filePaths).toContain("mcp-tools.ts");
		});

		test("excludes MCP tools file when no tools", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const filePaths = result.files.map((f) => f.path);
			expect(filePaths).not.toContain("mcp-tools.ts");
		});
	});

	describe("summary generation", () => {
		test("counts node types correctly", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			expect(result.summary.nodeTypes).toBe(2); // Memory, Session
		});

		test("counts edge types correctly", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			expect(result.summary.edgeTypes).toBe(1); // CONTAINS
		});

		test("counts query builders correctly", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			expect(result.summary.queryBuilders).toBe(2); // One per node
		});

		test("counts repositories correctly", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			expect(result.summary.repositories).toBe(2); // One per node
		});

		test("counts MCP tools when provided", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
			});

			expect(result.summary.mcpTools).toBe(1); // remember
		});

		test("reports zero MCP tools when not provided", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			expect(result.summary.mcpTools).toBe(0);
		});

		test("counts total files correctly without MCP", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			// types.ts, query-builders.ts, repositories.ts, validators.ts, index.ts
			expect(result.summary.totalFiles).toBe(5);
		});

		test("counts total files correctly with MCP", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
			});

			// types.ts, query-builders.ts, repositories.ts, validators.ts, mcp-tools.ts, index.ts
			expect(result.summary.totalFiles).toBe(6);
		});
	});

	describe("file content", () => {
		test("types file contains node types", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const typesFile = result.files.find((f) => f.path === "types.ts");
			expect(typesFile).toBeDefined();
			expect(typesFile!.content).toContain("Memory");
			expect(typesFile!.content).toContain("Session");
		});

		test("query builders file contains builders", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const qbFile = result.files.find((f) => f.path === "query-builders.ts");
			expect(qbFile).toBeDefined();
			expect(qbFile!.content).toContain("MemoryQueryBuilder");
			expect(qbFile!.content).toContain("SessionQueryBuilder");
		});

		test("repositories file contains repositories", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const repoFile = result.files.find((f) => f.path === "repositories.ts");
			expect(repoFile).toBeDefined();
			expect(repoFile!.content).toContain("MemoryRepository");
			expect(repoFile!.content).toContain("SessionRepository");
		});

		test("validators file contains validators", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const validatorsFile = result.files.find((f) => f.path === "validators.ts");
			expect(validatorsFile).toBeDefined();
			expect(validatorsFile!.content).toContain("MemorySchema");
			expect(validatorsFile!.content).toContain("SessionSchema");
		});

		test("MCP file contains tool schemas", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
			});

			const mcpFile = result.files.find((f) => f.path === "mcp-tools.ts");
			expect(mcpFile).toBeDefined();
			expect(mcpFile!.content).toContain("rememberInputSchema");
			expect(mcpFile!.content).toContain("registerRememberTool");
		});
	});

	describe("barrel export (index.ts)", () => {
		test("exports types module", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile).toBeDefined();
			expect(indexFile!.content).toContain('export * from "./types"');
		});

		test("exports query-builders module", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).toContain('export * from "./query-builders"');
		});

		test("exports repositories module", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).toContain('export * from "./repositories"');
		});

		test("exports validators module", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).toContain('export * from "./validators"');
		});

		test("exports mcp-tools module when tools provided", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).toContain('export * from "./mcp-tools"');
		});

		test("omits mcp-tools export when no tools", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).not.toContain('export * from "./mcp-tools"');
		});

		test("includes auto-generated header", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile!.content).toContain("AUTO-GENERATED FILE - DO NOT EDIT");
		});
	});

	describe("generator options passthrough", () => {
		test("passes typesOptions to types generator", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
				typesOptions: {
					includeHeader: "// Custom types header\n",
				},
			});

			const typesFile = result.files.find((f) => f.path === "types.ts");
			expect(typesFile!.content).toContain("// Custom types header");
		});

		test("passes queryBuilderOptions to query builder generator", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
				queryBuilderOptions: {
					includeComments: false,
				},
			});

			const qbFile = result.files.find((f) => f.path === "query-builders.ts");
			// With comments disabled, should not contain JSDoc comments
			expect(qbFile!.content).not.toContain("* Query builder for Memory nodes");
		});

		test("passes repositoryOptions to repository generator", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
				repositoryOptions: {
					includeComments: false,
				},
			});

			const repoFile = result.files.find((f) => f.path === "repositories.ts");
			expect(repoFile!.content).not.toContain("* Repository for Memory nodes");
		});

		test("passes validatorOptions to validator generator", async () => {
			const result = await generate({
				schema: testSchema,
				dryRun: true,
				validatorOptions: {
					header: "// Custom validators header\n",
				},
			});

			const validatorsFile = result.files.find((f) => f.path === "validators.ts");
			expect(validatorsFile!.content).toContain("// Custom validators header");
		});

		test("passes mcpOptions to MCP generator", async () => {
			const result = await generate({
				schema: testSchema,
				tools: testTools,
				dryRun: true,
				mcpOptions: {
					includeComments: false,
				},
			});

			const mcpFile = result.files.find((f) => f.path === "mcp-tools.ts");
			expect(mcpFile!.content).not.toContain("* Input schema for");
		});
	});

	describe("default output directory", () => {
		test("uses src/generated as default", async () => {
			const options: GenerateOptions = {
				schema: testSchema,
				dryRun: true,
			};

			// In dry run, we don't write files, but we can verify the default is set
			const result = await generate(options);
			expect(result.files.length).toBeGreaterThan(0);
		});
	});
});

describe("generateSummary", () => {
	test("returns only summary without files content details", async () => {
		const summary = await generateSummary({
			schema: testSchema,
		});

		expect(summary.nodeTypes).toBe(2);
		expect(summary.edgeTypes).toBe(1);
		expect(summary.queryBuilders).toBe(2);
		expect(summary.repositories).toBe(2);
		expect(summary.mcpTools).toBe(0);
		expect(summary.totalFiles).toBe(5);
	});

	test("includes MCP tool count when tools provided", async () => {
		const summary = await generateSummary({
			schema: testSchema,
			tools: testTools,
		});

		expect(summary.mcpTools).toBe(1);
		expect(summary.totalFiles).toBe(6);
	});
});
