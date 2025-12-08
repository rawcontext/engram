import { RawStreamEventSchema } from "@engram/events";
import { createKafkaClient } from "@engram/storage";
import { randomUUID } from "crypto";

const kafka = createKafkaClient("traffic-gen");

async function main() {
	const sessionId = randomUUID();
	console.log(`\n=== LIVE SESSION READY ===`);
	console.log(`\n🔗 URL: http://localhost:5000/session/${sessionId}`);
	console.log(`\n==========================`);
	console.log(`\n⏳ Waiting 5 seconds for you to open the browser...`);

	const producer = await kafka.getProducer();

	// Helper to create event

	const createEvent = (delta: any) => ({
		event_id: randomUUID(),

		ingest_timestamp: new Date().toISOString(),

		provider: "xai",

		headers: { "x-session-id": sessionId },

		payload: {
			id: "evt_" + Date.now(),

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
		},
	});

	console.log("\n🚀 STARTING TRAFFIC GENERATION...");

	console.log(`🔗 URL: http://localhost:5000/session/${sessionId}\n`);

	console.log(`\n⏳ Pausing 5 seconds for you to click...`);

	// Wait for user

	await new Promise((r) => setTimeout(r, 5000));

	// 1. User Message
	console.log("[1/3] Sending User Message...");
	const userPayload = createEvent({
		role: "user",
		content: "Explain how the bitemporal memory graph handles retroactive updates.",
	});
	await producer.send({
		topic: "raw_events",
		messages: [
			{ key: userPayload.event_id, value: JSON.stringify(RawStreamEventSchema.parse(userPayload)) },
		],
	});

	// Wait for "processing"
	await new Promise((r) => setTimeout(r, 2000));

	// 2. Thoughts
	console.log("[2/3] Streaming Thoughts...");
	const thoughts = [
		"Analyzing query for temporal constraints...",
		"Checking schema for 'bitemporal' nodes...",
		"Scanning ValidTime (vt) and TransactionTime (tt) indices...",
		"Simulating a retroactive correction event...",
		"Querying historical snapshots...",
		"Correlating event streams with state changes...",
		"Detecting temporal anomalies in the graph...",
		"Resolving conflicting timelines...",
		"Graph structure validated. Generating explanation...",
	];

	for (const thought of thoughts) {
		const thoughtPayload = createEvent({ content: `<thought>${thought}</thought>` });
		await producer.send({
			topic: "raw_events",
			messages: [
				{
					key: thoughtPayload.event_id,
					value: JSON.stringify(RawStreamEventSchema.parse(thoughtPayload)),
				},
			],
		});
		console.log(`   -> ${thought}`);
		await new Promise((r) => setTimeout(r, 2000));
	}

	// 3. Response
	console.log("[3/3] Streaming Response...");
	const response =
		"In our system, the bitemporal graph maintains two distinct timelines to ensure complete data integrity. Valid Time represents the period during which a fact is considered true in the real world, allowing us to model historical reality and future projections. Transaction Time, on the other hand, tracks when that fact was actually recorded in the system, providing an immutable audit log. Retroactive updates are handled by creating new versions of nodes with corrected Valid Time ranges, without overwriting the previous versions. This 'append-only' strategy preserves the full history of both the world's state and our knowledge of it, enabling precise time-travel queries and reliable reproducibility of past system states.";
	const words = response.split(" ");
	for (const word of words) {
		const wordPayload = createEvent({ content: " " + word });
		await producer.send({
			topic: "raw_events",
			messages: [
				{
					key: wordPayload.event_id,
					value: JSON.stringify(RawStreamEventSchema.parse(wordPayload)),
				},
			],
		});
		process.stdout.write(word + " ");
		await new Promise((r) => setTimeout(r, 250));
	}

	console.log("\n\n✅ Traffic generation complete!");

	await producer.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
