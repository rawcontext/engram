import { WebSocket } from 'ws';
import { createFalkorClient } from '@the-soul/storage';

const falkor = createFalkorClient();

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

// Keep track of active intervals to clear them on disconnect
const activeIntervals = new WeakMap<WebSocket, NodeJS.Timeout>();

export function handleSessionConnection(ws: WebSocket, sessionId: string) {
    console.log(`[WS] Client connected to session ${sessionId}`);

    // Send initial "connected" message if needed
    // ws.send(JSON.stringify({ type: 'status', message: 'connected' }));

    // Setup polling for this session
    // In a real prod scenario, we'd listen to Kafka or Redis PubSub.
    // For now, to satisfy the requirement of "real-time updates" via WS,
    // we'll poll the DB and push changes.
    
    let lastNodeCount = 0;
    let lastEventCount = 0;

    const poll = async () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        try {
            await falkor.connect();

            // 1. Fetch Lineage (Simplified query for counts/diffing)
            // We reuse the logic from the API route roughly
            const lineageQuery = `
                MATCH (s:Session {id: $sessionId})
                OPTIONAL MATCH p = (s)-[:TRIGGERS|NEXT*0..100]->(n)
                RETURN count(distinct n) as nodeCount
            `;
            
            // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
            const lineageRes: any = await falkor.query(lineageQuery, { sessionId });
            const currentNodeCount = Number(lineageRes?.[0]?.[0] || 0);

            // 2. Fetch Replay/Timeline count
            const replayQuery = `
                MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(first:Thought)
                MATCH p = (first)-[:NEXT*0..100]->(t:Thought)
                RETURN count(t) as eventCount
            `;
             // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
            const replayRes: any = await falkor.query(replayQuery, { sessionId });
            const currentEventCount = Number(replayRes?.[0]?.[0] || 0);

            // If changed, fetch full data and push
            // Note: This is inefficient for large graphs, but fine for prototype/small sessions.
            if (currentNodeCount !== lastNodeCount) {
                 // Fetch full lineage
                 // We can reuse the logic or just signal client to refetch?
                 // The useSessionStream hook expects data in the message.
                 // Let's fetch full data.
                 const fullLineageData = await getFullLineage(sessionId);
                 ws.send(JSON.stringify({ type: 'lineage', data: fullLineageData }));
                 lastNodeCount = currentNodeCount;
            }

            if (currentEventCount !== lastEventCount) {
                const fullReplayData = await getFullTimeline(sessionId);
                ws.send(JSON.stringify({ type: 'replay', data: fullReplayData }));
                lastEventCount = currentEventCount;
            }

        } catch (error) {
            console.error('[WS] Polling error:', error);
            // Optionally send error to client
        }
    };

    // Poll every 1 second
    const interval = setInterval(poll, 1000);
    activeIntervals.set(ws, interval);

    // Initial poll
    poll();

    ws.on('close', () => {
        console.log(`[WS] Client disconnected from session ${sessionId}`);
        const interval = activeIntervals.get(ws);
        if (interval) clearInterval(interval);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'subscribe') {
                // Handled by connection logic currently
            }
        } catch (e) {
            console.error('[WS] Invalid message', e);
        }
    });
}

// Helpers to fetch full data (duplicated from API routes for now to keep independent)
async function getFullLineage(sessionId: string) {
    const query = `
      MATCH (s:Session {id: $sessionId})
      OPTIONAL MATCH p = (s)-[:TRIGGERS|NEXT*0..100]->(n)
      RETURN s, nodes(p) as path_nodes, relationships(p) as path_edges
    `;
    // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
    const res: any = await falkor.query(query, { sessionId });
    
    const nodesMap = new Map<string, unknown>();
    const links: unknown[] = [];

    if (res && Array.isArray(res)) {
        for (const row of res) {
            const sessionNode = row[0];
            if (sessionNode?.id) {
                nodesMap.set(sessionNode.id, {
                    ...sessionNode.properties,
                    id: sessionNode.id,
                    label: "Session",
                    type: "session"
                });
            }
            const pathNodes = row[1];
            if (Array.isArray(pathNodes)) {
                for (const n of pathNodes) {
                    if (n?.id) {
                        const label = n.labels?.[0] || "Unknown";
                        // map label to type roughly
                        const type = label.toLowerCase();
                        nodesMap.set(n.id, { ...n.properties, id: n.id, label, type });
                    }
                }
            }
            const pathEdges = row[2];
            if (Array.isArray(pathEdges)) {
                for (const e of pathEdges) {
                    links.push({
                        source: e.srcNodeId || e.start,
                        target: e.destNodeId || e.end,
                        type: e.type || e.relation,
                        properties: e.properties,
                    });
                }
            }
        }
    }

    return {
        nodes: Array.from(nodesMap.values()),
        links
    };
}

async function getFullTimeline(sessionId: string) {
    const cypher = `
        MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(first:Thought)
        MATCH p = (first)-[:NEXT*0..100]->(t:Thought)
        RETURN t
        ORDER BY t.vt_start ASC
    `;
    // biome-ignore lint/suspicious/noExplicitAny: FalkorDB response
    const result: any = await falkor.query(cypher, { sessionId });
    const timeline = [];
    if (Array.isArray(result)) {
        for (const row of result) {
            const node = row[0];
            if (node && node.properties) {
                timeline.push({ ...node.properties, id: node.properties.id || node.id, type: 'thought' });
            }
        }
    }
    return { timeline };
}
