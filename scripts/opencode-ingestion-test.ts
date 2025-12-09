#!/usr/bin/env npx tsx
/**
 * Real-world integration test for the ingestion API with SST OpenCode CLI
 *
 * This script:
 * 1. Runs OpenCode CLI with `--format json`
 * 2. Captures real NDJSON streaming output
 * 3. Transforms events into RawStreamEvent format
 * 4. POSTs each event to the ingestion API at localhost:5001
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const INGESTION_URL = "http://localhost:5001/ingest";
const SESSION_ID = randomUUID();

interface OpenCodeStreamEvent {
	type: string;
	timestamp?: number;
	sessionID?: string;
	part?: {
		id?: string;
		sessionID?: string;
		messageID?: string;
		type?: string;
		text?: string;
		callID?: string;
		tool?: string;
		state?: {
			status?: string;
			input?: Record<string, unknown>;
			output?: string;
		};
		reason?: string;
		cost?: number;
		tokens?: {
			input: number;
			output: number;
			reasoning?: number;
			cache?: { read: number; write: number };
		};
		time?: { start: number; end: number };
	};
}

async function sendToIngestion(event: OpenCodeStreamEvent): Promise<void> {
	// Transform OpenCode stream event into RawStreamEvent format
	const rawEvent = {
		event_id: randomUUID(),
		ingest_timestamp: new Date().toISOString(),
		provider: "opencode" as const,
		payload: event,
		headers: {
			"x-session-id": SESSION_ID,
			"x-working-dir": process.cwd(),
			"x-git-remote": "github.com/the-system/engram",
			"x-agent-type": "opencode",
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
			console.error(`  Ingestion failed: ${response.status} - ${error}`);
		} else {
			const eventType =
				event.type === "step_start"
					? "-> step_start"
					: event.type === "text"
						? `<- text: "${(event.part?.text || "").slice(0, 40)}..."`
						: event.type === "tool_use"
							? `<> tool: ${event.part?.tool}`
							: event.type === "step_finish"
								? `<= step_finish (${event.part?.reason})`
								: `-- ${event.type}`;
			console.log(`  Ingested: ${eventType}`);
		}
	} catch (err) {
		console.error(`  Network error: ${err}`);
	}
}

async function runOpenCodeHeadless(prompt: string): Promise<void> {
	console.log("\n=== OpenCode CLI Ingestion Integration Test ===\n");
	console.log(`Session ID: ${SESSION_ID}`);
	console.log(`Ingestion URL: ${INGESTION_URL}`);
	console.log(`Prompt: "${prompt}"\n`);

	return new Promise((resolve, reject) => {
		const opencode = spawn(
			"/Users/ccheney/.opencode/bin/opencode",
			["run", "--format", "json", prompt],
			{
				cwd: process.cwd(),
				env: process.env,
			},
		);

		let eventCount = 0;
		let buffer = "";

		opencode.stdout.on("data", async (data: Buffer) => {
			buffer += data.toString();

			// Process complete JSON lines (NDJSON format)
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				if (!line.trim()) continue;
				// Skip non-JSON lines
				if (!line.startsWith("{")) continue;

				try {
					const event = JSON.parse(line) as OpenCodeStreamEvent;
					eventCount++;

					// Send to ingestion API
					await sendToIngestion(event);
				} catch (_parseErr) {
					// Silently skip non-JSON lines
				}
			}
		});

		opencode.stderr.on("data", (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) {
				console.error(`stderr: ${msg}`);
			}
		});

		opencode.on("close", (code) => {
			console.log(`\nOpenCode exited with code ${code}`);
			console.log(`Total events captured: ${eventCount}`);
			console.log(`\nView session at: http://localhost:5000/session/${SESSION_ID}\n`);
			resolve();
		});

		opencode.on("error", (err) => {
			console.error(`Failed to start OpenCode: ${err}`);
			reject(err);
		});
	});
}

// Main execution
const prompt = process.argv[2] || "What is 2 + 2?";

runOpenCodeHeadless(prompt).catch(console.error);
