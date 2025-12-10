import type { GraphNode, LineageResponse } from "@lib/types";
import type { Edge, Node } from "@xyflow/react";
import type { ReactNode } from "react";

/**
 * Props for the main LineageGraph component
 */
export interface LineageGraphProps {
	data: LineageResponse | null;
	onNodeClick?: (node: GraphNode) => void;
	highlightedNodeId?: string | null;
	onNodeHover?: (nodeId: string | null) => void;
}

/**
 * Configuration for a node type's visual appearance
 */
export interface NodeTypeConfig {
	border: string;
	bg: string;
	glow: string;
	text: string;
	icon: ReactNode | null;
}

/**
 * Map of node type names to their configurations
 */
export type NodeTypeConfigMap = Record<string, NodeTypeConfig>;

/**
 * Result of a layout algorithm
 */
export interface LayoutResult {
	nodes: Node[];
	edges: Edge[];
}

/**
 * Layout function signature
 */
export type LayoutFunction = (
	nodes: Node[],
	edges: Edge[],
	centerX: number,
	centerY: number,
) => LayoutResult;

/**
 * Graph stats for the overlay display
 */
export interface GraphStatsProps {
	nodeCount: number;
	edgeCount: number;
}

/**
 * Layout constants used across the graph
 */
export const LAYOUT_CONSTANTS = {
	nodeWidth: 160,
	nodeHeight: 50,
	columnGap: 250,
	rowGap: 80,
	childGap: 65,
	orphanRadius: 350,
} as const;
