import type { ParsedInstance, ParsedSession, ParsedTurn } from "./types.js";

/**
 * Configuration for mapping LongMemEval data to Engram format
 */
export interface MapperConfig {
	/** Granularity for indexing (turn is recommended by LongMemEval paper) */
	granularity: "session" | "turn";
	/** Whether to include assistant turns in embeddings */
	includeAssistant: boolean;
}

/**
 * Default mapper configuration based on LongMemEval findings
 * - Turn granularity is optimal (Finding 1 from paper)
 * - Include both user and assistant (recommended setting)
 */
export const DEFAULT_MAPPER_CONFIG: MapperConfig = {
	granularity: "turn",
	includeAssistant: true,
};

/**
 * Represents a document ready for indexing in Engram
 */
export interface EngramDocument {
	/** Unique identifier */
	id: string;
	/** Instance this document belongs to */
	instanceId: string;
	/** Original session ID from LongMemEval */
	sessionId: string;
	/** Content to embed */
	content: string;
	/** Valid time - when this conversation occurred */
	validTime: Date;
	/** Metadata for filtering and evaluation */
	metadata: EngramDocumentMetadata;
}

export interface EngramDocumentMetadata {
	/** Original question ID */
	questionId: string;
	/** Role of the speaker */
	role: "user" | "assistant" | "combined";
	/** Whether this document contains answer evidence */
	hasAnswer: boolean;
	/** Turn index within the session */
	turnIndex?: number;
	/** Session index within the instance */
	sessionIndex: number;
}

/**
 * Result of mapping an instance to Engram documents
 */
export interface MappedInstance {
	/** The original parsed instance */
	instance: ParsedInstance;
	/** Documents ready for indexing */
	documents: EngramDocument[];
	/** Evidence document IDs for evaluation */
	evidenceDocIds: string[];
}

/**
 * Maps a LongMemEval instance to Engram documents
 */
export function mapInstance(
	instance: ParsedInstance,
	config: MapperConfig = DEFAULT_MAPPER_CONFIG,
): MappedInstance {
	const documents: EngramDocument[] = [];
	const evidenceDocIds: string[] = [];

	for (let sessionIndex = 0; sessionIndex < instance.sessions.length; sessionIndex++) {
		const session = instance.sessions[sessionIndex];
		const sessionDocs = mapSession(instance.questionId, session, sessionIndex, config);

		documents.push(...sessionDocs);

		// Track evidence documents
		for (const doc of sessionDocs) {
			if (doc.metadata.hasAnswer) {
				evidenceDocIds.push(doc.id);
			}
		}
	}

	return {
		instance,
		documents,
		evidenceDocIds,
	};
}

/**
 * Maps a session to Engram documents based on granularity
 */
function mapSession(
	questionId: string,
	session: ParsedSession,
	sessionIndex: number,
	config: MapperConfig,
): EngramDocument[] {
	if (config.granularity === "session") {
		return [mapSessionAsDocument(questionId, session, sessionIndex, config)];
	}

	return mapTurnsAsDocuments(questionId, session, sessionIndex, config);
}

/**
 * Maps an entire session as a single document
 */
function mapSessionAsDocument(
	questionId: string,
	session: ParsedSession,
	sessionIndex: number,
	config: MapperConfig,
): EngramDocument {
	const relevantTurns = config.includeAssistant
		? session.turns
		: session.turns.filter((t) => t.role === "user");

	const content = relevantTurns.map((t) => `${t.role}: ${t.content}`).join("\n\n");

	const hasAnswer = session.turns.some((t) => t.hasAnswer);

	return {
		id: `${questionId}:${session.sessionId}`,
		instanceId: questionId,
		sessionId: session.sessionId,
		content,
		validTime: session.timestamp,
		metadata: {
			questionId,
			role: "combined",
			hasAnswer,
			sessionIndex,
		},
	};
}

/**
 * Maps each turn as a separate document (recommended by LongMemEval)
 */
function mapTurnsAsDocuments(
	questionId: string,
	session: ParsedSession,
	sessionIndex: number,
	config: MapperConfig,
): EngramDocument[] {
	const documents: EngramDocument[] = [];

	for (const turn of session.turns) {
		// Skip assistant turns if not included
		if (!config.includeAssistant && turn.role === "assistant") {
			continue;
		}

		documents.push({
			id: `${questionId}:${session.sessionId}:${turn.sequenceIndex}`,
			instanceId: questionId,
			sessionId: session.sessionId,
			content: turn.content,
			validTime: session.timestamp,
			metadata: {
				questionId,
				role: turn.role,
				hasAnswer: turn.hasAnswer,
				turnIndex: turn.sequenceIndex,
				sessionIndex,
			},
		});
	}

	return documents;
}

/**
 * Formats documents for retrieval context
 * Uses structured JSON format (recommended by LongMemEval)
 */
export function formatDocumentsForContext(
	documents: EngramDocument[],
	options: { includeTimestamp?: boolean; maxLength?: number } = {},
): string {
	const { includeTimestamp = true, maxLength } = options;

	const formatted = documents.map((doc, index) => {
		const entry: Record<string, unknown> = {
			index: index + 1,
			content: doc.content,
		};

		if (includeTimestamp) {
			entry.date = doc.validTime.toISOString().split("T")[0];
		}

		if (doc.metadata.role !== "combined") {
			entry.role = doc.metadata.role;
		}

		return entry;
	});

	let result = JSON.stringify(formatted, null, 2);

	// Truncate if needed
	if (maxLength && result.length > maxLength) {
		result = result.slice(0, maxLength) + "\n... (truncated)";
	}

	return result;
}

/**
 * Groups documents by session for session-level evaluation
 */
export function groupBySession(documents: EngramDocument[]): Map<string, EngramDocument[]> {
	const groups = new Map<string, EngramDocument[]>();

	for (const doc of documents) {
		const existing = groups.get(doc.sessionId);
		if (existing) {
			existing.push(doc);
		} else {
			groups.set(doc.sessionId, [doc]);
		}
	}

	return groups;
}
