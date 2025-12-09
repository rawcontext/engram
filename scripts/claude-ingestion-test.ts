#!/usr/bin/env npx tsx
/**
 * Real-world integration test for the ingestion API
 *
 * This script:
 * 1. Runs Claude Code in headless mode with --output-format stream-json
 * 2. Captures real streaming output (thinking, tool calls, content, usage)
 * 3. Transforms events into RawStreamEvent format
 * 4. POSTs each event to the ingestion API at localhost:5001
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const INGESTION_URL = "http://localhost:5001/ingest";
const SESSION_ID = randomUUID();

interface ClaudeStreamEvent {
	type: string;
	subtype?: string;
	message?: {
		id: string;
		type: string;
		role: string;
		model: string;
		content: Array<{
			type: string;
			text?: string;
			id?: string;
			name?: string;
			input?: Record<string, unknown>;
		}>;
		usage?: {
			input_tokens: number;
			output_tokens: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	};
	tool_use?: {
		tool_use_id: string;
		name: string;
		input: Record<string, unknown>;
	};
	tool_result?: {
		tool_use_id: string;
		content: string;
	};
	session_id?: string;
	uuid?: string;
	usage?: Record<string, unknown>;
	result?: string;
	duration_ms?: number;
}

async function sendToIngestion(event: ClaudeStreamEvent): Promise<void> {
	// Transform Claude Code stream event into RawStreamEvent format
	const rawEvent = {
		event_id: event.uuid || randomUUID(),
		ingest_timestamp: new Date().toISOString(),
		provider: "claude_code" as const,
		payload: event,
		headers: {
			"x-session-id": SESSION_ID,
			"x-working-dir": process.cwd(),
			"x-git-remote": "github.com/the-system/engram",
			"x-agent-type": "claude-code",
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
			const eventType = event.type === "assistant" ? "🤖 assistant" :
				event.type === "system" ? `⚙️ system:${event.subtype}` :
				event.type === "result" ? "✅ result" :
				event.type === "tool_use" ? `🔧 tool:${event.tool_use?.name}` :
				event.type === "tool_result" ? "📋 tool_result" :
				`📦 ${event.type}`;
			console.log(`  → Ingested: ${eventType}`);
		}
	} catch (err) {
		console.error(`❌ Network error: ${err}`);
	}
}

async function runClaudeHeadless(prompt: string): Promise<void> {
	console.log("\n=== Claude Code Ingestion Integration Test ===\n");
	console.log(`📍 Session ID: ${SESSION_ID}`);
	console.log(`📍 Ingestion URL: ${INGESTION_URL}`);
	console.log(`📍 Prompt: "${prompt}"\n`);

	return new Promise((resolve, reject) => {
		const claude = spawn("claude", [
			"-p", prompt,
			"--output-format", "stream-json",
			"--verbose",
			"--max-turns", "2",
			"--allowedTools", "Read,Glob,Grep",
		], {
			cwd: process.cwd(),
			env: process.env,
		});

		let eventCount = 0;
		let buffer = "";

		claude.stdout.on("data", async (data: Buffer) => {
			buffer += data.toString();

			// Process complete JSON lines
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				if (!line.trim()) continue;

				try {
					const event = JSON.parse(line) as ClaudeStreamEvent;
					eventCount++;

					// Send to ingestion API
					await sendToIngestion(event);
				} catch (parseErr) {
					console.error(`⚠️ Failed to parse: ${line.slice(0, 100)}...`);
				}
			}
		});

		claude.stderr.on("data", (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) console.error(`stderr: ${msg}`);
		});

		claude.on("close", (code) => {
			console.log(`\n✅ Claude exited with code ${code}`);
			console.log(`📊 Total events captured: ${eventCount}`);
			console.log(`\n🔗 View session at: http://localhost:5000/session/${SESSION_ID}\n`);
			resolve();
		});

		claude.on("error", (err) => {
			console.error(`❌ Failed to start Claude: ${err}`);
			reject(err);
		});
	});
}

// Main execution
const prompt = process.argv[2] || "Read the package.json file in the current directory and tell me what the project name is.";

runClaudeHeadless(prompt).catch(console.error);
