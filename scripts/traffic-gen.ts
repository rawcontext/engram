import { randomUUID } from "node:crypto";
import { RawStreamEventSchema } from "@engram/events";
import { createKafkaClient } from "@engram/storage";

const kafka = createKafkaClient("traffic-gen");

// Simulated project context
const PROJECT_CONTEXT = {
	working_dir: "/Users/demo/Projects/my-app",
	git_remote: "github.com/demo/my-app",
	agent_type: "claude-code",
};

async function main() {
	const sessionId = randomUUID();
	console.log(`\n=== LIVE SESSION READY ===`);
	console.log(`\n🔗 URL: http://localhost:5000/session/${sessionId}`);
	console.log(`\nProject: ${PROJECT_CONTEXT.git_remote}`);
	console.log(`Agent: ${PROJECT_CONTEXT.agent_type}`);
	console.log(`\n==========================`);

	const producer = await kafka.getProducer();

	// Helper to create raw event (OpenAI SSE format)
	const createRawEvent = (delta: Record<string, unknown>, metadata?: Record<string, unknown>) => ({
		event_id: randomUUID(),
		ingest_timestamp: new Date().toISOString(),
		provider: "xai" as const,
		headers: {
			"x-session-id": sessionId,
			"x-working-dir": PROJECT_CONTEXT.working_dir,
			"x-git-remote": PROJECT_CONTEXT.git_remote,
			"x-agent-type": PROJECT_CONTEXT.agent_type,
		},
		payload: {
			id: `evt_${Date.now()}`,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: "gpt-4",
			choices: [
				{
					index: 0,
					delta,
					finish_reason: null,
				},
			],
			...(metadata || {}),
		},
	});

	// Helper to send event
	const sendEvent = async (event: ReturnType<typeof createRawEvent>) => {
		await producer.send({
			topic: "raw_events",
			messages: [{ key: event.event_id, value: JSON.stringify(RawStreamEventSchema.parse(event)) }],
		});
	};

	console.log("\n🚀 STARTING TRAFFIC GENERATION...");
	console.log(`\n⏳ Pausing 3 seconds for you to open browser...`);
	await new Promise((r) => setTimeout(r, 3000));

	// ============================================================
	// TURN 1: Simple question about the codebase
	// ============================================================
	console.log("\n📝 TURN 1: User asks about auth implementation");

	// User message (starts new Turn)
	console.log("[1] User message...");
	await sendEvent(
		createRawEvent({
			role: "user",
			content: "How is authentication implemented in this codebase?",
		}),
	);
	await new Promise((r) => setTimeout(r, 1000));

	// Thinking blocks (creates Reasoning nodes)
	console.log("[2] Streaming thinking...");
	const thinkingBlocks = [
		"Let me search for authentication-related files in the codebase.",
		"I should look for common auth patterns: JWT, session-based, OAuth.",
		"Checking for middleware, guards, or decorators that handle auth.",
	];

	for (const thought of thinkingBlocks) {
		await sendEvent(createRawEvent({ content: `<thinking>${thought}</thinking>` }));
		console.log(`   💭 ${thought}`);
		await new Promise((r) => setTimeout(r, 800));
	}

	// Tool calls (creates FileTouch nodes)
	console.log("[3] Tool calls (file operations)...");

	// Glob tool call
	await sendEvent(
		createRawEvent({
			tool_calls: [
				{
					index: 0,
					id: `call_${randomUUID().slice(0, 8)}`,
					type: "function",
					function: {
						name: "Glob",
						arguments: '{"pattern": "**/auth/**/*.ts"}',
					},
				},
			],
		}),
	);
	console.log('   🔧 Glob: "**/auth/**/*.ts"');
	await new Promise((r) => setTimeout(r, 500));

	// Read tool calls for specific files
	const filesToRead = [
		"src/auth/jwt.service.ts",
		"src/auth/guards/auth.guard.ts",
		"src/auth/strategies/local.strategy.ts",
	];

	for (const file of filesToRead) {
		await sendEvent(
			createRawEvent({
				tool_calls: [
					{
						index: 0,
						id: `call_${randomUUID().slice(0, 8)}`,
						type: "function",
						function: {
							name: "Read",
							arguments: JSON.stringify({ file_path: file }),
						},
					},
				],
			}),
		);
		console.log(`   📖 Read: ${file}`);
		await new Promise((r) => setTimeout(r, 400));
	}

	// Assistant response
	console.log("[4] Streaming response...");
	const response1 =
		"Based on my analysis, authentication in this codebase uses JWT (JSON Web Tokens) with a NestJS guard pattern. The `JwtService` handles token generation and validation, while `AuthGuard` protects routes. User credentials are verified against a PostgreSQL database using bcrypt for password hashing.";

	for (const word of response1.split(" ")) {
		await sendEvent(createRawEvent({ role: "assistant", content: ` ${word}` }));
		process.stdout.write(`${word} `);
		await new Promise((r) => setTimeout(r, 50));
	}
	console.log();

	// Usage event (signals end of turn)
	await sendEvent(
		createRawEvent(
			{},
			{
				usage: {
					prompt_tokens: 1250,
					completion_tokens: 89,
					total_tokens: 1339,
				},
			},
		),
	);
	console.log("   ✅ Turn 1 complete (usage event sent)");

	await new Promise((r) => setTimeout(r, 2000));

	// ============================================================
	// TURN 2: Follow-up with code edit
	// ============================================================
	console.log("\n📝 TURN 2: User requests a code change");

	// User message
	console.log("[1] User message...");
	await sendEvent(
		createRawEvent({
			role: "user",
			content: "Add rate limiting to the login endpoint to prevent brute force attacks.",
		}),
	);
	await new Promise((r) => setTimeout(r, 1000));

	// Thinking
	console.log("[2] Streaming thinking...");
	const thinking2 = [
		"Rate limiting can be implemented at different levels: application, middleware, or infrastructure.",
		"For NestJS, @nestjs/throttler is the standard approach.",
		"I'll add the ThrottlerGuard to the login endpoint with sensible defaults.",
	];

	for (const thought of thinking2) {
		await sendEvent(createRawEvent({ content: `<thinking>${thought}</thinking>` }));
		console.log(`   💭 ${thought}`);
		await new Promise((r) => setTimeout(r, 600));
	}

	// Read the file first
	console.log("[3] Reading file to edit...");
	await sendEvent(
		createRawEvent({
			tool_calls: [
				{
					index: 0,
					id: `call_${randomUUID().slice(0, 8)}`,
					type: "function",
					function: {
						name: "Read",
						arguments: '{"file_path": "src/auth/auth.controller.ts"}',
					},
				},
			],
		}),
	);
	console.log("   📖 Read: src/auth/auth.controller.ts");
	await new Promise((r) => setTimeout(r, 500));

	// Edit the file
	console.log("[4] Editing file...");
	await sendEvent(
		createRawEvent({
			tool_calls: [
				{
					index: 0,
					id: `call_${randomUUID().slice(0, 8)}`,
					type: "function",
					function: {
						name: "Edit",
						arguments: JSON.stringify({
							file_path: "src/auth/auth.controller.ts",
							old_string: "@Post('login')",
							new_string: "@Throttle({ default: { limit: 5, ttl: 60000 } })\n  @Post('login')",
						}),
					},
				},
			],
		}),
	);
	console.log("   ✏️ Edit: src/auth/auth.controller.ts");
	await new Promise((r) => setTimeout(r, 500));

	// Response
	console.log("[5] Streaming response...");
	const response2 =
		"I've added rate limiting to the login endpoint using @nestjs/throttler. The configuration allows 5 login attempts per minute per IP address. If exceeded, users will receive a 429 Too Many Requests response.";

	for (const word of response2.split(" ")) {
		await sendEvent(createRawEvent({ role: "assistant", content: ` ${word}` }));
		process.stdout.write(`${word} `);
		await new Promise((r) => setTimeout(r, 50));
	}
	console.log();

	// Usage event
	await sendEvent(
		createRawEvent(
			{},
			{
				usage: {
					prompt_tokens: 2100,
					completion_tokens: 156,
					total_tokens: 2256,
				},
			},
		),
	);
	console.log("   ✅ Turn 2 complete (usage event sent)");

	await new Promise((r) => setTimeout(r, 2000));

	// ============================================================
	// TURN 3: Quick question (minimal tools)
	// ============================================================
	console.log("\n📝 TURN 3: Quick follow-up question");

	await sendEvent(
		createRawEvent({
			role: "user",
			content: "Should I also add rate limiting to the registration endpoint?",
		}),
	);
	await new Promise((r) => setTimeout(r, 800));

	// Brief thinking
	await sendEvent(
		createRawEvent({
			content:
				"<thinking>Registration endpoints are also common targets for abuse - spam accounts, enumeration attacks.</thinking>",
		}),
	);
	console.log("   💭 Brief thinking...");
	await new Promise((r) => setTimeout(r, 500));

	// Quick response
	const response3 =
		"Yes, I recommend adding rate limiting to registration as well. Use a slightly more lenient limit like 10 requests per minute, since legitimate users might retry on validation errors.";

	for (const word of response3.split(" ")) {
		await sendEvent(createRawEvent({ role: "assistant", content: ` ${word}` }));
		process.stdout.write(`${word} `);
		await new Promise((r) => setTimeout(r, 40));
	}
	console.log();

	// Usage event
	await sendEvent(
		createRawEvent(
			{},
			{
				usage: {
					prompt_tokens: 2400,
					completion_tokens: 42,
					total_tokens: 2442,
				},
			},
		),
	);
	console.log("   ✅ Turn 3 complete");

	console.log("\n\n✅ Traffic generation complete!");
	console.log(`\n📊 Generated: 3 turns, multiple reasoning blocks, multiple file touches`);
	console.log(`🔗 View at: http://localhost:5000/session/${sessionId}\n`);

	await producer.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
