/**
 * Ingest command - loads LongMemEval dataset into FalkorDB
 */

import { readFile } from "node:fs/promises";
import { LongMemEvalDatasetSchema } from "../../longmemeval/types.js";

interface IngestOptions {
	dataset: string;
	falkorUrl: string;
	qdrantUrl: string;
	embeddingModel: string;
	clear: boolean;
	verbose: boolean;
}

export async function ingestCommand(options: IngestOptions): Promise<void> {
	const { dataset, falkorUrl, verbose } = options;

	console.log("=== Engram Benchmark Data Ingestion ===");
	console.log(`Dataset: ${dataset}`);
	console.log(`FalkorDB: ${falkorUrl}`);
	console.log("");

	// Load and parse dataset
	console.log("Loading dataset...");
	const raw = await readFile(dataset, "utf-8");
	const data = LongMemEvalDatasetSchema.parse(JSON.parse(raw));
	console.log(`Loaded ${data.length} instances\n`);

	// Dynamic import of falkordb
	const { FalkorDB } = await import("falkordb");

	// Connect to FalkorDB
	console.log("Connecting to FalkorDB...");
	const url = new URL(falkorUrl);
	const db = await FalkorDB.connect({
		socket: { host: url.hostname, port: Number.parseInt(url.port) || 6379 },
	});
	const graph = db.selectGraph("engram_benchmark");

	// Create indexes (FalkorDB syntax)
	console.log("Creating indexes...");
	try {
		await graph.query("CREATE INDEX FOR (s:Session) ON (s.id)");
	} catch {
		/* exists */
	}
	try {
		await graph.query("CREATE INDEX FOR (t:Turn) ON (t.id)");
	} catch {
		/* exists */
	}
	try {
		await graph.query("CREATE INDEX FOR (m:Memory) ON (m.id)");
	} catch {
		/* exists */
	}

	// Track unique sessions
	const processedSessions = new Set<string>();
	let sessionsCreated = 0;
	let turnsCreated = 0;
	let memoriesCreated = 0;

	const now = new Date().toISOString();

	// Process each instance
	console.log("Processing instances...");
	for (const instance of data) {
		for (let i = 0; i < instance.haystack_sessions.length; i++) {
			const sessionId = instance.haystack_session_ids[i];
			const sessionDate = instance.haystack_dates[i];
			const session = instance.haystack_sessions[i];

			if (processedSessions.has(sessionId)) continue;
			processedSessions.add(sessionId);

			// Create Session node using parameterized query
			const sessionEpoch = new Date(sessionDate).getTime();
			await graph.query(
				`MERGE (s:Session {id: $id}) ON CREATE SET s.vt_start = $vtStart, s.vt_end = $vtEnd, s.tt_start = $ttStart, s.tt_end = $ttEnd, s.started_at = $startedAt, s.user_id = $userId, s.agent_type = $agentType`,
				{
					params: {
						id: sessionId,
						vtStart: sessionDate,
						vtEnd: "9999-12-31T23:59:59.999Z",
						ttStart: now,
						ttEnd: "9999-12-31T23:59:59.999Z",
						startedAt: sessionEpoch,
						userId: "longmemeval",
						agentType: "unknown",
					},
				},
			);
			sessionsCreated++;

			// Process turns (pairs of user + assistant messages)
			for (let turnIdx = 0; turnIdx < session.length - 1; turnIdx += 2) {
				const userTurn = session[turnIdx];
				const assistantTurn = session[turnIdx + 1];

				if (!userTurn || userTurn.role !== "user") continue;

				const userContent = userTurn.content.slice(0, 500);
				const assistantContent = (assistantTurn?.content ?? "").slice(0, 500);
				const turnId = `turn_${sessionId}_${turnIdx}`;

				// Create Turn node using parameterized query
				await graph.query(
					`MERGE (t:Turn {id: $id}) ON CREATE SET t.vt_start = $vtStart, t.vt_end = $vtEnd, t.tt_start = $ttStart, t.tt_end = $ttEnd, t.user_content = $userContent, t.assistant_preview = $assistantPreview, t.sequence_index = $seqIdx`,
					{
						params: {
							id: turnId,
							vtStart: sessionDate,
							vtEnd: "9999-12-31T23:59:59.999Z",
							ttStart: now,
							ttEnd: "9999-12-31T23:59:59.999Z",
							userContent,
							assistantPreview: assistantContent,
							seqIdx: Math.floor(turnIdx / 2),
						},
					},
				);

				// Link Turn to Session
				await graph.query(
					`MATCH (s:Session {id: $sid}), (t:Turn {id: $tid}) MERGE (s)-[:HAS_TURN]->(t)`,
					{
						params: { sid: sessionId, tid: turnId },
					},
				);
				turnsCreated++;

				// Create Memory node
				const memoryContent = `User: ${userTurn.content.slice(0, 200)} Assistant: ${(assistantTurn?.content ?? "").slice(0, 200)}`;
				const memoryId = `mem_${sessionId}_${turnIdx}`;

				await graph.query(
					`MERGE (m:Memory {id: $id}) ON CREATE SET m.vt_start = $vtStart, m.vt_end = $vtEnd, m.tt_start = $ttStart, m.tt_end = $ttEnd, m.content = $content, m.type = $type, m.source_session_id = $srcSession, m.source_turn_id = $srcTurn, m.source = $source`,
					{
						params: {
							id: memoryId,
							vtStart: sessionDate,
							vtEnd: "9999-12-31T23:59:59.999Z",
							ttStart: now,
							ttEnd: "9999-12-31T23:59:59.999Z",
							content: memoryContent,
							type: "turn",
							srcSession: sessionId,
							srcTurn: turnId,
							source: "import",
						},
					},
				);

				// Link Memory to Turn
				await graph.query(
					`MATCH (t:Turn {id: $tid}), (m:Memory {id: $mid}) MERGE (t)-[:PRODUCES]->(m)`,
					{
						params: { tid: turnId, mid: memoryId },
					},
				);
				memoriesCreated++;
			}

			if (verbose && sessionsCreated % 50 === 0) {
				console.log(`  Processed ${sessionsCreated} sessions...`);
			}
		}
	}

	console.log("\n=== Ingestion Complete ===");
	console.log(`Sessions: ${sessionsCreated}`);
	console.log(`Turns: ${turnsCreated}`);
	console.log(`Memories: ${memoriesCreated}`);

	// Close connection so process exits
	await db.close();
}
