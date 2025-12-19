import type { FalkorClient, QueryParams } from "@engram/storage";

/**
 * Regex pattern for valid Cypher relationship types.
 * Types must:
 * - Start with a letter (a-z, A-Z)
 * - Contain only letters, digits, and underscores
 * - Be at most 100 characters long
 */
const VALID_RELATIONSHIP_TYPE = /^[a-zA-Z][a-zA-Z0-9_]{0,99}$/;

/**
 * Validate a relationship type to prevent Cypher injection.
 * @param type The relationship type to validate
 * @throws Error if the type is invalid
 */
function validateRelationshipType(type: string): void {
	if (!VALID_RELATIONSHIP_TYPE.test(type)) {
		throw new Error(
			`Invalid relationship type: "${type}". Must start with a letter and contain only letters, digits, and underscores (max 100 chars).`,
		);
	}
}

export class GraphMerger {
	constructor(private client: FalkorClient) {}

	async mergeNodes(targetId: string, sourceId: string) {
		// 1. Get all edges connected to source
		const edgesQuery = `
            MATCH (s {id: $sourceId})-[r]-(n)
            RETURN type(r) as type, startNode(r) = s as isOutgoing, n.id as neighborId, properties(r) as props
        `;

		const edgesResult = await this.client.query(edgesQuery, { sourceId });

		if (!Array.isArray(edgesResult)) return;

		for (const row of edgesResult) {
			const type = row[0] as string;
			const isOutgoing = row[1] as boolean;
			const neighborId = row[2] as string;
			const props = (row[3] || {}) as QueryParams;

			// Validate relationship type to prevent Cypher injection
			validateRelationshipType(type);

			// Re-create edge to target
			let createQuery = "";
			if (isOutgoing) {
				createQuery = `
                    MATCH (t {id: $targetId}), (n {id: $neighborId})
                    MERGE (t)-[r:${type}]->(n)
                    SET r = $props
                `;
			} else {
				createQuery = `
                    MATCH (t {id: $targetId}), (n {id: $neighborId})
                    MERGE (n)-[r:${type}]->(t)
                    SET r = $props
                `;
			}

			await this.client.query(createQuery, { targetId, neighborId, props });
		}

		// 2. Delete source node (and its old edges)
		const deleteQuery = `MATCH (s {id: $sourceId}) DETACH DELETE s`;
		await this.client.query(deleteQuery, { sourceId });

		console.log(`Merged node ${sourceId} into ${targetId}`);
	}
}
