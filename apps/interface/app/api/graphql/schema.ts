import { createFalkorClient } from "@engram/storage/falkor";

const falkor = createFalkorClient();

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
  }

  type Query {
    session(id: ID!): Session
    sessions(limit: Int): [Session!]!
    search(query: String!): [Thought!]
  }
`;

interface SessionParent {
	id: string;
	[key: string]: unknown;
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
			const res = await falkor.query(
				`MATCH (s:Session) RETURN s ORDER BY s.startedAt DESC LIMIT ${limit}`,
			);
			return res || [];
		},
	},
	Session: {
		thoughts: async (parent: SessionParent, { limit = 50 }: { limit: number }) => {
			await falkor.connect();
			// Traverse NEXT edge or TRIGGERS
			const res = await falkor.query(
				`MATCH (s:Session {id: $id})-[:TRIGGERS|NEXT*]->(t:Thought)
         RETURN t ORDER BY t.vt_start ASC LIMIT ${limit}`,
				{ id: parent.id },
			);
			return res || [];
		},
	},
};
