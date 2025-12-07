import { createFalkorClient } from "@the-soul/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

const falkor = createFalkorClient();

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
export async function GET(_request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const { sessionId } = params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
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

    // biome-ignore lint/suspicious/noExplicitAny: FalkorDB raw response type unknown
    const res: any = await falkor.query(query, { sessionId });

    // 2. Transform to Graph structure { nodes: [], links: [] }
    const nodesMap = new Map<string, unknown>();
    const links: unknown[] = [];

    if (res) {
      // FalkorDB response structure might vary based on client/driver.
      // Assuming standard array of rows.
      // row[0] = Session Node
      // row[1] = Array of nodes in path
      // row[2] = Array of edges in path

      for (const row of res) {
        // Session Node
        const sessionNode = row[0];
        if (sessionNode?.id) {
          nodesMap.set(sessionNode.id, {
            ...sessionNode.properties,
            id: sessionNode.id,
            label: "Session",
          });
        }

        // Path Nodes
        const pathNodes = row[1];
        if (Array.isArray(pathNodes)) {
          for (const n of pathNodes) {
            if (n?.id) {
              // Extract label if available (might need raw node structure inspection)
              // Assuming n.labels is array or n.label is string
              const label = n.labels?.[0] || "Unknown";
              nodesMap.set(n.id, { ...n.properties, id: n.id, label });
            }
          }
        }

        // Path Edges
        const pathEdges = row[2];
        if (Array.isArray(pathEdges)) {
          for (const e of pathEdges) {
            // Edge structure: { id, type, startNodeId, endNodeId, properties }
            // We need to ensure uniqueness?
            // FalkorDB returns internal IDs usually? We used ULID as 'id' property on nodes.
            // Edges might not have ULID property unless we added it.
            // Standard edges have types.
            // Let's assume we can link by internal IDs or properties.
            // Ideally we use our 'id' property.
            // If edge doesn't have a user-space ID, we might generate one or use index.
            // For D3/Vis, source/target needed.
            // FalkorDB edge object usually has src/dest relation.

            // Simplified edge representation
            links.push({
              source: e.srcNodeId || e.start, // Check driver mapping
              target: e.destNodeId || e.end,
              type: e.type || e.relation,
              properties: e.properties,
            });
          }
        }
      }
    }

    const graph = {
      nodes: Array.from(nodesMap.values()),
      links: links,
    };

    return NextResponse.json(graph);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
