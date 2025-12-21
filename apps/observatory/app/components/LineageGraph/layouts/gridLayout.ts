import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";
import type { LayoutResult } from "../types";

/**
 * Grid fallback layout for when no session node is present
 * Arranges nodes in a simple grid pattern centered around the given point.
 */
export function getGridLayout(
	nodes: Node[],
	edges: Edge[],
	centerX: number,
	centerY: number,
): LayoutResult {
	const cols = Math.ceil(Math.sqrt(nodes.length));
	const spacing = 200;

	const layoutedNodes = nodes.map((node, i) => {
		const row = Math.floor(i / cols);
		const col = i % cols;
		return {
			...node,
			position: {
				x: centerX + (col - cols / 2) * spacing,
				y: centerY + (row - Math.ceil(nodes.length / cols) / 2) * spacing,
			},
			targetPosition: Position.Top,
			sourcePosition: Position.Bottom,
		};
	});

	return { nodes: layoutedNodes, edges };
}
