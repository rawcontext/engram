"use client";

import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	ReactFlow,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";

import { EmptyState } from "./EmptyState";
import { GraphStats } from "./GraphStats";
import { GraphCssStyles, GraphOverlays, GraphSvgDefs } from "./GraphStyles";
import { HighlightContext } from "./HighlightContext";
import { useHighlightChain } from "./hooks";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { getRadialLayout } from "./layouts";
import { NeuralNode } from "./NeuralNode";
import type { LineageGraphProps, NeuralGraphNode } from "./types";

// Register custom node types
const nodeTypes = {
	neural: NeuralNode,
};

/**
 * LineageGraph - Interactive graph visualization for session lineage data.
 *
 * Features:
 * - Horizontal tree layout (Session -> Turns -> Reasoning -> ToolCall)
 * - Custom neural-styled nodes with type-specific colors
 * - Hover highlighting with parent chain illumination
 * - Animated edges and node effects
 * - MiniMap navigation
 * - Zoom and pan controls
 */
export function LineageGraph({
	data,
	onNodeClick,
	highlightedNodeId,
	onNodeHover,
}: LineageGraphProps) {
	const [nodes, setNodes, onNodesChange] = useNodesState<NeuralGraphNode>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState([]);
	const lastDataKeyRef = useRef<string>("");

	// Create a stable key based on node/edge IDs to detect actual data changes
	const dataKey = useMemo(() => {
		if (!data?.nodes?.length) return "";
		const nodeIds = data.nodes
			.map((n) => n.id)
			.sort()
			.join(",");
		const linkKeys = data.links
			.map((l) => `${l.source}-${l.target}`)
			.sort()
			.join(",");
		return `${nodeIds}|${linkKeys}`;
	}, [data]);

	// Compute highlighted node chain (node + ancestors)
	const highlightedNodeIds = useHighlightChain(highlightedNodeId, data?.links);

	// Initialize nodes and edges only when actual data content changes
	useEffect(() => {
		// Empty data case
		if (!data || !data.nodes || data.nodes.length === 0) {
			if (lastDataKeyRef.current !== "") {
				setNodes([]);
				setEdges([]);
				lastDataKeyRef.current = "";
			}
			return;
		}

		// Skip if data hasn't actually changed (same content)
		if (dataKey === lastDataKeyRef.current) {
			return;
		}

		// Update ref to prevent re-processing same data
		lastDataKeyRef.current = dataKey;

		const initialNodes: NeuralGraphNode[] = data.nodes.map((n) => ({
			id: n.id,
			position: { x: 0, y: 0 },
			data: {
				label: n.label || n.id,
				type: n.type ?? "unknown",
				...n,
			},
			type: "neural" as const,
		}));

		// Create edges with animation
		const initialEdges = data.links.map((l, i) => ({
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

		// Use radial layout centered in view
		const centerX = 400;
		const centerY = 300;
		const { nodes: layoutedNodes, edges: layoutedEdges } = getRadialLayout(
			initialNodes,
			initialEdges,
			centerX,
			centerY,
		);

		// Layout functions preserve node structure, cast back to typed nodes
		setNodes(layoutedNodes as NeuralGraphNode[]);
		setEdges(layoutedEdges);
	}, [dataKey, data, setNodes, setEdges]);

	// Event handlers
	const handleNodeClick = useCallback(
		(_: React.MouseEvent, node: NeuralGraphNode) => {
			onNodeClick?.(node.data);
		},
		[onNodeClick],
	);

	const handleNodeMouseEnter = useCallback(
		(_: React.MouseEvent, node: NeuralGraphNode) => {
			onNodeHover?.(node.id);
		},
		[onNodeHover],
	);

	const handleNodeMouseLeave = useCallback(() => {
		onNodeHover?.(null);
	}, [onNodeHover]);

	// Minimap node color based on type
	const minimapNodeColor = useCallback((node: NeuralGraphNode) => {
		const type = node.data?.type?.toLowerCase();
		switch (type) {
			case "session":
				return "rgb(226, 232, 240)"; // Silver/White
			case "turn":
				return "rgb(251, 191, 36)"; // Amber
			case "reasoning":
				return "rgb(34, 211, 238)"; // Cyan
			case "toolcall":
				return "rgb(139, 92, 246)"; // Violet/Purple
			// Legacy types
			case "thought":
				return "rgb(251, 191, 36)"; // Amber
			case "action":
				return "rgb(245, 158, 11)"; // Amber variant
			case "observation":
				return "rgb(148, 163, 184)"; // Slate
			default:
				return "rgb(100, 116, 139)";
		}
	}, []);

	// Loading state
	if (!data) {
		return (
			<div
				data-testid="lineage-graph-loading"
				style={{ width: "100%", height: "100%", minHeight: "400px" }}
			>
				<LoadingSkeleton />
			</div>
		);
	}

	// Empty state
	if (!data.nodes || data.nodes.length === 0) {
		return (
			<div style={{ width: "100%", height: "100%", minHeight: "400px" }}>
				<EmptyState />
			</div>
		);
	}

	return (
		<div
			data-testid="lineage-graph"
			style={{ width: "100%", height: "100%", minHeight: "500px", position: "relative" }}
		>
			{/* Stats overlay */}
			<GraphStats nodeCount={data.nodes.length} edgeCount={data.links.length} />

			{/* Visual overlays for depth */}
			<GraphOverlays />

			{/* SVG gradient definitions */}
			<GraphSvgDefs />

			{/* CSS styles for React Flow */}
			<GraphCssStyles />

			{/* React Flow graph */}
			<div style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}>
				<HighlightContext.Provider value={highlightedNodeIds}>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						nodeTypes={nodeTypes}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onNodeClick={handleNodeClick}
						onNodeMouseEnter={handleNodeMouseEnter}
						onNodeMouseLeave={handleNodeMouseLeave}
						fitView
						fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
						minZoom={0.2}
						maxZoom={1.5}
						defaultEdgeOptions={{
							type: "default",
						}}
						proOptions={{ hideAttribution: true }}
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={24}
							size={1}
							color="rgba(148, 163, 184, 0.06)"
						/>
						<Controls showInteractive={false} position="bottom-left" />
						<MiniMap
							nodeColor={minimapNodeColor}
							maskColor="rgba(8, 10, 15, 0.75)"
							style={{
								backgroundColor: "rgba(15, 20, 30, 0.95)",
								borderRadius: "10px",
							}}
							pannable
							zoomable
						/>
					</ReactFlow>
				</HighlightContext.Provider>
			</div>
		</div>
	);
}

// Re-export types for consumers
export type { GraphStatsProps, LineageGraphProps } from "./types";
