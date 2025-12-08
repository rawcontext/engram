import type { FalkorClient, QueryParams } from "@engram/storage";

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
