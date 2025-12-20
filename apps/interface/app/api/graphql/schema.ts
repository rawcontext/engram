// TODO: Replace with HTTP client to search-py service (port 5002)
// import { SearchRetriever } from "@engram/search";
import { createFalkorClient } from "@engram/storage/falkor";

const falkor = createFalkorClient();
// TODO: Replace with HTTP client to search-py service
const SEARCH_PY_URL = process.env.SEARCH_PY_URL || "http://localhost:5002";

export const typeDefs = `
  type Session {
    id: ID!
    title: String
    userId: String
    startedAt: Float
    thoughts(limit: Int): [Thought!]!
  }

  type Thought {
    id: ID!
    role: String
    content: String
    isThinking: Boolean
    validFrom: Float
    validTo: Float
    transactionStart: Float
    transactionEnd: Float
    causedBy: [ToolCall!]
  }

  type ToolCall {
    id: ID!
    name: String!
    arguments: String
    result: String
    validFrom: Float
    validTo: Float
  }

  type SearchResult {
    id: ID!
    content: String!
    score: Float!
    nodeId: String
    sessionId: String
    type: String
    timestamp: Float
  }

  scalar JSON

  type Query {
    session(id: ID!): Session
    sessions(limit: Int): [Session!]!
    search(query: String!, limit: Int, type: String): [SearchResult!]!
    graph(cypher: String!): JSON
  }
`;

interface SessionParent {
	id: string;
	[key: string]: unknown;
}

interface ThoughtParent {
	id: string;
	[key: string]: unknown;
}

interface SearchPayload {
	content?: string;
	node_id?: string;
	session_id?: string;
	type?: string;
	timestamp?: number;
}

export const resolvers = {
	Query: {
		session: async (_: unknown, { id }: { id: string }) => {
			await falkor.connect();
			const res = await falkor.query("MATCH (s:Session {id: $id}) RETURN s", { id });
			const row = res?.[0];
			const node = row?.s || row?.[0];
			if (!node) return null;
			return node;
		},
		sessions: async (_: unknown, { limit = 10 }: { limit: number }) => {
			await falkor.connect();
			// Validate and sanitize limit to prevent injection
			const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 10)), 100);
			const res = await falkor.query(
				"MATCH (s:Session) RETURN s ORDER BY s.startedAt DESC LIMIT $limit",
				{ limit: safeLimit },
			);
			return res || [];
		},
		search: async (
			_: unknown,
			{ query, limit = 10, type }: { query: string; limit?: number; type?: string },
		) => {
			// TODO: Replace with HTTP call to search-py /search endpoint
			// const results = await searchRetriever.search({
			// 	text: query,
			// 	limit,
			// 	filters: type ? { type: type as "thought" | "code" | "doc" } : undefined,
			// });
			const results: any[] = []; // TODO: Implement HTTP call

			return (results || []).map((result: any) => {
				const payload = result.payload as SearchPayload;
				return {
					id: result.id,
					content: payload?.content || "",
					score: result.score,
					nodeId: payload?.node_id,
					sessionId: payload?.session_id,
					type: payload?.type,
					timestamp: payload?.timestamp,
				};
			});
		},
		graph: async (_: unknown, { cypher: _cypher }: { cypher: string }) => {
			// SECURITY: Arbitrary Cypher execution is disabled to prevent injection attacks.
			// This endpoint should only be enabled for authenticated admin users.
			// To re-enable, implement proper authentication and authorization checks.
			throw new Error(
				"Arbitrary Cypher query execution is disabled. Use specific query endpoints instead.",
			);

			// Original implementation (disabled for security):
			// await falkor.connect();
			// const res = await falkor.query(cypher);
			// return res;
		},
	},
	Session: {
		thoughts: async (parent: SessionParent, { limit = 50 }: { limit: number }) => {
			await falkor.connect();
			// Validate and sanitize limit to prevent injection
			const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 500);
			// Traverse NEXT edge or TRIGGERS
			const res = await falkor.query(
				"MATCH (s:Session {id: $id})-[:TRIGGERS|NEXT*]->(t:Thought) RETURN t ORDER BY t.vt_start ASC LIMIT $limit",
				{ id: parent.id, limit: safeLimit },
			);
			return res || [];
		},
	},
	Thought: {
		causedBy: async (parent: ThoughtParent) => {
			await falkor.connect();
			// Fetch ToolCalls linked to this thought via YIELDS relationship
			const res = await falkor.query(
				`MATCH (t:Thought {id: $id})-[:YIELDS]->(tc:ToolCall)
         RETURN tc ORDER BY tc.vt_start ASC`,
				{ id: parent.id },
			);
			return res || [];
		},
	},
};
