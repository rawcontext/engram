import type { LineageResponse } from "@lib/types";
import type { Edge, Node } from "@xyflow/react";
import { useMemo, useRef } from "react";
import { getRadialLayout } from "../layouts";

interface UseGraphLayoutOptions {
	data: LineageResponse | null;
	centerX?: number;
	centerY?: number;
}

interface UseGraphLayoutResult {
	nodes: Node[];
	edges: Edge[];
	dataKey: string;
}

/**
 * Hook to compute graph layout from lineage data.
 * Memoizes layout computation and tracks data changes via a stable key.
 */
export function useGraphLayout({
	data,
	centerX = 400,
	centerY = 300,
}: UseGraphLayoutOptions): UseGraphLayoutResult {
	const _lastDataKeyRef = useRef<string>("");

	// Create a stable key based on node/edge IDs to detect actual data changes
	const dataKey = useMemo(() => {
		if (!data?.nodes?.length) return "";
		const nodeIds = data.nodes
			.map((n) => n.id)
			.toSorted()
			.join(",");
		const linkKeys = data.links
			.map((l) => `${l.source}-${l.target}`)
			.toSorted()
			.join(",");
		return `${nodeIds}|${linkKeys}`;
	}, [data]);

	// Compute initial nodes and edges with layout
	const layoutResult = useMemo(() => {
		if (!data || !data.nodes || data.nodes.length === 0) {
			return { nodes: [], edges: [] };
		}

		const initialNodes: Node[] = data.nodes.map((n) => ({
			id: n.id,
			position: { x: 0, y: 0 },
			data: {
				label: n.label || n.id,
				type: n.type,
				...n,
			},
			type: "neural",
		}));

		// Create edges with animation
		const initialEdges: Edge[] = data.links.map((l, i) => ({
			id: `e${i}`,
			source: l.source,
			target: l.target,
			animated: true,
			style: {
				stroke: "url(#edge-gradient)",
				strokeWidth: 1.5,
				opacity: 0.6,
			},
			label: undefined,
		}));

		// Apply radial layout
		return getRadialLayout(initialNodes, initialEdges, centerX, centerY);
	}, [data, centerX, centerY]);

	return {
		nodes: layoutResult.nodes,
		edges: layoutResult.edges,
		dataKey,
	};
}

/**
 * Hook to compute the parent chain for node highlighting.
 * Returns a Set of node IDs that should be highlighted (the node and its ancestors).
 */
export function useHighlightChain(
	highlightedNodeId: string | null | undefined,
	links: { source: string; target: string }[] | undefined,
): Set<string> {
	// Build parent lookup map from edges (child -> parent)
	const parentMap = useMemo(() => {
		const map = new Map<string, string>();
		if (links) {
			for (const link of links) {
				// Each edge goes from parent (source) to child (target)
				map.set(link.target, link.source);
			}
		}
		return map;
	}, [links]);

	// Compute the direct parent chain for the highlighted node
	return useMemo(() => {
		const ids = new Set<string>();
		if (!highlightedNodeId) return ids;

		// Add the highlighted node itself
		ids.add(highlightedNodeId);

		// Walk up the parent chain (direct ancestors only)
		let current = highlightedNodeId;
		while (parentMap.has(current)) {
			const parent = parentMap.get(current);
			if (!parent) break;
			ids.add(parent);
			current = parent;
		}

		return ids;
	}, [highlightedNodeId, parentMap]);
}
