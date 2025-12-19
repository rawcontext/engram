/**
 * FalkorDB Ingestion Loader for LongMemEval
 *
 * Loads LongMemEval dataset into FalkorDB as a proper bitemporal graph:
 * - SessionNode: Each conversation with timestamp
 * - TurnNode: Each user/assistant exchange
 * - MemoryNode: Extracted memories for retrieval
 *
 * This enables true Engram-style retrieval using graph traversal + vectors.
 */

import { createHash } from "crypto";
import { Graph } from "falkordb";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { LongMemEvalDataset, LongMemEvalInstance, Session } from "./types";

interface LoaderConfig {
	falkorUrl: string;
	qdrantUrl: string;
	graphName: string;
	collectionName: string;
	embedFn?: (text: string) => Promise<number[]>;
}

interface LoadResult {
	sessionsCreated: number;
	turnsCreated: number;
	memoriesCreated: number;
	vectorsIndexed: number;
}

/**
 * Generate a deterministic ID from content
 */
function generateId(prefix: string, content: string): string {
	const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
	return `${prefix}_${hash}`;
}

/**
 * Parse ISO date string to epoch timestamp
 */
function dateToEpoch(dateStr: string): number {
	return new Date(dateStr).getTime();
}

/**
 * Get current ISO timestamp
 */
function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Escape string for Cypher query
 */
function escapeString(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

/**
 * Load LongMemEval dataset into FalkorDB
 */
export async function loadToFalkor(
	dataset: LongMemEvalDataset,
	config: LoaderConfig,
): Promise<LoadResult> {
	const { falkorUrl, qdrantUrl, graphName, collectionName, embedFn } = config;

	// Connect to FalkorDB
	const graph = new Graph({ url: falkorUrl, name: graphName });

	// Connect to Qdrant
	const qdrant = new QdrantClient({ url: qdrantUrl });

	const result: LoadResult = {
		sessionsCreated: 0,
		turnsCreated: 0,
		memoriesCreated: 0,
		vectorsIndexed: 0,
	};

	// Track unique sessions (same session appears in multiple instances)
	const processedSessions = new Set<string>();

	// Create indexes for efficient queries
	await graph.query(`CREATE INDEX IF NOT EXISTS FOR (s:Session) ON (s.id)`);
	await graph.query(`CREATE INDEX IF NOT EXISTS FOR (t:Turn) ON (t.id)`);
	await graph.query(`CREATE INDEX IF NOT EXISTS FOR (m:Memory) ON (m.id)`);
	await graph.query(`CREATE INDEX IF NOT EXISTS FOR (m:Memory) ON (m.content_hash)`);

	// Ensure Qdrant collection exists
	try {
		await qdrant.getCollection(collectionName);
	} catch {
		await qdrant.createCollection(collectionName, {
			vectors: {
				size: 1024, // E5-large dimension
				distance: "Cosine",
			},
		});
	}

	// Process each instance
	for (const instance of dataset) {
		await processInstance(instance, graph, qdrant, config, processedSessions, result);
	}

	console.log(
		`Loaded ${result.sessionsCreated} sessions, ${result.turnsCreated} turns, ${result.memoriesCreated} memories`,
	);
	return result;
}

/**
 * Process a single LongMemEval instance
 */
async function processInstance(
	instance: LongMemEvalInstance,
	graph: Graph,
	qdrant: QdrantClient,
	config: LoaderConfig,
	processedSessions: Set<string>,
	result: LoadResult,
): Promise<void> {
	const { collectionName, embedFn } = config;

	for (let i = 0; i < instance.haystack_sessions.length; i++) {
		const sessionId = instance.haystack_session_ids[i];
		const sessionDate = instance.haystack_dates[i];
		const session = instance.haystack_sessions[i];

		// Skip if already processed
		if (processedSessions.has(sessionId)) {
			continue;
		}
		processedSessions.add(sessionId);

		// Create Session node
		const sessionEpoch = dateToEpoch(sessionDate);
		const now = nowIso();

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
		result.sessionsCreated++;

		// Process turns
		for (let turnIdx = 0; turnIdx < session.length - 1; turnIdx += 2) {
			const userTurn = session[turnIdx];
			const assistantTurn = session[turnIdx + 1];

			if (!userTurn || userTurn.role !== "user") continue;

			const userContent = userTurn.content;
			const assistantContent = assistantTurn?.content ?? "";
			const turnId = generateId("turn", `${sessionId}_${turnIdx}`);
			const contentHash = createHash("sha256")
				.update(userContent + assistantContent)
				.digest("hex");

			// Create Turn node
			await graph.query(`
				MERGE (t:Turn {id: '${turnId}'})
				ON CREATE SET
					t.vt_start = '${sessionDate}',
					t.vt_end = '9999-12-31T23:59:59.999Z',
					t.tt_start = '${now}',
					t.tt_end = '9999-12-31T23:59:59.999Z',
					t.user_content = '${escapeString(userContent.slice(0, 2000))}',
					t.user_content_hash = '${contentHash}',
					t.assistant_preview = '${escapeString(assistantContent.slice(0, 2000))}',
					t.sequence_index = ${Math.floor(turnIdx / 2)},
					t.files_touched = [],
					t.tool_calls_count = 0
			`);

			// Link Turn to Session
			await graph.query(`
				MATCH (s:Session {id: '${sessionId}'})
				MATCH (t:Turn {id: '${turnId}'})
				MERGE (s)-[:HAS_TURN]->(t)
			`);
			result.turnsCreated++;

			// Create Memory node from the turn (for retrieval)
			const memoryContent = `User: ${userContent}\nAssistant: ${assistantContent}`;
			const memoryId = generateId("mem", `${sessionId}_${turnIdx}`);
			const memoryHash = createHash("sha256").update(memoryContent).digest("hex");

			await graph.query(`
				MERGE (m:Memory {id: '${memoryId}'})
				ON CREATE SET
					m.vt_start = '${sessionDate}',
					m.vt_end = '9999-12-31T23:59:59.999Z',
					m.tt_start = '${now}',
					m.tt_end = '9999-12-31T23:59:59.999Z',
					m.content = '${escapeString(memoryContent.slice(0, 4000))}',
					m.content_hash = '${memoryHash}',
					m.type = 'turn',
					m.tags = [],
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
			result.memoriesCreated++;

			// Index to Qdrant if embedding function provided
			if (embedFn) {
				const embedding = await embedFn(memoryContent);
				await qdrant.upsert(collectionName, {
					points: [
						{
							id: memoryId,
							vector: embedding,
							payload: {
								session_id: sessionId,
								turn_id: turnId,
								content: memoryContent.slice(0, 1000),
								content_hash: memoryHash,
								vt_start: sessionDate,
								type: "turn",
							},
						},
					],
				});
				result.vectorsIndexed++;
			}
		}
	}
}

/**
 * Clear all benchmark data from FalkorDB and Qdrant
 */
export async function clearBenchmarkData(config: LoaderConfig): Promise<void> {
	const graph = new Graph({ url: config.falkorUrl, name: config.graphName });
	const qdrant = new QdrantClient({ url: config.qdrantUrl });

	// Delete all nodes and relationships
	await graph.query("MATCH (n) DETACH DELETE n");

	// Delete Qdrant collection if exists
	try {
		await qdrant.deleteCollection(config.collectionName);
	} catch {
		// Collection doesn't exist, that's fine
	}

	console.log("Cleared all benchmark data from FalkorDB and Qdrant");
}
