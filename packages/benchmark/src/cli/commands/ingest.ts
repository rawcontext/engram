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

			// Create Session node - single line query
			const sessionEpoch = new Date(sessionDate).getTime();
			const sessionQuery = `MERGE (s:Session {id: '${sessionId}'}) ON CREATE SET s.vt_start = '${sessionDate}', s.vt_end = '9999-12-31T23:59:59.999Z', s.tt_start = '${now}', s.tt_end = '9999-12-31T23:59:59.999Z', s.started_at = ${sessionEpoch}, s.user_id = 'longmemeval', s.agent_type = 'unknown'`;
			await graph.query(sessionQuery);
			sessionsCreated++;

			// Process turns (pairs of user + assistant messages)
			for (let turnIdx = 0; turnIdx < session.length - 1; turnIdx += 2) {
				const userTurn = session[turnIdx];
				const assistantTurn = session[turnIdx + 1];

				if (!userTurn || userTurn.role !== "user") continue;

				// Escape content for Cypher - replace backslash first, then quotes
				const escapeForCypher = (s: string) =>
					s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ").replace(/\r/g, "");

				const userContent = escapeForCypher(userTurn.content).slice(0, 500);
				const assistantContent = escapeForCypher(assistantTurn?.content ?? "").slice(0, 500);
				const turnId = `turn_${sessionId}_${turnIdx}`;

				// Create Turn node
				const turnQuery = `MERGE (t:Turn {id: '${turnId}'}) ON CREATE SET t.vt_start = '${sessionDate}', t.vt_end = '9999-12-31T23:59:59.999Z', t.tt_start = '${now}', t.tt_end = '9999-12-31T23:59:59.999Z', t.user_content = '${userContent}', t.assistant_preview = '${assistantContent}', t.sequence_index = ${Math.floor(turnIdx / 2)}`;
				await graph.query(turnQuery);

				// Link Turn to Session
				await graph.query(
					`MATCH (s:Session {id: '${sessionId}'}), (t:Turn {id: '${turnId}'}) MERGE (s)-[:HAS_TURN]->(t)`,
				);
				turnsCreated++;

				// Create Memory node
				const memoryContent = escapeForCypher(
					`User: ${userTurn.content.slice(0, 200)} Assistant: ${(assistantTurn?.content ?? "").slice(0, 200)}`,
				);
				const memoryId = `mem_${sessionId}_${turnIdx}`;

				const memoryQuery = `MERGE (m:Memory {id: '${memoryId}'}) ON CREATE SET m.vt_start = '${sessionDate}', m.vt_end = '9999-12-31T23:59:59.999Z', m.tt_start = '${now}', m.tt_end = '9999-12-31T23:59:59.999Z', m.content = '${memoryContent}', m.type = 'turn', m.source_session_id = '${sessionId}', m.source_turn_id = '${turnId}', m.source = 'import'`;
				await graph.query(memoryQuery);

				// Link Memory to Turn
				await graph.query(
					`MATCH (t:Turn {id: '${turnId}'}), (m:Memory {id: '${memoryId}'}) MERGE (t)-[:PRODUCES]->(m)`,
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
}
