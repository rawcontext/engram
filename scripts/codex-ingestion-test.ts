#!/usr/bin/env npx tsx
/**
 * Real-world integration test for the ingestion API with OpenAI Codex CLI
 *
 * This script:
 * 1. Runs Codex CLI in headless mode with `codex exec --json`
 * 2. Captures real NDJSON streaming output
 * 3. Transforms events into RawStreamEvent format
 * 4. POSTs each event to the ingestion API at localhost:5001
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const INGESTION_URL = "http://localhost:5001/ingest";
const SESSION_ID = randomUUID();

interface CodexStreamEvent {
	type: string;
	thread_id?: string;
	item?: {
		id: string;
		type: string;
		text?: string;
		command?: string;
		aggregated_output?: string;
		exit_code?: number | null;
		status?: string;
	};
	usage?: {
		input_tokens: number;
		cached_input_tokens?: number;
		output_tokens: number;
	};
}

async function sendToIngestion(event: CodexStreamEvent): Promise<void> {
	// Transform Codex stream event into RawStreamEvent format
	const rawEvent = {
		event_id: randomUUID(),
		ingest_timestamp: new Date().toISOString(),
		provider: "codex" as const,
		payload: event,
		headers: {
			"x-session-id": SESSION_ID,
			"x-working-dir": process.cwd(),
			"x-git-remote": "github.com/ccheney/engram",
			"x-agent-type": "codex",
		},
	};

	try {
		const response = await fetch(INGESTION_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rawEvent),
		});

		if (!response.ok) {
			const error = await response.text();
			console.error(`❌ Ingestion failed: ${response.status} - ${error}`);
		} else {
			const eventType =
				event.type === "thread.started"
					? "🧵 thread.started"
					: event.type === "turn.started"
						? "🔄 turn.started"
						: event.type === "turn.completed"
							? "✅ turn.completed"
							: event.type === "item.started"
								? `⏳ item.started:${event.item?.type}`
								: event.type === "item.completed"
									? event.item?.type === "reasoning"
										? "🧠 reasoning"
										: event.item?.type === "agent_message"
											? "💬 agent_message"
											: event.item?.type === "command_execution"
												? `🔧 command:${event.item?.command?.slice(0, 30)}`
												: `📦 item:${event.item?.type}`
									: `📦 ${event.type}`;
			console.log(`  → Ingested: ${eventType}`);
		}
	} catch (err) {
		console.error(`❌ Network error: ${err}`);
	}
}

async function runCodexHeadless(prompt: string): Promise<void> {
	console.log("\n=== Codex CLI Ingestion Integration Test ===\n");
	console.log(`📍 Session ID: ${SESSION_ID}`);
	console.log(`📍 Ingestion URL: ${INGESTION_URL}`);
	console.log(`📍 Prompt: "${prompt}"\n`);

	return new Promise((resolve, reject) => {
		const codex = spawn("codex", ["exec", "--json", prompt], {
			cwd: process.cwd(),
			env: process.env,
		});

		let eventCount = 0;
		let buffer = "";

		codex.stdout.on("data", async (data: Buffer) => {
			buffer += data.toString();

			// Process complete JSON lines (NDJSON format)
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				if (!line.trim()) continue;

				try {
					const event = JSON.parse(line) as CodexStreamEvent;
					eventCount++;

					// Send to ingestion API
					await sendToIngestion(event);
				} catch (_parseErr) {
					console.error(`⚠️ Failed to parse: ${line.slice(0, 100)}...`);
				}
			}
		});

		codex.stderr.on("data", (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) console.error(`stderr: ${msg}`);
		});

		codex.on("close", (code) => {
			console.log(`\n✅ Codex exited with code ${code}`);
			console.log(`📊 Total events captured: ${eventCount}`);
			console.log(`\n🔗 View session at: http://localhost:5000/session/${SESSION_ID}\n`);
			resolve();
		});

		codex.on("error", (err) => {
			console.error(`❌ Failed to start Codex: ${err}`);
			reject(err);
		});
	});
}

// Main execution
const prompt = process.argv[2] || "What is 2 + 2?";

runCodexHeadless(prompt).catch(console.error);
