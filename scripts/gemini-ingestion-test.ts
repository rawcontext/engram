#!/usr/bin/env npx tsx
/**
 * Real-world integration test for the ingestion API with Google Gemini CLI
 *
 * This script:
 * 1. Runs Gemini CLI in headless mode with `--output-format stream-json`
 * 2. Captures real NDJSON streaming output
 * 3. Transforms events into RawStreamEvent format
 * 4. POSTs each event to the ingestion API at localhost:5001
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const INGESTION_URL = "http://localhost:5001/ingest";
const SESSION_ID = randomUUID();

interface GeminiStreamEvent {
	type: string;
	timestamp?: string;
	session_id?: string;
	model?: string;
	role?: string;
	content?: string;
	delta?: boolean;
	tool_name?: string;
	tool_id?: string;
	parameters?: Record<string, unknown>;
	status?: string;
	output?: string;
	stats?: {
		total_tokens: number;
		input_tokens: number;
		output_tokens: number;
		duration_ms: number;
		tool_calls: number;
	};
}

async function sendToIngestion(event: GeminiStreamEvent): Promise<void> {
	// Transform Gemini stream event into RawStreamEvent format
	const rawEvent = {
		event_id: randomUUID(),
		ingest_timestamp: new Date().toISOString(),
		provider: "gemini" as const,
		payload: event,
		headers: {
			"x-session-id": SESSION_ID,
			"x-working-dir": process.cwd(),
			"x-git-remote": "github.com/engram-labs/engram",
			"x-agent-type": "gemini",
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
				event.type === "init"
					? "🚀 init"
					: event.type === "message"
						? event.role === "user"
							? "👤 user"
							: "🤖 assistant"
						: event.type === "tool_use"
							? `🔧 tool:${event.tool_name}`
							: event.type === "tool_result"
								? `📋 result:${event.status}`
								: event.type === "result"
									? "✅ result"
									: `📦 ${event.type}`;
			console.log(`  → Ingested: ${eventType}`);
		}
	} catch (err) {
		console.error(`❌ Network error: ${err}`);
	}
}

async function runGeminiHeadless(prompt: string): Promise<void> {
	console.log("\n=== Gemini CLI Ingestion Integration Test ===\n");
	console.log(`📍 Session ID: ${SESSION_ID}`);
	console.log(`📍 Ingestion URL: ${INGESTION_URL}`);
	console.log(`📍 Prompt: "${prompt}"\n`);

	return new Promise((resolve, reject) => {
		const gemini = spawn("gemini", ["--output-format", "stream-json", "-p", prompt, "--sandbox"], {
			cwd: process.cwd(),
			env: process.env,
		});

		let eventCount = 0;
		let buffer = "";

		gemini.stdout.on("data", async (data: Buffer) => {
			buffer += data.toString();

			// Process complete JSON lines (NDJSON format)
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				if (!line.trim()) continue;
				// Skip non-JSON lines (startup logs, etc.)
				if (!line.startsWith("{")) continue;

				try {
					const event = JSON.parse(line) as GeminiStreamEvent;
					eventCount++;

					// Send to ingestion API
					await sendToIngestion(event);
				} catch (_parseErr) {
					// Silently skip non-JSON lines
				}
			}
		});

		gemini.stderr.on("data", (data: Buffer) => {
			const msg = data.toString().trim();
			// Filter out startup noise
			if (msg && !msg.includes("[STARTUP]") && !msg.includes("[ERROR]")) {
				console.error(`stderr: ${msg}`);
			}
		});

		gemini.on("close", (code) => {
			console.log(`\n✅ Gemini exited with code ${code}`);
			console.log(`📊 Total events captured: ${eventCount}`);
			console.log(`\n🔗 View session at: http://localhost:5000/session/${SESSION_ID}\n`);
			resolve();
		});

		gemini.on("error", (err) => {
			console.error(`❌ Failed to start Gemini: ${err}`);
			reject(err);
		});
	});
}

// Main execution
const prompt = process.argv[2] || "What is 2 + 2?";

runGeminiHeadless(prompt).catch(console.error);
