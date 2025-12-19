import type { FalkorClient, QueryParams } from "@engram/storage";
import type { BaseNode } from "./models/base";
import { createBitemporal, MAX_DATE, now } from "./utils/time";

/**
 * Regex pattern for valid Cypher labels and relationship types.
 * Labels/types must:
 * - Start with a letter (a-z, A-Z)
 * - Contain only letters, digits, and underscores
 * - Be at most 100 characters long
 */
const VALID_CYPHER_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,99}$/;

/**
 * Validate a label or relationship type to prevent Cypher injection.
 * @param identifier The label or relationship type to validate
 * @param type Description for error message (e.g., "label", "relationship type")
 * @throws Error if the identifier is invalid
 */
function validateCypherIdentifier(identifier: string, type: string): void {
	if (!VALID_CYPHER_IDENTIFIER.test(identifier)) {
		throw new Error(
			`Invalid ${type}: "${identifier}". Must start with a letter and contain only letters, digits, and underscores (max 100 chars).`,
		);
	}
}

export class GraphWriter {
	constructor(private client: FalkorClient) {}

	async writeNode<T extends BaseNode>(
		label: string,
		data: Omit<T, "vt_start" | "vt_end" | "tt_start" | "tt_end">,
		validFrom: number = now(),
	): Promise<void> {
		// Validate label to prevent Cypher injection
		validateCypherIdentifier(label, "label");

		const temporal = createBitemporal(validFrom);
		const nodeData = { ...data, ...temporal };

		const propKeys = Object.keys(nodeData);
		const propsString = propKeys.map((k) => `${k}: $${k}`).join(", ");

		const query = `CREATE (n:${label} { ${propsString} })`;

		await this.client.query(query, nodeData as QueryParams);
	}

	async writeEdge(
		fromId: string,
		toId: string,
		relationType: string,
		props: Record<string, unknown> = {},
		validFrom: number = now(),
	): Promise<void> {
		// Validate relationship type to prevent Cypher injection
		validateCypherIdentifier(relationType, "relationship type");

		const temporal = createBitemporal(validFrom);
		const edgeData = { ...props, ...temporal };

		const propKeys = Object.keys(edgeData);
		const propsString = propKeys.map((k) => `${k}: $${k}`).join(", ");

		const query = `
      MATCH (a {id: $fromId}), (b {id: $toId})
      CREATE (a)-[:${relationType} { ${propsString} }]->(b)
    `;

		await this.client.query(query, { fromId, toId, ...edgeData });
	}

	// Transaction Time: Update (Append-Only / Replace)
	async updateNode<T extends BaseNode>(
		oldNodeId: string,
		label: string,
		newNodeData: Omit<T, "vt_start" | "vt_end" | "tt_start" | "tt_end">,
		validFrom: number = now(),
	): Promise<void> {
		// 1. Write the new node version
		await this.writeNode(label, newNodeData, validFrom);

		// 2. Link New -> Old via REPLACES
		// We expect newNodeData to contain the new 'id'
		await this.writeEdge(newNodeData.id, oldNodeId, "REPLACES", {}, validFrom);
	}

	// Transaction Time: Delete (Logical Delete)
	async deleteNode(id: string): Promise<void> {
		const t = now();
		// Close the transaction time interval for the current version
		const query = `
      MATCH (n {id: $id})
      WHERE n.tt_end = ${MAX_DATE}
      SET n.tt_end = $t
    `;
		await this.client.query(query, { id, t });
	}
}
