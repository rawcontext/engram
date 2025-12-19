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

	// Dynamic import of falkordb to avoid issues if not installed
	const { FalkorDB } = await import("falkordb");

	// Connect to FalkorDB
	console.log("Connecting to FalkorDB...");
	// Parse redis URL: redis://localhost:6379
	const url = new URL(falkorUrl);
	const db = await FalkorDB.connect({
		socket: { host: url.hostname, port: Number.parseInt(url.port) || 6379 },
	});
	const graph = db.selectGraph("engram_benchmark");

	// Create indexes
	console.log("Creating indexes...");
	await graph.query("CREATE INDEX IF NOT EXISTS FOR (s:Session) ON (s.id)");
	await graph.query("CREATE INDEX IF NOT EXISTS FOR (t:Turn) ON (t.id)");
	await graph.query("CREATE INDEX IF NOT EXISTS FOR (m:Memory) ON (m.id)");

	// Track unique sessions
	const processedSessions = new Set<string>();
	let sessionsCreated = 0;
	let turnsCreated = 0;
	let memoriesCreated = 0;

	const now = new Date().toISOString();

	// Process each instance
	for (const instance of data) {
		for (let i = 0; i < instance.haystack_sessions.length; i++) {
			const sessionId = instance.haystack_session_ids[i];
			const sessionDate = instance.haystack_dates[i];
			const session = instance.haystack_sessions[i];

			if (processedSessions.has(sessionId)) continue;
			processedSessions.add(sessionId);

			// Create Session node
			const sessionEpoch = new Date(sessionDate).getTime();
			await graph.query(`
				MERGE (s:Session {id: '${sessionId}'})
				ON CREATE SET
					s.vt_start = '${sessionDate}',
					s.vt_end = '9999-12-31T23:59:59.999Z',
					s.tt_start = '${now}',
					s.tt_end = '9999-12-31T23:59:59.999Z',
					s.started_at = ${sessionEpoch},
					s.user_id = 'longmemeval',
					s.agent_type = 'unknown'
			`);
			sessionsCreated++;

			// Process turns (pairs of user + assistant messages)
			for (let turnIdx = 0; turnIdx < session.length - 1; turnIdx += 2) {
				const userTurn = session[turnIdx];
				const assistantTurn = session[turnIdx + 1];

				if (!userTurn || userTurn.role !== "user") continue;

				const userContent = userTurn.content.replace(/'/g, "\\'").replace(/\n/g, "\\n");
				const assistantContent = (assistantTurn?.content ?? "")
					.replace(/'/g, "\\'")
					.replace(/\n/g, "\\n");
				const turnId = `turn_${sessionId}_${turnIdx}`;

				// Create Turn node
				await graph.query(`
					MERGE (t:Turn {id: '${turnId}'})
					ON CREATE SET
						t.vt_start = '${sessionDate}',
						t.vt_end = '9999-12-31T23:59:59.999Z',
						t.tt_start = '${now}',
						t.tt_end = '9999-12-31T23:59:59.999Z',
						t.user_content = '${userContent.slice(0, 2000)}',
						t.assistant_preview = '${assistantContent.slice(0, 2000)}',
						t.sequence_index = ${Math.floor(turnIdx / 2)}
				`);

				// Link Turn to Session
				await graph.query(`
					MATCH (s:Session {id: '${sessionId}'})
					MATCH (t:Turn {id: '${turnId}'})
					MERGE (s)-[:HAS_TURN]->(t)
				`);
				turnsCreated++;

				// Create Memory node
				const memoryContent = `User: ${userContent.slice(0, 1000)}\\nAssistant: ${assistantContent.slice(0, 1000)}`;
				const memoryId = `mem_${sessionId}_${turnIdx}`;

				await graph.query(`
					MERGE (m:Memory {id: '${memoryId}'})
					ON CREATE SET
						m.vt_start = '${sessionDate}',
						m.vt_end = '9999-12-31T23:59:59.999Z',
						m.tt_start = '${now}',
						m.tt_end = '9999-12-31T23:59:59.999Z',
						m.content = '${memoryContent}',
						m.type = 'turn',
						m.source_session_id = '${sessionId}',
						m.source_turn_id = '${turnId}',
						m.source = 'import'
				`);

				// Link Memory to Turn
				await graph.query(`
					MATCH (t:Turn {id: '${turnId}'})
					MATCH (m:Memory {id: '${memoryId}'})
					MERGE (t)-[:PRODUCES]->(m)
				`);
				memoriesCreated++;
			}

			if (verbose && sessionsCreated % 10 === 0) {
				console.log(`  Processed ${sessionsCreated} sessions...`);
			}
		}
	}

	console.log("\n=== Ingestion Complete ===");
	console.log(`Sessions: ${sessionsCreated}`);
	console.log(`Turns: ${turnsCreated}`);
	console.log(`Memories: ${memoriesCreated}`);
}
