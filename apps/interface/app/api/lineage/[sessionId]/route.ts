import { createFalkorClient, type FalkorEdge, type FalkorNode } from "@engram/storage/falkor";
import { apiError, apiSuccess } from "@lib/api-response";
import { z } from "zod";

const falkor = createFalkorClient();

// Helper type for row access
interface LineageRow {
	s?: FalkorNode;
	path_nodes?: FalkorNode[];
	path_edges?: FalkorEdge[];
}

export const _LineageParams = z.object({
	sessionId: z.string(),
});

export const _LineageResponse = z.object({
	nodes: z.array(z.record(z.string(), z.any())),
	links: z.array(
		z.object({
			source: z.string(),
			target: z.string(),
			type: z.string(),
			properties: z.record(z.string(), z.any()).optional(),
		}),
	),
});

/**
 * Get lineage graph for a session
 * @pathParams LineageParams
 * @response LineageResponse
 */
export async function GET(_request: Request, props: { params: Promise<{ sessionId: string }> }) {
	try {
		const params = await props.params;
		const { sessionId } = params;
		if (!sessionId) {
			return apiError("Missing sessionId", "INVALID_REQUEST", 400);
		}

		await falkor.connect();

		// 1. Query FalkorDB for the Session node and traversal
		// We want the session node and all nodes connected via TRIGGERS or NEXT edges, recursively.
		// We limit depth or count to avoid exploding on huge sessions.
		// Using a variable length path query.
		// Note: OpenCypher in FalkorDB supports variable length paths.
		// We return paths or distinct nodes/edges.
		// For visualization, we need nodes and edges.

		const query = `
      MATCH (s:Session {id: $sessionId})
      OPTIONAL MATCH p = (s)-[:TRIGGERS|NEXT*0..100]->(n)
      RETURN s, nodes(p) as path_nodes, relationships(p) as path_edges
    `;

		const res = await falkor.query(query, { sessionId });

		// 2. Transform to Graph structure { nodes: [], links: [] }
		const nodesMap = new Map<string, unknown>();
		const links: unknown[] = [];

		// Build a map from FalkorDB internal IDs to our UUIDs
		const internalIdToUuid = new Map<number, string>();

		if (res && Array.isArray(res)) {
			// FalkorDB returns named columns: { s, path_nodes, path_edges }
			for (const r of res) {
				const row = r as LineageRow;
				// Session Node - accessed by column name
				const sessionNode = row.s;
				if (sessionNode) {
					const uuid = sessionNode.properties?.id as string | undefined;
					if (uuid) {
						internalIdToUuid.set(sessionNode.id, uuid);
						if (!nodesMap.has(uuid)) {
							nodesMap.set(uuid, {
								...sessionNode.properties,
								id: uuid,
								label: "Session",
								type: "session",
							});
						}
					}
				}

				// Path Nodes - accessed by column name
				const pathNodes = row.path_nodes;
				if (Array.isArray(pathNodes)) {
					for (const n of pathNodes) {
						if (n) {
							const uuid = n.properties?.id as string | undefined;
							if (uuid) {
								internalIdToUuid.set(n.id, uuid);
								if (!nodesMap.has(uuid)) {
									const label = n.labels?.[0] || "Unknown";
									nodesMap.set(uuid, {
										...n.properties,
										id: uuid,
										label,
										type: label.toLowerCase(),
									});
								}
							}
						}
					}
				}
			}

			// Second pass: process edges using the internal ID to UUID map
			for (const r of res) {
				const row = r as LineageRow;
				const pathEdges = row.path_edges;
				if (Array.isArray(pathEdges)) {
					for (const e of pathEdges) {
						if (e) {
							const sourceUuid = internalIdToUuid.get(e.sourceId || e.srcNodeId);
							const targetUuid = internalIdToUuid.get(e.destinationId || e.destNodeId);

							if (sourceUuid && targetUuid) {
								links.push({
									source: sourceUuid,
									target: targetUuid,
									type: e.relationshipType || e.relation || e.type,
									properties: e.properties,
								});
							}
						}
					}
				}
			}
		}

		const graph = {
			nodes: Array.from(nodesMap.values()),
			links: links,
		};

		return apiSuccess(graph);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "LINEAGE_QUERY_FAILED");
	}
}
