/**
 * Comprehensive Traffic Generator for Engram
 *
 * Generates realistic AI agent traffic to exercise all Engram subsystems:
 * - Ingestion pipeline (raw events → parsed events)
 * - Parser strategies (OpenAI, Anthropic, Claude Code, xAI, Gemini, Codex)
 * - Memory service (Turn aggregation, Reasoning, ToolCall, DiffHunk nodes)
 * - Graph storage (FalkorDB with bitemporal fields)
 * - Search pipeline (Qdrant vector embeddings)
 *
 * Usage:
 *   npx tsx scripts/traffic-gen.ts [--provider <name>] [--turns <n>] [--delay <ms>]
 *
 * Options:
 *   --provider   Provider to simulate: openai, anthropic, claude_code, xai, all (default: all)
 *   --turns      Number of turns per session (default: 5)
 *   --delay      Delay between events in ms (default: 100)
 */

import { randomUUID } from "node:crypto";
import { generateEventId, type RawStreamEvent, RawStreamEventSchema } from "@engram/events";
import { createNatsClient } from "@engram/storage";

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name: string, defaultValue: string) => {
	const idx = args.indexOf(`--${name}`);
	return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
};

const PROVIDER = getArg("provider", "all");
const TURNS = parseInt(getArg("turns", "5"), 10);
const DELAY = parseInt(getArg("delay", "100"), 10);

const nats = createNatsClient("traffic-gen");

// =============================================================================
// Project Context - Simulates a real development session
// =============================================================================
const PROJECT_CONTEXTS = [
	{
		working_dir: "/Users/demo/Projects/my-app",
		git_remote: "github.com/demo/my-app",
		agent_type: "claude-code",
	},
	{
		working_dir: "/home/dev/code/api-server",
		git_remote: "github.com/org/api-server",
		agent_type: "codex",
	},
	{
		working_dir: "/workspace/frontend",
		git_remote: "gitlab.com/team/frontend",
		agent_type: "opencode",
	},
];

// =============================================================================
// Realistic Conversation Scenarios
// =============================================================================
const SCENARIOS = [
	{
		title: "Authentication Implementation",
		turns: [
			{
				user: "How is authentication implemented in this codebase?",
				thinking: [
					"Let me search for authentication-related files in the codebase.",
					"I should look for common auth patterns: JWT, session-based, OAuth.",
					"Checking for middleware, guards, or decorators that handle auth.",
				],
				tools: [
					{ name: "Glob", args: { pattern: "**/auth/**/*.ts" } },
					{ name: "Read", args: { file_path: "src/auth/jwt.service.ts" } },
					{ name: "Read", args: { file_path: "src/auth/guards/auth.guard.ts" } },
				],
				response:
					"Based on my analysis, authentication uses JWT with a NestJS guard pattern. The `JwtService` handles token generation and validation, while `AuthGuard` protects routes. User credentials are verified against PostgreSQL using bcrypt for password hashing.",
			},
			{
				user: "Add rate limiting to the login endpoint to prevent brute force attacks.",
				thinking: [
					"Rate limiting can be implemented at different levels: application, middleware, or infrastructure.",
					"For NestJS, @nestjs/throttler is the standard approach.",
					"I'll add the ThrottlerGuard to the login endpoint with sensible defaults.",
				],
				tools: [
					{ name: "Read", args: { file_path: "src/auth/auth.controller.ts" } },
					{
						name: "Edit",
						args: {
							file_path: "src/auth/auth.controller.ts",
							old_string: "@Post('login')",
							new_string: "@Throttle({ default: { limit: 5, ttl: 60000 } })\n  @Post('login')",
						},
					},
				],
				diff: {
					file: "src/auth/auth.controller.ts",
					hunk: `@@ -12,6 +12,7 @@
 import { AuthService } from './auth.service';
 import { LoginDto } from './dto/login.dto';
+import { Throttle } from '@nestjs/throttler';

 @Controller('auth')
 export class AuthController {`,
				},
				response:
					"I've added rate limiting to the login endpoint using @nestjs/throttler. The configuration allows 5 login attempts per minute per IP address. If exceeded, users will receive a 429 Too Many Requests response.",
			},
		],
	},
	{
		title: "Database Query Optimization",
		turns: [
			{
				user: "The user list page is loading slowly. Can you investigate?",
				thinking: [
					"Slow page loads often indicate N+1 queries or missing indexes.",
					"I should check the database queries being executed.",
					"Let me look at the user repository and controller.",
				],
				tools: [
					{ name: "Grep", args: { pattern: "findAll|getUsers", glob: "**/*.ts" } },
					{ name: "Read", args: { file_path: "src/users/users.repository.ts" } },
					{ name: "Bash", args: { command: "npm run db:explain -- users" } },
				],
				response:
					"I found the issue. The `findAll` method is loading user relationships eagerly without pagination. The query is fetching all users with their associated roles and permissions in separate queries (N+1 problem). I recommend adding pagination and using a JOIN instead.",
			},
			{
				user: "Fix the N+1 query issue",
				thinking: [
					"I need to modify the repository to use eager loading with relations.",
					"TypeORM supports leftJoinAndSelect for this purpose.",
					"I should also add pagination to prevent loading too many records.",
				],
				tools: [
					{
						name: "Edit",
						args: {
							file_path: "src/users/users.repository.ts",
							old_string: "async findAll(): Promise<User[]> {\n    return this.find();",
							new_string: `async findAll(page = 1, limit = 20): Promise<User[]> {
    return this.createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('user.permissions', 'permission')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();`,
						},
					},
				],
				diff: {
					file: "src/users/users.repository.ts",
					hunk: `@@ -15,8 +15,14 @@
 export class UsersRepository extends Repository<User> {

-  async findAll(): Promise<User[]> {
-    return this.find();
+  async findAll(page = 1, limit = 20): Promise<User[]> {
+    return this.createQueryBuilder('user')
+      .leftJoinAndSelect('user.roles', 'role')
+      .leftJoinAndSelect('user.permissions', 'permission')
+      .skip((page - 1) * limit)
+      .take(limit)
+      .getMany();
   }`,
				},
				response:
					"Fixed! The repository now uses a single optimized query with JOINs and pagination. This eliminates the N+1 problem and limits results to 20 users per page by default.",
			},
		],
	},
	{
		title: "Test Coverage Improvement",
		turns: [
			{
				user: "Run the test suite and show me the coverage report",
				thinking: [
					"I need to run the test command with coverage enabled.",
					"Most Node.js projects use jest or bun:test for testing.",
				],
				tools: [{ name: "Bash", args: { command: "npm test -- --coverage" } }],
				response:
					"Test suite completed. Current coverage:\n- Statements: 67%\n- Branches: 54%\n- Functions: 72%\n- Lines: 68%\n\nThe lowest coverage is in `src/payments/` (34%) and `src/notifications/` (41%).",
			},
			{
				user: "Add tests for the payment service",
				thinking: [
					"Let me first understand the payment service structure.",
					"I need to identify the main methods and their expected behaviors.",
					"Mock dependencies like the payment gateway.",
				],
				tools: [
					{ name: "Read", args: { file_path: "src/payments/payment.service.ts" } },
					{
						name: "Write",
						args: {
							file_path: "src/payments/payment.service.spec.ts",
							content:
								'import { PaymentService } from "./payment.service";\n\ndescribe("PaymentService", () => {\n  // tests here\n});',
						},
					},
				],
				response:
					"Created a comprehensive test suite for PaymentService covering:\n- `processPayment()` - success and failure cases\n- `refundPayment()` - full and partial refunds\n- `getPaymentHistory()` - pagination and filtering\n- Webhook handling for async payment events",
			},
		],
	},
	{
		title: "API Endpoint Development",
		turns: [
			{
				user: "Create a new REST endpoint for managing user preferences",
				thinking: [
					"I need to create a new controller and service for preferences.",
					"Should follow REST conventions: GET, PUT for preferences.",
					"Need DTO validation and proper error handling.",
				],
				tools: [
					{
						name: "Write",
						args: {
							file_path: "src/preferences/preferences.controller.ts",
							content:
								'import { Controller, Get, Put, Body } from "@nestjs/common";\n\n@Controller("preferences")\nexport class PreferencesController {}',
						},
					},
					{
						name: "Write",
						args: {
							file_path: "src/preferences/preferences.service.ts",
							content:
								'import { Injectable } from "@nestjs/common";\n\n@Injectable()\nexport class PreferencesService {}',
						},
					},
					{
						name: "Write",
						args: {
							file_path: "src/preferences/dto/update-preferences.dto.ts",
							content:
								'export class UpdatePreferencesDto {\n  theme?: "light" | "dark";\n  notifications?: boolean;\n}',
						},
					},
				],
				response:
					"Created the preferences module with:\n- `PreferencesController` with GET/PUT endpoints\n- `PreferencesService` for business logic\n- `UpdatePreferencesDto` with validation\n\nRemember to add the module to `AppModule` imports.",
			},
		],
	},
];

// =============================================================================
// Provider-Specific Event Generators
// =============================================================================

interface EventContext {
	sessionId: string;
	headers: Record<string, string>;
}

async function sendRawEvent(event: RawStreamEvent): Promise<void> {
	const producer = await nats.getProducer();
	const validated = RawStreamEventSchema.parse(event);
	await producer.send({
		topic: "raw_events",
		messages: [{ key: validated.event_id, value: JSON.stringify(validated) }],
	});
}

function createBaseEvent(
	provider: RawStreamEvent["provider"],
	payload: Record<string, unknown>,
	headers: Record<string, string>,
): RawStreamEvent {
	const now = Date.now();
	return {
		event_id: generateEventId(),
		ingest_timestamp: new Date().toISOString(),
		provider,
		payload,
		headers,
		vt_start: now,
		vt_end: 253402300799000,
		tt_start: now,
		tt_end: 253402300799000,
	};
}

// -----------------------------------------------------------------------------
// OpenAI Format Generator
// -----------------------------------------------------------------------------
async function generateOpenAIEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	// User message
	await sendRawEvent(
		createBaseEvent(
			"openai",
			{
				id: `chatcmpl-${randomUUID().slice(0, 8)}`,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: "gpt-4o",
				choices: [{ index: 0, delta: { role: "user", content: turn.user }, finish_reason: null }],
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Assistant content (streamed)
	const words = turn.response.split(" ");
	for (const word of words) {
		await sendRawEvent(
			createBaseEvent(
				"openai",
				{
					id: `chatcmpl-${randomUUID().slice(0, 8)}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "gpt-4o",
					choices: [{ index: 0, delta: { content: ` ${word}` }, finish_reason: null }],
				},
				ctx.headers,
			),
		);
		await delay(20);
	}

	// Tool calls
	for (const tool of turn.tools) {
		await sendRawEvent(
			createBaseEvent(
				"openai",
				{
					id: `chatcmpl-${randomUUID().slice(0, 8)}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "gpt-4o",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: `call_${randomUUID().slice(0, 12)}`,
										type: "function",
										function: {
											name: tool.name,
											arguments: JSON.stringify(tool.args),
										},
									},
								],
							},
							finish_reason: null,
						},
					],
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Usage
	await sendRawEvent(
		createBaseEvent(
			"openai",
			{
				id: `chatcmpl-${randomUUID().slice(0, 8)}`,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: "gpt-4o",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: Math.floor(Math.random() * 1000) + 500,
					completion_tokens: Math.floor(Math.random() * 500) + 100,
					total_tokens: Math.floor(Math.random() * 1500) + 600,
				},
			},
			ctx.headers,
		),
	);
}

// -----------------------------------------------------------------------------
// Anthropic Format Generator
// -----------------------------------------------------------------------------
async function generateAnthropicEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	// Message start
	await sendRawEvent(
		createBaseEvent(
			"anthropic",
			{
				type: "message_start",
				message: {
					id: `msg_${randomUUID().slice(0, 12)}`,
					type: "message",
					role: "assistant",
					model: "claude-sonnet-4-20250514",
					usage: { input_tokens: Math.floor(Math.random() * 1000) + 500 },
				},
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// User message as content block
	await sendRawEvent(
		createBaseEvent(
			"anthropic",
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: turn.user },
			},
			{ ...ctx.headers, "x-role": "user" },
		),
	);
	await delay(DELAY);

	// Thinking blocks
	for (let i = 0; i < turn.thinking.length; i++) {
		await sendRawEvent(
			createBaseEvent(
				"anthropic",
				{
					type: "content_block_delta",
					index: i + 1,
					delta: { type: "text_delta", text: `<thinking>${turn.thinking[i]}</thinking>` },
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Response content
	const words = turn.response.split(" ");
	for (const word of words) {
		await sendRawEvent(
			createBaseEvent(
				"anthropic",
				{
					type: "content_block_delta",
					index: turn.thinking.length + 1,
					delta: { type: "text_delta", text: ` ${word}` },
				},
				ctx.headers,
			),
		);
		await delay(20);
	}

	// Tool use blocks
	for (let i = 0; i < turn.tools.length; i++) {
		const tool = turn.tools[i];
		// Start tool use
		await sendRawEvent(
			createBaseEvent(
				"anthropic",
				{
					type: "content_block_start",
					index: turn.thinking.length + 2 + i,
					content_block: {
						type: "tool_use",
						id: `toolu_${randomUUID().slice(0, 12)}`,
						name: tool.name,
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY / 2);

		// Tool arguments
		await sendRawEvent(
			createBaseEvent(
				"anthropic",
				{
					type: "content_block_delta",
					index: turn.thinking.length + 2 + i,
					delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.args) },
				},
				ctx.headers,
			),
		);
		await delay(DELAY);

		// Content block stop
		await sendRawEvent(
			createBaseEvent(
				"anthropic",
				{
					type: "content_block_stop",
					index: turn.thinking.length + 2 + i,
				},
				ctx.headers,
			),
		);
		await delay(DELAY / 2);
	}

	// Message delta (final usage)
	await sendRawEvent(
		createBaseEvent(
			"anthropic",
			{
				type: "message_delta",
				usage: { output_tokens: Math.floor(Math.random() * 500) + 100 },
				delta: { stop_reason: "end_turn" },
			},
			ctx.headers,
		),
	);
}

// -----------------------------------------------------------------------------
// Claude Code Format Generator
// -----------------------------------------------------------------------------
async function generateClaudeCodeEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	// System init
	await sendRawEvent(
		createBaseEvent(
			"claude_code",
			{
				type: "system",
				subtype: "init",
				model: "claude-sonnet-4-20250514",
				tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "Task", "TodoWrite"],
				session_id: ctx.sessionId,
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// User message handled via system subtype
	await sendRawEvent(
		createBaseEvent(
			"claude_code",
			{
				type: "system",
				subtype: "user",
				stdout: turn.user,
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Tool uses
	for (const tool of turn.tools) {
		await sendRawEvent(
			createBaseEvent(
				"claude_code",
				{
					type: "tool_use",
					tool_use: {
						tool_use_id: `toolu_${randomUUID().slice(0, 12)}`,
						name: tool.name,
						input: tool.args,
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY);

		// Tool result
		await sendRawEvent(
			createBaseEvent(
				"claude_code",
				{
					type: "tool_result",
					tool_result: {
						tool_use_id: `toolu_${randomUUID().slice(0, 12)}`,
						content:
							tool.name === "Read"
								? "// File contents here..."
								: tool.name === "Edit"
									? "Successfully edited file"
									: "Tool executed successfully",
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Assistant message
	await sendRawEvent(
		createBaseEvent(
			"claude_code",
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: turn.response }],
					usage: {
						input_tokens: Math.floor(Math.random() * 2000) + 1000,
						output_tokens: Math.floor(Math.random() * 800) + 200,
						cache_read_input_tokens: Math.floor(Math.random() * 500),
						cache_creation_input_tokens: Math.floor(Math.random() * 100),
					},
					model: "claude-sonnet-4-20250514",
					stop_reason: "end_turn",
				},
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Result event
	await sendRawEvent(
		createBaseEvent(
			"claude_code",
			{
				type: "result",
				result: turn.response,
				subtype: "success",
				usage: {
					input_tokens: Math.floor(Math.random() * 2000) + 1000,
					output_tokens: Math.floor(Math.random() * 800) + 200,
				},
				total_cost_usd: Math.random() * 0.05,
				duration_ms: Math.floor(Math.random() * 5000) + 1000,
				duration_api_ms: Math.floor(Math.random() * 4000) + 500,
				session_id: ctx.sessionId,
			},
			ctx.headers,
		),
	);
}

// -----------------------------------------------------------------------------
// xAI (Grok) Format Generator - OpenAI-compatible with reasoning_content
// -----------------------------------------------------------------------------
async function generateXAIEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	// User message
	await sendRawEvent(
		createBaseEvent(
			"xai",
			{
				id: `chatcmpl-${randomUUID().slice(0, 8)}`,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: "grok-3",
				choices: [{ index: 0, delta: { role: "user", content: turn.user }, finish_reason: null }],
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Reasoning content (xAI-specific field)
	for (const thought of turn.thinking) {
		await sendRawEvent(
			createBaseEvent(
				"xai",
				{
					id: `chatcmpl-${randomUUID().slice(0, 8)}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "grok-3",
					choices: [
						{
							index: 0,
							delta: { reasoning_content: thought },
							finish_reason: null,
						},
					],
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Tool calls
	for (const tool of turn.tools) {
		await sendRawEvent(
			createBaseEvent(
				"xai",
				{
					id: `chatcmpl-${randomUUID().slice(0, 8)}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "grok-3",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: `call_${randomUUID().slice(0, 12)}`,
										type: "function",
										function: { name: tool.name, arguments: JSON.stringify(tool.args) },
									},
								],
							},
							finish_reason: null,
						},
					],
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Response content
	const words = turn.response.split(" ");
	for (const word of words) {
		await sendRawEvent(
			createBaseEvent(
				"xai",
				{
					id: `chatcmpl-${randomUUID().slice(0, 8)}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: "grok-3",
					choices: [{ index: 0, delta: { content: ` ${word}` }, finish_reason: null }],
				},
				ctx.headers,
			),
		);
		await delay(20);
	}

	// Final with usage
	await sendRawEvent(
		createBaseEvent(
			"xai",
			{
				id: `chatcmpl-${randomUUID().slice(0, 8)}`,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: "grok-3",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: Math.floor(Math.random() * 1500) + 800,
					completion_tokens: Math.floor(Math.random() * 600) + 150,
					total_tokens: Math.floor(Math.random() * 2100) + 950,
				},
			},
			ctx.headers,
		),
	);
}

// -----------------------------------------------------------------------------
// Gemini (Google) Format Generator
// -----------------------------------------------------------------------------
async function generateGeminiEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	// Init event
	await sendRawEvent(
		createBaseEvent(
			"gemini",
			{
				type: "init",
				timestamp: new Date().toISOString(),
				session_id: ctx.sessionId,
				model: "gemini-3-flash-preview",
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// User message
	await sendRawEvent(
		createBaseEvent(
			"gemini",
			{
				type: "message",
				timestamp: new Date().toISOString(),
				role: "user",
				content: turn.user,
				delta: false,
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Tool uses
	for (const tool of turn.tools) {
		const toolId = `tool_${randomUUID().slice(0, 8)}`;
		await sendRawEvent(
			createBaseEvent(
				"gemini",
				{
					type: "tool_use",
					timestamp: new Date().toISOString(),
					tool_name: tool.name,
					tool_id: toolId,
					parameters: tool.args,
				},
				ctx.headers,
			),
		);
		await delay(DELAY);

		// Tool result
		await sendRawEvent(
			createBaseEvent(
				"gemini",
				{
					type: "tool_result",
					timestamp: new Date().toISOString(),
					tool_id: toolId,
					status: "success",
					output:
						tool.name === "Read"
							? "// File contents..."
							: tool.name === "Edit"
								? "File updated successfully"
								: "Tool completed",
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Assistant response (streamed in deltas)
	const words = turn.response.split(" ");
	for (const word of words) {
		await sendRawEvent(
			createBaseEvent(
				"gemini",
				{
					type: "message",
					timestamp: new Date().toISOString(),
					role: "assistant",
					content: ` ${word}`,
					delta: true,
				},
				ctx.headers,
			),
		);
		await delay(20);
	}

	// Result event (final stats)
	await sendRawEvent(
		createBaseEvent(
			"gemini",
			{
				type: "result",
				timestamp: new Date().toISOString(),
				status: "completed",
				stats: {
					total_tokens: Math.floor(Math.random() * 2000) + 1000,
					input_tokens: Math.floor(Math.random() * 1200) + 600,
					output_tokens: Math.floor(Math.random() * 800) + 200,
					duration_ms: Math.floor(Math.random() * 4000) + 1000,
					tool_calls: turn.tools.length,
				},
			},
			ctx.headers,
		),
	);
}

// -----------------------------------------------------------------------------
// Codex (OpenAI) Format Generator
// -----------------------------------------------------------------------------
async function generateCodexEvents(
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
): Promise<void> {
	const threadId = `thread_${randomUUID().slice(0, 12)}`;

	// Thread started
	await sendRawEvent(
		createBaseEvent(
			"codex",
			{
				type: "thread.started",
				thread_id: threadId,
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Turn started
	await sendRawEvent(
		createBaseEvent(
			"codex",
			{
				type: "turn.started",
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Reasoning item
	for (const thought of turn.thinking) {
		const itemId = `item_${randomUUID().slice(0, 8)}`;
		await sendRawEvent(
			createBaseEvent(
				"codex",
				{
					type: "item.started",
					item: {
						id: itemId,
						type: "reasoning",
						text: thought,
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY / 2);

		await sendRawEvent(
			createBaseEvent(
				"codex",
				{
					type: "item.completed",
					item: {
						id: itemId,
						type: "reasoning",
						text: thought,
						status: "completed",
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Command execution items (for tools)
	for (const tool of turn.tools) {
		const itemId = `item_${randomUUID().slice(0, 8)}`;
		const command =
			tool.name === "Bash"
				? (tool.args as { command?: string }).command || "echo 'done'"
				: `${tool.name.toLowerCase()} ${JSON.stringify(tool.args)}`;

		await sendRawEvent(
			createBaseEvent(
				"codex",
				{
					type: "item.started",
					item: {
						id: itemId,
						type: "command_execution",
						command,
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY);

		await sendRawEvent(
			createBaseEvent(
				"codex",
				{
					type: "item.completed",
					item: {
						id: itemId,
						type: "command_execution",
						command,
						aggregated_output: "Command executed successfully",
						exit_code: 0,
						status: "completed",
					},
				},
				ctx.headers,
			),
		);
		await delay(DELAY);
	}

	// Agent message (final response)
	const messageItemId = `item_${randomUUID().slice(0, 8)}`;
	await sendRawEvent(
		createBaseEvent(
			"codex",
			{
				type: "item.started",
				item: {
					id: messageItemId,
					type: "agent_message",
					text: turn.response,
				},
			},
			ctx.headers,
		),
	);
	await delay(DELAY / 2);

	await sendRawEvent(
		createBaseEvent(
			"codex",
			{
				type: "item.completed",
				item: {
					id: messageItemId,
					type: "agent_message",
					text: turn.response,
					status: "completed",
				},
			},
			ctx.headers,
		),
	);
	await delay(DELAY);

	// Turn completed with usage
	await sendRawEvent(
		createBaseEvent(
			"codex",
			{
				type: "turn.completed",
				usage: {
					input_tokens: Math.floor(Math.random() * 1500) + 800,
					output_tokens: Math.floor(Math.random() * 600) + 200,
					cached_input_tokens: Math.floor(Math.random() * 300),
				},
			},
			ctx.headers,
		),
	);
}

// =============================================================================
// Session Orchestrator
// =============================================================================

type ProviderGenerator = (
	ctx: EventContext,
	turn: (typeof SCENARIOS)[0]["turns"][0],
) => Promise<void>;

const PROVIDERS: Record<string, { name: string; generator: ProviderGenerator }> = {
	openai: { name: "OpenAI GPT-4o", generator: generateOpenAIEvents },
	anthropic: { name: "Anthropic Claude", generator: generateAnthropicEvents },
	claude_code: { name: "Claude Code", generator: generateClaudeCodeEvents },
	xai: { name: "xAI Grok", generator: generateXAIEvents },
	gemini: { name: "Google Gemini", generator: generateGeminiEvents },
	codex: { name: "OpenAI Codex", generator: generateCodexEvents },
};

async function runSession(
	providerKey: string,
	scenario: (typeof SCENARIOS)[0],
	projectContext: (typeof PROJECT_CONTEXTS)[0],
): Promise<string> {
	const provider = PROVIDERS[providerKey];
	if (!provider) throw new Error(`Unknown provider: ${providerKey}`);

	const sessionId = randomUUID();
	const headers = {
		"x-session-id": sessionId,
		"x-working-dir": projectContext.working_dir,
		"x-git-remote": projectContext.git_remote,
		"x-agent-type": projectContext.agent_type,
	};

	const ctx: EventContext = { sessionId, headers };

	console.log(`\n${"=".repeat(60)}`);
	console.log(`SESSION: ${scenario.title}`);
	console.log(`Provider: ${provider.name}`);
	console.log(`Session ID: ${sessionId}`);
	console.log(`Project: ${projectContext.git_remote}`);
	console.log(`URL: http://localhost:5000/session/${sessionId}`);
	console.log("=".repeat(60));

	const turnsToRun = scenario.turns.slice(0, TURNS);

	for (let i = 0; i < turnsToRun.length; i++) {
		const turn = turnsToRun[i];
		console.log(`\n--- Turn ${i + 1}/${turnsToRun.length} ---`);
		console.log(`User: ${turn.user.slice(0, 60)}...`);
		console.log(`Tools: ${turn.tools.map((t) => t.name).join(", ")}`);

		await provider.generator(ctx, turn);

		console.log(`Response: ${turn.response.slice(0, 60)}...`);
		await delay(500); // Pause between turns
	}

	console.log(`\n[Session complete: ${turnsToRun.length} turns]`);
	return sessionId;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
	console.log(`\n${"=".repeat(60)}`);
	console.log("ENGRAM TRAFFIC GENERATOR");
	console.log("=".repeat(60));
	console.log(`Provider: ${PROVIDER}`);
	console.log(`Turns per session: ${TURNS}`);
	console.log(`Event delay: ${DELAY}ms`);
	console.log("=".repeat(60));

	const producer = await nats.getProducer();
	console.log("\nNATS producer connected");

	const sessionIds: string[] = [];

	if (PROVIDER === "all") {
		// Run all providers with different scenarios
		const providerKeys = Object.keys(PROVIDERS);
		for (let i = 0; i < providerKeys.length; i++) {
			const providerKey = providerKeys[i];
			const scenario = SCENARIOS[i % SCENARIOS.length];
			const projectContext = PROJECT_CONTEXTS[i % PROJECT_CONTEXTS.length];
			const sessionId = await runSession(providerKey, scenario, projectContext);
			sessionIds.push(sessionId);
			await delay(1000); // Pause between sessions
		}
	} else {
		// Run single provider with first scenario
		const scenario = SCENARIOS[0];
		const projectContext = PROJECT_CONTEXTS[0];
		const sessionId = await runSession(PROVIDER, scenario, projectContext);
		sessionIds.push(sessionId);
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log("TRAFFIC GENERATION COMPLETE");
	console.log("=".repeat(60));
	console.log(`Sessions created: ${sessionIds.length}`);
	console.log("\nSession URLs:");
	for (const id of sessionIds) {
		console.log(`  http://localhost:5000/session/${id}`);
	}
	console.log("=".repeat(60));

	await producer.disconnect();
	process.exit(0);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
