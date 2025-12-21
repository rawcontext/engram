import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";
import type { LayoutResult } from "../types";
import { LAYOUT_CONSTANTS } from "../types";
import { getGridLayout } from "./gridLayout";

const { nodeWidth, nodeHeight, columnGap, rowGap, childGap, orphanRadius } = LAYOUT_CONSTANTS;

/**
 * Horizontal tree layout: Session -> Turns -> Reasoning -> ToolCall (left to right)
 * Arranges nodes in columns based on their type, with vertical positioning
 * based on parent-child relationships.
 */
export function getRadialLayout(
	nodes: Node[],
	edges: Edge[],
	centerX: number,
	centerY: number,
): LayoutResult {
	if (nodes.length === 0) return { nodes: [], edges };

	// Find the session node (root)
	const sessionNode = nodes.find((n) => (n.data?.type as string)?.toLowerCase() === "session");

	if (!sessionNode) {
		// Fallback to grid if no session
		return getGridLayout(nodes, edges, centerX, centerY);
	}

	// Categorize nodes by type and sort by sequence_index
	const turnNodes = nodes
		.filter((n) => (n.data?.type as string)?.toLowerCase() === "turn")
		.toSorted((a, b) => {
			const seqA = (a.data?.sequence_index as number) ?? 0;
			const seqB = (b.data?.sequence_index as number) ?? 0;
			return seqA - seqB;
		});

	const reasoningNodes = nodes
		.filter((n) => (n.data?.type as string)?.toLowerCase() === "reasoning")
		.toSorted((a, b) => {
			const seqA = (a.data?.sequence_index as number) ?? 0;
			const seqB = (b.data?.sequence_index as number) ?? 0;
			return seqA - seqB;
		});

	const toolCallNodes = nodes
		.filter((n) => (n.data?.type as string)?.toLowerCase() === "toolcall")
		.toSorted((a, b) => {
			const seqA = (a.data?.sequence_index as number) ?? 0;
			const seqB = (b.data?.sequence_index as number) ?? 0;
			return seqA - seqB;
		});

	const otherNodes = nodes.filter((n) => {
		const type = (n.data?.type as string)?.toLowerCase();
		return type !== "session" && type !== "turn" && type !== "reasoning" && type !== "toolcall";
	});

	// Build parent-child map from edges
	const childToParent = new Map<string, string>();
	for (const edge of edges) {
		childToParent.set(edge.target, edge.source);
	}

	// Group children by parent Turn using Map.groupBy (ES2024)
	// Type-safe: filter guarantees parentId exists, use as string to satisfy type checker
	const reasoningByParent = Map.groupBy(
		reasoningNodes.filter((node) => childToParent.has(node.id)),
		(node) => childToParent.get(node.id) as string,
	);

	const toolCallByParent = Map.groupBy(
		toolCallNodes.filter((node) => childToParent.has(node.id)),
		(node) => childToParent.get(node.id) as string,
	);

	// Calculate height needed for each Turn's subtree (considering all child types)
	const turnHeights = new Map<string, number>();
	for (const turn of turnNodes) {
		const reasoningCount = reasoningByParent.get(turn.id)?.length || 0;
		const toolCallCount = toolCallByParent.get(turn.id)?.length || 0;
		const maxChildren = Math.max(reasoningCount, toolCallCount, 1);
		const height = maxChildren * nodeHeight + (maxChildren - 1) * (childGap - nodeHeight);
		turnHeights.set(turn.id, Math.max(height, nodeHeight));
	}

	// Calculate total height of all Turn subtrees
	const totalHeight =
		Array.from(turnHeights.values()).reduce((sum, h) => sum + h, 0) +
		(turnNodes.length - 1) * rowGap;

	// Starting Y position to center the tree vertically
	const startY = centerY - totalHeight / 2;

	// Column X positions (4 columns: Session, Turn, Reasoning, ToolCall)
	const sessionX = centerX - columnGap * 1.5;
	const turnX = centerX - columnGap * 0.5;
	const reasoningX = centerX + columnGap * 0.5;
	const toolCallX = centerX + columnGap * 1.5;

	const layoutedNodes: Node[] = [];
	const turnPositions = new Map<string, { x: number; y: number }>();

	// Place session at left
	layoutedNodes.push({
		...sessionNode,
		position: { x: sessionX - nodeWidth / 2, y: centerY - nodeHeight / 2 },
		targetPosition: Position.Left,
		sourcePosition: Position.Right,
	});

	// Place Turns in a vertical column, accounting for their subtree heights
	let currentY = startY;
	for (const node of turnNodes) {
		const subtreeHeight = turnHeights.get(node.id) || nodeHeight;
		const y = currentY + subtreeHeight / 2 - nodeHeight / 2;
		turnPositions.set(node.id, { x: turnX, y });
		layoutedNodes.push({
			...node,
			position: { x: turnX - nodeWidth / 2, y },
			targetPosition: Position.Left,
			sourcePosition: Position.Right,
		});
		currentY += subtreeHeight + rowGap;
	}

	// Place Reasoning nodes (column to right of Turns)
	for (const [parentId, children] of reasoningByParent) {
		const parentPos = turnPositions.get(parentId);
		if (!parentPos) continue;
		const totalChildHeight =
			children.length * nodeHeight + (children.length - 1) * (childGap - nodeHeight);
		const startChildY = parentPos.y + nodeHeight / 2 - totalChildHeight / 2;
		children.forEach((node, index) => {
			layoutedNodes.push({
				...node,
				position: {
					x: reasoningX - nodeWidth / 2,
					y: startChildY + index * childGap,
				},
				targetPosition: Position.Left,
				sourcePosition: Position.Right,
			});
		});
	}

	// Place ToolCall nodes (column to right of Reasoning)
	for (const [parentId, children] of toolCallByParent) {
		const parentPos = turnPositions.get(parentId);
		if (!parentPos) continue;
		const totalChildHeight =
			children.length * nodeHeight + (children.length - 1) * (childGap - nodeHeight);
		const startChildY = parentPos.y + nodeHeight / 2 - totalChildHeight / 2;
		children.forEach((node, index) => {
			const yPos = startChildY + index * childGap;
			layoutedNodes.push({
				...node,
				position: {
					x: toolCallX - nodeWidth / 2,
					y: yPos,
				},
				targetPosition: Position.Left,
				sourcePosition: Position.Right,
			});
		});
	}

	// Place any orphan nodes that don't have parents
	const placedIds = new Set(layoutedNodes.map((n) => n.id));
	const orphanNodes = [...reasoningNodes, ...toolCallNodes, ...otherNodes].filter(
		(n) => !placedIds.has(n.id),
	);

	// Place orphans in outer ring
	orphanNodes.forEach((node, index) => {
		const angle = (index / Math.max(orphanNodes.length, 1)) * 2 * Math.PI;
		layoutedNodes.push({
			...node,
			position: {
				x: centerX + Math.cos(angle) * orphanRadius - nodeWidth / 2,
				y: centerY + Math.sin(angle) * orphanRadius - nodeHeight / 2,
			},
			targetPosition: Position.Top,
			sourcePosition: Position.Bottom,
		});
	});

	return { nodes: layoutedNodes, edges };
}
