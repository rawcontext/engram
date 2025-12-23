/**
 * Initialize NATS JetStream streams for Engram.
 *
 * Run with: bun run scripts/init-nats-streams.ts
 */

import { jetstreamManager, type StreamConfig } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";

const streams: StreamConfig[] = [
	{
		name: "EVENTS",
		subjects: ["events.>"],
		retention: "limits",
		storage: "file",
		max_age: 24 * 60 * 60 * 1_000_000_000, // 24 hours in nanoseconds
		description: "Agent event streams (raw and parsed)",
	},
	{
		name: "MEMORY",
		subjects: ["memory.>"],
		retention: "workqueue",
		storage: "file",
		description: "Memory service events (turns, nodes)",
	},
	{
		name: "DLQ",
		subjects: ["dlq.>"],
		retention: "limits",
		storage: "file",
		max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
		description: "Dead letter queue for failed messages",
	},
];

async function initStreams() {
	const url = process.env.NATS_URL || "nats://localhost:4222";
	console.log(`Connecting to NATS at ${url}...`);

	const nc = await connect({ servers: url });
	const jsm = await jetstreamManager(nc);

	console.log("Connected. Initializing streams...\n");

	for (const config of streams) {
		try {
			// Check if stream exists
			const existing = await jsm.streams.info(config.name).catch(() => null);

			if (existing) {
				console.log(`  [exists] ${config.name} (${config.subjects?.join(", ")})`);
				// Update configuration if needed
				await jsm.streams.update(config.name, config);
			} else {
				await jsm.streams.add(config);
				console.log(`  [created] ${config.name} (${config.subjects?.join(", ")})`);
			}
		} catch (err) {
			console.error(`  [error] ${config.name}: ${(err as Error).message}`);
		}
	}

	console.log("\nStreams initialized successfully.");

	// List all streams
	console.log("\nCurrent streams:");
	for await (const si of jsm.streams.list()) {
		console.log(`  - ${si.config.name}: ${si.state.messages} messages, ${si.state.bytes} bytes`);
	}

	await nc.close();
}

initStreams().catch((err) => {
	console.error("Failed to initialize streams:", err);
	process.exit(1);
});
