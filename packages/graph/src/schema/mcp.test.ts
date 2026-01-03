import { describe, expect, test } from "bun:test";
import {
	type InferParamShape,
	type InferParamType,
	inputToJsonSchema,
	mcp,
	paramsToJsonSchema,
	paramToJsonSchema,
	type Simplify,
	toolCollectionToRegistrations,
	toolToRegistration,
} from "./mcp";

describe("mcp.param", () => {
	describe("string", () => {
		test("creates a string param", () => {
			const p = mcp.param.string();
			expect(p.kind).toBe("string");
			expect(p.config.optional).toBeUndefined();
			expect(p.config.description).toBeUndefined();
		});

		test("creates a string param with description", () => {
			const p = mcp.param.string("The memory content");
			expect(p.kind).toBe("string");
			expect(p.config.description).toBe("The memory content");
		});

		test("supports optional modifier", () => {
			const p = mcp.param.string("Content").optional();
			expect(p.kind).toBe("string");
			expect(p.config.optional).toBe(true);
			expect(p.config.description).toBe("Content");
		});

		test("supports default modifier", () => {
			const p = mcp.param.string().default("hello");
			expect(p.kind).toBe("string");
			expect(p.config.defaultValue).toBe("hello");
		});

		test("supports describe modifier", () => {
			const p = mcp.param.string().describe("Updated description");
			expect(p.kind).toBe("string");
			expect(p.config.description).toBe("Updated description");
		});

		test("supports max modifier", () => {
			const p = mcp.param.string().max(100);
			expect(p.kind).toBe("string");
			expect(p.config.maxLength).toBe(100);
		});

		test("supports min modifier", () => {
			const p = mcp.param.string().min(10);
			expect(p.kind).toBe("string");
			expect(p.config.minLength).toBe(10);
		});

		test("supports chaining modifiers", () => {
			const p = mcp.param.string("Content").max(100).min(10).optional().default("test");
			expect(p.kind).toBe("string");
			expect(p.config.maxLength).toBe(100);
			expect(p.config.minLength).toBe(10);
			expect(p.config.optional).toBe(true);
			expect(p.config.defaultValue).toBe("test");
		});
	});

	describe("int", () => {
		test("creates an int param", () => {
			const p = mcp.param.int();
			expect(p.kind).toBe("int");
			expect(p.config.optional).toBeUndefined();
		});

		test("creates an int param with description", () => {
			const p = mcp.param.int("Maximum results");
			expect(p.kind).toBe("int");
			expect(p.config.description).toBe("Maximum results");
		});

		test("supports min and max modifiers", () => {
			const p = mcp.param.int().min(1).max(100);
			expect(p.kind).toBe("int");
			expect(p.config.min).toBe(1);
			expect(p.config.max).toBe(100);
		});

		test("supports default modifier", () => {
			const p = mcp.param.int().default(10);
			expect(p.kind).toBe("int");
			expect(p.config.defaultValue).toBe(10);
		});

		test("supports chaining modifiers", () => {
			const p = mcp.param.int("Limit").min(1).max(100).default(10).optional();
			expect(p.kind).toBe("int");
			expect(p.config.min).toBe(1);
			expect(p.config.max).toBe(100);
			expect(p.config.defaultValue).toBe(10);
			expect(p.config.optional).toBe(true);
		});
	});

	describe("float", () => {
		test("creates a float param", () => {
			const p = mcp.param.float();
			expect(p.kind).toBe("float");
		});

		test("supports min and max modifiers", () => {
			const p = mcp.param.float().min(0.0).max(1.0);
			expect(p.kind).toBe("float");
			expect(p.config.min).toBe(0.0);
			expect(p.config.max).toBe(1.0);
		});
	});

	describe("boolean", () => {
		test("creates a boolean param", () => {
			const p = mcp.param.boolean();
			expect(p.kind).toBe("boolean");
		});

		test("creates a boolean param with description", () => {
			const p = mcp.param.boolean("Enable feature");
			expect(p.kind).toBe("boolean");
			expect(p.config.description).toBe("Enable feature");
		});

		test("supports default modifier", () => {
			const p = mcp.param.boolean().default(true);
			expect(p.kind).toBe("boolean");
			expect(p.config.defaultValue).toBe(true);
		});
	});

	describe("array", () => {
		test("creates an array param", () => {
			const p = mcp.param.array(mcp.param.string());
			expect(p.kind).toBe("array");
			expect(p.config.inner.kind).toBe("string");
		});

		test("creates an array param with description", () => {
			const p = mcp.param.array(mcp.param.string(), "List of tags");
			expect(p.kind).toBe("array");
			expect(p.config.description).toBe("List of tags");
		});

		test("supports nested arrays", () => {
			const p = mcp.param.array(mcp.param.array(mcp.param.int()));
			expect(p.kind).toBe("array");
			expect(p.config.inner.kind).toBe("array");
		});

		test("supports default modifier", () => {
			const p = mcp.param.array(mcp.param.string()).default(["a", "b"]);
			expect(p.kind).toBe("array");
			expect(p.config.defaultValue).toEqual(["a", "b"]);
		});

		test("supports optional modifier", () => {
			const p = mcp.param.array(mcp.param.string()).optional();
			expect(p.kind).toBe("array");
			expect(p.config.optional).toBe(true);
		});

		test("supports describe modifier", () => {
			const p = mcp.param.array(mcp.param.string()).describe("Filter tags");
			expect(p.kind).toBe("array");
			expect(p.config.description).toBe("Filter tags");
		});
	});

	describe("enum", () => {
		test("creates an enum param", () => {
			const p = mcp.param.enum(["decision", "insight", "preference"] as const);
			expect(p.kind).toBe("enum");
			expect(p.config.values).toEqual(["decision", "insight", "preference"]);
		});

		test("creates an enum param with description", () => {
			const p = mcp.param.enum(["a", "b"] as const, "Type of item");
			expect(p.kind).toBe("enum");
			expect(p.config.description).toBe("Type of item");
		});

		test("supports default modifier", () => {
			const p = mcp.param.enum(["a", "b", "c"] as const).default("b");
			expect(p.kind).toBe("enum");
			expect(p.config.defaultValue).toBe("b");
		});

		test("supports optional modifier", () => {
			const p = mcp.param.enum(["a", "b"] as const).optional();
			expect(p.kind).toBe("enum");
			expect(p.config.optional).toBe(true);
		});

		test("supports describe modifier", () => {
			const p = mcp.param.enum(["a", "b"] as const).describe("Choose type");
			expect(p.kind).toBe("enum");
			expect(p.config.description).toBe("Choose type");
		});
	});

	describe("object", () => {
		test("creates an object param", () => {
			const p = mcp.param.object({
				name: mcp.param.string(),
				age: mcp.param.int(),
			});
			expect(p.kind).toBe("object");
			expect(p.config.properties.name.kind).toBe("string");
			expect(p.config.properties.age.kind).toBe("int");
		});

		test("creates an object param with description", () => {
			const p = mcp.param.object(
				{
					type: mcp.param.string(),
				},
				"Filter options",
			);
			expect(p.kind).toBe("object");
			expect(p.config.description).toBe("Filter options");
		});

		test("supports optional modifier", () => {
			const p = mcp.param
				.object({
					name: mcp.param.string(),
				})
				.optional();
			expect(p.kind).toBe("object");
			expect(p.config.optional).toBe(true);
		});

		test("supports nested objects", () => {
			const p = mcp.param.object({
				outer: mcp.param.object({
					inner: mcp.param.string(),
				}),
			});
			expect(p.kind).toBe("object");
			expect(p.config.properties.outer.kind).toBe("object");
		});
	});
});

describe("mcp.tool", () => {
	test("creates a tool with input schema", () => {
		const t = mcp.tool({
			description: "Test tool",
			input: {
				content: mcp.param.string("The content"),
			},
		});

		expect(t.description).toBe("Test tool");
		expect(t.input.content.kind).toBe("string");
		expect(t.input.content.config.description).toBe("The content");
	});

	test("creates a tool with title", () => {
		const t = mcp.tool({
			title: "Remember",
			description: "Store a memory",
			input: {
				content: mcp.param.string(),
			},
		});

		expect(t.title).toBe("Remember");
		expect(t.description).toBe("Store a memory");
	});

	test("creates a tool with output schema", () => {
		const t = mcp.tool({
			description: "Test tool",
			input: {
				query: mcp.param.string(),
			},
			output: {
				id: mcp.param.string("Created ID"),
				success: mcp.param.boolean("Success indicator"),
			},
		});

		expect(t.output?.id.kind).toBe("string");
		expect(t.output?.success.kind).toBe("boolean");
	});

	test("creates a tool with annotations", () => {
		const t = mcp.tool({
			description: "Read data",
			input: {},
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
			},
		});

		expect(t.annotations?.readOnlyHint).toBe(true);
		expect(t.annotations?.idempotentHint).toBe(true);
	});

	test("creates a complex tool definition", () => {
		const memoryTypes = ["decision", "insight", "preference", "fact", "context"] as const;

		const t = mcp.tool({
			title: "Remember",
			description: "Store a memory for future recall",
			input: {
				content: mcp.param.string("The memory content to store"),
				type: mcp.param.enum(memoryTypes, "Classification of the memory").optional(),
				tags: mcp.param.array(mcp.param.string(), "Keywords for filtering").optional(),
			},
			output: {
				id: mcp.param.string("Created memory ID"),
				stored: mcp.param.boolean("Success indicator"),
				duplicate: mcp.param.boolean("Whether this was a duplicate").optional(),
			},
		});

		expect(t.title).toBe("Remember");
		expect(t.description).toBe("Store a memory for future recall");
		expect(t.input.content.kind).toBe("string");
		expect(t.input.type.kind).toBe("enum");
		expect(t.input.type.config.optional).toBe(true);
		expect(t.input.tags.kind).toBe("array");
		expect(t.input.tags.config.optional).toBe(true);
		expect(t.output?.id.kind).toBe("string");
		expect(t.output?.stored.kind).toBe("boolean");
	});
});

describe("mcp.defineTools", () => {
	test("creates a tool collection", () => {
		const tools = mcp.defineTools({
			remember: mcp.tool({
				description: "Store a memory",
				input: {
					content: mcp.param.string(),
				},
			}),
			recall: mcp.tool({
				description: "Search memories",
				input: {
					query: mcp.param.string(),
					limit: mcp.param.int().default(5),
				},
			}),
		});

		expect(tools.remember.description).toBe("Store a memory");
		expect(tools.recall.description).toBe("Search memories");
		expect(tools.recall.input.limit.config.defaultValue).toBe(5);
	});

	test("preserves tool types in collection", () => {
		const tools = mcp.defineTools({
			tool1: mcp.tool({
				description: "Tool 1",
				input: { a: mcp.param.string() },
				output: { b: mcp.param.int() },
			}),
		});

		// Type check: ensure output is defined
		expect(tools.tool1.output?.b.kind).toBe("int");
	});
});

describe("type inference", () => {
	test("InferParamType extracts correct type from string param", () => {
		const p = mcp.param.string();
		type Inferred = InferParamType<typeof p>;
		const _typeTest: Inferred = "hello";
		expect(_typeTest).toBe("hello");
	});

	test("InferParamType extracts correct type from int param", () => {
		const p = mcp.param.int();
		type Inferred = InferParamType<typeof p>;
		const _typeTest: Inferred = 42;
		expect(_typeTest).toBe(42);
	});

	test("InferParamType extracts correct type from array param", () => {
		const p = mcp.param.array(mcp.param.string());
		type Inferred = InferParamType<typeof p>;
		const _typeTest: Inferred = ["a", "b"];
		expect(_typeTest).toEqual(["a", "b"]);
	});

	test("InferParamType extracts correct type from enum param", () => {
		const p = mcp.param.enum(["decision", "insight"] as const);
		type Inferred = InferParamType<typeof p>;
		const _typeTest: Inferred = "decision";
		expect(_typeTest).toBe("decision");
	});

	test("InferParamShape creates correct object type", () => {
		const schema = {
			name: mcp.param.string(),
			age: mcp.param.int(),
		};
		type Inferred = Simplify<InferParamShape<typeof schema>>;
		const _typeTest: Inferred = { name: "John", age: 30 };
		expect(_typeTest.name).toBe("John");
		expect(_typeTest.age).toBe(30);
	});

	test("InferParamShape handles optional params", () => {
		const schema = {
			required: mcp.param.string(),
			optional: mcp.param.string().optional(),
		};
		type Inferred = Simplify<InferParamShape<typeof schema>>;
		// Optional field can be omitted
		const _typeTest1: Inferred = { required: "test" };
		// Or included
		const _typeTest2: Inferred = { required: "test", optional: "value" };
		expect(_typeTest1.required).toBe("test");
		expect(_typeTest2.optional).toBe("value");
	});
});

describe("real-world examples", () => {
	test("defines remember tool matching current implementation", () => {
		const memoryTypes = ["decision", "context", "insight", "preference", "fact"] as const;

		const rememberTool = mcp.tool({
			title: "Remember",
			description:
				"Persist valuable information to long-term memory for future sessions. Use PROACTIVELY when you learn: user preferences, architectural decisions, project conventions, debugging insights, or facts worth preserving.",
			input: {
				content: mcp.param
					.string("The information to store. Be specific and self-contained.")
					.min(1),
				type: mcp.param
					.enum(
						memoryTypes,
						"Memory classification. 'decision': Architectural choices. 'preference': User preferences. 'insight': Debugging discoveries. 'fact': Objective information. 'context': Background for ongoing work.",
					)
					.optional(),
				tags: mcp.param
					.array(
						mcp.param.string(),
						"Keywords for filtering and discovery. Use lowercase, specific terms.",
					)
					.optional(),
			},
			output: {
				id: mcp.param.string("Created memory ID"),
				stored: mcp.param.boolean("Success indicator"),
				duplicate: mcp.param.boolean("Whether this was a duplicate").optional(),
			},
		});

		expect(rememberTool.title).toBe("Remember");
		expect(rememberTool.input.content.kind).toBe("string");
		expect(rememberTool.input.content.config.minLength).toBe(1);
		expect(rememberTool.input.type.kind).toBe("enum");
		expect(rememberTool.input.type.config.values).toContain("decision");
		expect(rememberTool.input.tags.kind).toBe("array");
		expect(rememberTool.output?.id.kind).toBe("string");
	});

	test("defines recall tool matching current implementation", () => {
		const recallTool = mcp.tool({
			title: "Recall",
			description:
				"Search past memories using semantic similarity. Use PROACTIVELY: at session start to prime yourself with relevant prior knowledge.",
			input: {
				query: mcp.param.string(
					"Natural language search query. Be descriptive - 'authentication decisions' works better than 'auth'.",
				),
				limit: mcp.param.int("Maximum number of results").min(1).max(20).default(5),
				filters: mcp.param
					.object(
						{
							type: mcp.param.enum(["decision", "turn"] as const).optional(),
							project: mcp.param.string().optional(),
							since: mcp.param.string("ISO date format").optional(),
						},
						"Optional filters",
					)
					.optional(),
				rerank: mcp.param.boolean("Enable reranking to improve result relevance").default(true),
				rerank_tier: mcp.param
					.enum(["fast", "accurate", "code", "llm"] as const, "Reranker model tier")
					.default("fast"),
			},
			output: {
				memories: mcp.param.array(
					mcp.param.object({
						id: mcp.param.string(),
						content: mcp.param.string(),
						score: mcp.param.float(),
						type: mcp.param.string(),
						created_at: mcp.param.string(),
					}),
				),
				query: mcp.param.string(),
				count: mcp.param.int(),
			},
		});

		expect(recallTool.title).toBe("Recall");
		expect(recallTool.input.query.kind).toBe("string");
		expect(recallTool.input.limit.config.min).toBe(1);
		expect(recallTool.input.limit.config.max).toBe(20);
		expect(recallTool.input.limit.config.defaultValue).toBe(5);
		expect(recallTool.input.filters.kind).toBe("object");
		expect(recallTool.input.filters.config.optional).toBe(true);
		expect(recallTool.input.rerank.config.defaultValue).toBe(true);
		expect(recallTool.output?.memories.kind).toBe("array");
	});

	test("defines complete tool collection", () => {
		const engramTools = mcp.defineTools({
			remember: mcp.tool({
				title: "Remember",
				description: "Store a memory",
				input: {
					content: mcp.param.string(),
					type: mcp.param.enum(["decision", "insight"] as const).optional(),
				},
				output: {
					id: mcp.param.string(),
					stored: mcp.param.boolean(),
				},
			}),
			recall: mcp.tool({
				title: "Recall",
				description: "Search memories",
				input: {
					query: mcp.param.string(),
					limit: mcp.param.int().default(5),
				},
				output: {
					memories: mcp.param.array(mcp.param.object({ id: mcp.param.string() })),
					count: mcp.param.int(),
				},
			}),
			query: mcp.tool({
				title: "Query",
				description: "Execute Cypher query",
				input: {
					cypher: mcp.param.string(),
					params: mcp.param.object({}).optional(),
				},
				annotations: {
					readOnlyHint: true,
				},
			}),
		});

		// Verify all tools are accessible
		expect(Object.keys(engramTools)).toHaveLength(3);
		expect(engramTools.remember.title).toBe("Remember");
		expect(engramTools.recall.title).toBe("Recall");
		expect(engramTools.query.title).toBe("Query");
		expect(engramTools.query.annotations?.readOnlyHint).toBe(true);
	});
});

describe("JSON Schema generation", () => {
	describe("paramToJsonSchema", () => {
		test("converts string param", () => {
			const schema = paramToJsonSchema(mcp.param.string("A description"));
			expect(schema).toEqual({
				type: "string",
				description: "A description",
			});
		});

		test("converts string param with constraints", () => {
			const schema = paramToJsonSchema(mcp.param.string().min(1).max(100));
			expect(schema).toEqual({
				type: "string",
				minLength: 1,
				maxLength: 100,
			});
		});

		test("converts string param with default", () => {
			const schema = paramToJsonSchema(mcp.param.string().default("hello"));
			expect(schema).toEqual({
				type: "string",
				default: "hello",
			});
		});

		test("converts int param", () => {
			const schema = paramToJsonSchema(mcp.param.int("Count"));
			expect(schema).toEqual({
				type: "integer",
				description: "Count",
			});
		});

		test("converts int param with constraints", () => {
			const schema = paramToJsonSchema(mcp.param.int().min(1).max(100).default(10));
			expect(schema).toEqual({
				type: "integer",
				minimum: 1,
				maximum: 100,
				default: 10,
			});
		});

		test("converts float param", () => {
			const schema = paramToJsonSchema(mcp.param.float("Score").min(0).max(1));
			expect(schema).toEqual({
				type: "number",
				description: "Score",
				minimum: 0,
				maximum: 1,
			});
		});

		test("converts boolean param", () => {
			const schema = paramToJsonSchema(mcp.param.boolean("Is enabled").default(true));
			expect(schema).toEqual({
				type: "boolean",
				description: "Is enabled",
				default: true,
			});
		});

		test("converts array param", () => {
			const schema = paramToJsonSchema(mcp.param.array(mcp.param.string(), "Tags"));
			expect(schema).toEqual({
				type: "array",
				description: "Tags",
				items: { type: "string" },
			});
		});

		test("converts nested array param", () => {
			const schema = paramToJsonSchema(mcp.param.array(mcp.param.array(mcp.param.int())));
			expect(schema).toEqual({
				type: "array",
				items: {
					type: "array",
					items: { type: "integer" },
				},
			});
		});

		test("converts enum param", () => {
			const schema = paramToJsonSchema(
				mcp.param.enum(["decision", "insight", "preference"] as const, "Memory type"),
			);
			expect(schema).toEqual({
				type: "string",
				description: "Memory type",
				enum: ["decision", "insight", "preference"],
			});
		});

		test("converts object param", () => {
			const schema = paramToJsonSchema(
				mcp.param.object(
					{
						name: mcp.param.string("User name"),
						age: mcp.param.int().optional(),
					},
					"User info",
				),
			);
			expect(schema).toEqual({
				type: "object",
				description: "User info",
				properties: {
					name: { type: "string", description: "User name" },
					age: { type: "integer" },
				},
				required: ["name"],
			});
		});

		test("converts nested object param", () => {
			const schema = paramToJsonSchema(
				mcp.param.object({
					outer: mcp.param.object({
						inner: mcp.param.string(),
					}),
				}),
			);
			expect(schema).toEqual({
				type: "object",
				properties: {
					outer: {
						type: "object",
						properties: {
							inner: { type: "string" },
						},
						required: ["inner"],
					},
				},
				required: ["outer"],
			});
		});
	});

	describe("paramsToJsonSchema", () => {
		test("converts params record with required tracking", () => {
			const { properties, required } = paramsToJsonSchema({
				content: mcp.param.string("Content"),
				type: mcp.param.enum(["a", "b"] as const).optional(),
				tags: mcp.param.array(mcp.param.string()).optional(),
			});

			expect(properties).toEqual({
				content: { type: "string", description: "Content" },
				type: { type: "string", enum: ["a", "b"] },
				tags: { type: "array", items: { type: "string" } },
			});
			expect(required).toEqual(["content"]);
		});

		test("handles all required params", () => {
			const { required } = paramsToJsonSchema({
				a: mcp.param.string(),
				b: mcp.param.int(),
			});
			expect(required).toEqual(["a", "b"]);
		});

		test("handles all optional params", () => {
			const { required } = paramsToJsonSchema({
				a: mcp.param.string().optional(),
				b: mcp.param.int().optional(),
			});
			expect(required).toEqual([]);
		});
	});

	describe("inputToJsonSchema", () => {
		test("creates complete JSON Schema object", () => {
			const schema = inputToJsonSchema({
				query: mcp.param.string("Search query"),
				limit: mcp.param.int().min(1).max(100).default(10),
				filters: mcp.param.object({ type: mcp.param.string() }).optional(),
			});

			expect(schema).toEqual({
				type: "object",
				properties: {
					query: { type: "string", description: "Search query" },
					limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
					filters: {
						type: "object",
						properties: { type: { type: "string" } },
						required: ["type"],
					},
				},
				required: ["query", "limit"],
			});
		});

		test("omits required array when empty", () => {
			const schema = inputToJsonSchema({
				optional: mcp.param.string().optional(),
			});

			expect(schema).toEqual({
				type: "object",
				properties: {
					optional: { type: "string" },
				},
			});
			expect(schema.required).toBeUndefined();
		});
	});

	describe("toolToRegistration", () => {
		test("converts tool to registration format", () => {
			const t = mcp.tool({
				description: "Store a memory",
				input: {
					content: mcp.param.string("The content"),
				},
				output: {
					id: mcp.param.string("Created ID"),
					success: mcp.param.boolean(),
				},
			});

			const registration = toolToRegistration("remember", t);

			expect(registration).toEqual({
				name: "remember",
				description: "Store a memory",
				inputSchema: {
					type: "object",
					properties: {
						content: { type: "string", description: "The content" },
					},
					required: ["content"],
				},
				outputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Created ID" },
						success: { type: "boolean" },
					},
					required: ["id", "success"],
				},
			});
		});

		test("includes annotations when present", () => {
			const t = mcp.tool({
				description: "Read data",
				input: {},
				annotations: {
					readOnlyHint: true,
					idempotentHint: true,
				},
			});

			const registration = toolToRegistration("query", t);

			expect(registration.annotations).toEqual({
				readOnlyHint: true,
				idempotentHint: true,
			});
		});

		test("omits outputSchema when not defined", () => {
			const t = mcp.tool({
				description: "Do something",
				input: { param: mcp.param.string() },
			});

			const registration = toolToRegistration("action", t);

			expect(registration.outputSchema).toBeUndefined();
		});
	});

	describe("toolCollectionToRegistrations", () => {
		test("converts tool collection to array of registrations", () => {
			const tools = mcp.defineTools({
				remember: mcp.tool({
					description: "Store memory",
					input: { content: mcp.param.string() },
				}),
				recall: mcp.tool({
					description: "Search memories",
					input: { query: mcp.param.string() },
				}),
			});

			const registrations = toolCollectionToRegistrations(tools);

			expect(registrations).toHaveLength(2);
			expect(registrations[0].name).toBe("remember");
			expect(registrations[0].description).toBe("Store memory");
			expect(registrations[1].name).toBe("recall");
			expect(registrations[1].description).toBe("Search memories");
		});
	});

	describe("mcp namespace exports", () => {
		test("exposes JSON Schema functions", () => {
			expect(mcp.paramToJsonSchema).toBeDefined();
			expect(mcp.paramsToJsonSchema).toBeDefined();
			expect(mcp.inputToJsonSchema).toBeDefined();
			expect(mcp.toolToRegistration).toBeDefined();
			expect(mcp.toolCollectionToRegistrations).toBeDefined();
		});

		test("JSON Schema functions work via mcp namespace", () => {
			const schema = mcp.paramToJsonSchema(mcp.param.string("Test"));
			expect(schema).toEqual({ type: "string", description: "Test" });
		});
	});
});
