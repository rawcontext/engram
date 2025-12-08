import { WebSocket } from 'ws';
import { createFalkorClient } from '@engram/storage/falkor';
import { createRedisSubscriber, type SessionUpdate } from '@engram/storage/redis';

const falkor = createFalkorClient();
const redisSubscriber = createRedisSubscriber();

interface LineageNode {
    id: string;
    label: string;
    type?: string;
    [key: string]: unknown;
}

interface LineageLink {
    source: string;
    target: string;
    type: string;
}

export async function handleSessionConnection(ws: WebSocket, sessionId: string) {
    console.log(`[WS] Client connected to session ${sessionId}`);

    // Subscribe to Redis channel for real-time updates
    const unsubscribe = await redisSubscriber.subscribe(sessionId, (update: SessionUpdate) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        // Forward the update to the WebSocket client
        // The client can handle incremental updates or request full refresh
        ws.send(JSON.stringify({
            type: 'update',
            data: update,
        }));
    });

    // Send initial data (one-time fetch)
    try {
        await falkor.connect();

        // Fetch initial lineage
        const lineageData = await getFullLineage(sessionId);
        if (lineageData.nodes.length > 0) {
            ws.send(JSON.stringify({ type: 'lineage', data: lineageData }));
        }

        // Fetch initial timeline
        const timelineData = await getFullTimeline(sessionId);
        if (timelineData.timeline.length > 0) {
            ws.send(JSON.stringify({ type: 'replay', data: timelineData }));
        }
    } catch (error) {
        console.error('[WS] Initial fetch error:', error);
    }

    ws.on('close', async () => {
        console.log(`[WS] Client disconnected from session ${sessionId}`);
        await unsubscribe();
    });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            // Client can request a full refresh if needed
            if (data.type === 'refresh') {
                await falkor.connect();
                const lineageData = await getFullLineage(sessionId);
                ws.send(JSON.stringify({ type: 'lineage', data: lineageData }));

                const timelineData = await getFullTimeline(sessionId);
                ws.send(JSON.stringify({ type: 'replay', data: timelineData }));
            }
        } catch (e) {
            console.error('[WS] Invalid message', e);
        }
    });
}

// Helpers to fetch full data
async function getFullLineage(sessionId: string) {
    const query = `
      MATCH (s:Session {id: $sessionId})
      OPTIONAL MATCH p = (s)-[:TRIGGERS|NEXT*0..100]->(n)
      RETURN s, nodes(p) as path_nodes, relationships(p) as path_edges
    `;
    // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
    const res: any = await falkor.query(query, { sessionId });

    const internalIdToUuid = new Map<number, string>();
    const nodes: any[] = [];
    const links: any[] = [];

    if (res && Array.isArray(res)) {
        for (const row of res) {
             const sessionNode = row.s;
             if (sessionNode) {
                 const uuid = sessionNode.properties?.id;
                 if (uuid) {
                     internalIdToUuid.set(sessionNode.id, uuid);
                     if (!nodes.find(n => n.id === uuid)) {
                         nodes.push({ ...sessionNode.properties, id: uuid, label: "Session", type: "session" });
                     }
                 }
             }

             const pathNodes = row.path_nodes;
             if (Array.isArray(pathNodes)) {
                 for (const n of pathNodes) {
                     if (n) {
                         const uuid = n.properties?.id;
                         if (uuid) {
                             internalIdToUuid.set(n.id, uuid);
                             if (!nodes.find(x => x.id === uuid)) {
                                 const label = n.labels?.[0] || "Unknown";
                                 nodes.push({ ...n.properties, id: uuid, label, type: label.toLowerCase() });
                             }
                         }
                     }
                 }
             }
        }

        // Now process edges
        for (const row of res) {
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
                                type: e.relationshipType || e.relation,
                                properties: e.properties
                            });
                        }
                    }
                }
            }
        }
    }

    return {
        nodes,
        links
    };
}

async function getFullTimeline(sessionId: string) {
    const cypher = `
        MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)
        RETURN t
        ORDER BY t.vt_start ASC
    `;
    // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
    const result: any = await falkor.query(cypher, { sessionId });
    const timeline = [];
    if (Array.isArray(result)) {
        for (const row of result) {
            const node = row.t;
            if (node && node.properties) {
                timeline.push({ ...node.properties, id: node.properties.id, type: 'thought' });
            }
        }
    }
    return { timeline };
}
