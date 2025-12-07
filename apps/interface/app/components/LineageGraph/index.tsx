"use client";

import React, { useEffect, useCallback, useMemo } from 'react';
import {
    ReactFlow,
    useNodesState,
    useEdgesState,
    Background,
    Controls,
    MiniMap,
    type Node,
    type Edge,
    Position,
    BackgroundVariant,
    Handle,
    type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LineageResponse, GraphNode } from '@lib/types';
import dagre from 'dagre';

interface LineageGraphProps {
    data: LineageResponse | null;
    onNodeClick?: (node: GraphNode) => void;
}

const nodeWidth = 180;
const nodeHeight = 60;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 50 });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            targetPosition: Position.Top,
            sourcePosition: Position.Bottom,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

// Custom node component with neural styling
function NeuralNode({ data, selected }: NodeProps) {
    const nodeType = data.type as string || 'default';

    // Different colors for different node types
    const getNodeColors = (type: string) => {
        switch (type?.toLowerCase()) {
            case 'session':
                return {
                    border: 'rgba(0, 245, 212, 0.6)',
                    bg: 'rgba(0, 245, 212, 0.15)',
                    glow: 'rgba(0, 245, 212, 0.4)',
                    text: 'rgb(0, 245, 212)',
                };
            case 'thought':
                return {
                    border: 'rgba(139, 92, 246, 0.6)',
                    bg: 'rgba(139, 92, 246, 0.15)',
                    glow: 'rgba(139, 92, 246, 0.4)',
                    text: 'rgb(139, 92, 246)',
                };
            case 'action':
                return {
                    border: 'rgba(236, 72, 153, 0.6)',
                    bg: 'rgba(236, 72, 153, 0.15)',
                    glow: 'rgba(236, 72, 153, 0.4)',
                    text: 'rgb(236, 72, 153)',
                };
            case 'observation':
                return {
                    border: 'rgba(59, 130, 246, 0.6)',
                    bg: 'rgba(59, 130, 246, 0.15)',
                    glow: 'rgba(59, 130, 246, 0.4)',
                    text: 'rgb(59, 130, 246)',
                };
            default:
                return {
                    border: 'rgba(148, 163, 184, 0.4)',
                    bg: 'rgba(148, 163, 184, 0.1)',
                    glow: 'rgba(148, 163, 184, 0.2)',
                    text: 'rgb(148, 163, 184)',
                };
        }
    };

    const colors = getNodeColors(nodeType);

    return (
        <div
            className="relative group"
            style={{
                width: nodeWidth,
                minHeight: nodeHeight,
            }}
        >
            {/* Glow effect on hover/select */}
            <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                    background: `radial-gradient(ellipse at center, ${colors.glow}, transparent 70%)`,
                    filter: 'blur(10px)',
                    transform: 'scale(1.2)',
                    opacity: selected ? 1 : undefined,
                }}
            />

            {/* Main node container */}
            <div
                className="relative rounded-xl px-4 py-3 transition-all duration-300"
                style={{
                    background: `linear-gradient(135deg, ${colors.bg}, rgba(15, 20, 30, 0.9))`,
                    border: `1px solid ${colors.border}`,
                    boxShadow: selected
                        ? `0 0 20px ${colors.glow}, inset 0 0 15px ${colors.glow}`
                        : `0 4px 20px rgba(0, 0, 0, 0.3)`,
                }}
            >
                {/* Type badge */}
                <div
                    className="absolute -top-2 left-3 px-2 py-0.5 rounded text-[9px] font-medium tracking-wider uppercase"
                    style={{
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        color: colors.text,
                    }}
                >
                    {nodeType}
                </div>

                {/* Label */}
                <div
                    className="text-xs font-medium truncate mt-1"
                    style={{ color: 'rgb(240, 245, 255)' }}
                    title={data.label as string}
                >
                    {data.label as string}
                </div>

                {/* Subtle animated pulse on the border */}
                <div
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    style={{
                        border: `1px solid ${colors.border}`,
                        animation: selected ? 'pulse-glow 2s ease-in-out infinite' : 'none',
                    }}
                />
            </div>

            {/* Connection handles */}
            <Handle
                type="target"
                position={Position.Top}
                className="!w-2 !h-2 !border-0"
                style={{
                    background: colors.text,
                    boxShadow: `0 0 8px ${colors.glow}`,
                }}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-2 !h-2 !border-0"
                style={{
                    background: colors.text,
                    boxShadow: `0 0 8px ${colors.glow}`,
                }}
            />
        </div>
    );
}

// Loading skeleton
function LoadingSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
                <div
                    className="w-16 h-16 rounded-full border-2 border-[rgba(0,245,212,0.3)] animate-pulse"
                    style={{
                        background: 'radial-gradient(circle at 30% 30%, rgba(0,245,212,0.1), transparent 60%)'
                    }}
                />
                <div
                    className="absolute inset-0 w-16 h-16 rounded-full border border-[rgba(139,92,246,0.2)]"
                    style={{ animation: 'spin 3s linear infinite' }}
                />
            </div>
            <div className="text-sm text-[rgb(100,116,139)] tracking-wide">
                Loading neural pathways...
            </div>
            <style jsx>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

// Empty state
function EmptyState() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', textAlign: 'center', padding: '0 32px' }}>
            <svg
                style={{ width: '64px', height: '64px', color: 'rgb(100,116,139)', opacity: 0.5, flexShrink: 0 }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
            </svg>
            <div>
                <div style={{ color: 'rgb(148,163,184)', marginBottom: '4px' }}>No neural pathways detected</div>
                <div style={{ fontSize: '12px', color: 'rgb(100,116,139)' }}>
                    Waiting for session activity...
                </div>
            </div>
        </div>
    );
}

const nodeTypes = {
    neural: NeuralNode,
};

export function LineageGraph({ data, onNodeClick }: LineageGraphProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        if (!data || !data.nodes || data.nodes.length === 0) {
            setNodes([]);
            setEdges([]);
            return;
        }

        const initialNodes: Node[] = data.nodes.map(n => ({
            id: n.id,
            position: { x: 0, y: 0 },
            data: { label: n.label || n.id, type: n.type, ...n },
            type: 'neural',
        }));

        const initialEdges: Edge[] = data.links.map((l, i) => ({
            id: `e${i}`,
            source: l.source,
            target: l.target,
            label: l.type,
            animated: true,
            style: {
                stroke: 'url(#edge-gradient)',
                strokeWidth: 2,
            },
            labelStyle: {
                fill: 'rgb(100, 116, 139)',
                fontSize: 10,
                fontFamily: 'JetBrains Mono, monospace',
            },
            labelBgStyle: {
                fill: 'rgba(15, 20, 30, 0.9)',
                stroke: 'rgba(0, 245, 212, 0.2)',
            },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
        }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            initialNodes,
            initialEdges,
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [data, setNodes, setEdges]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        onNodeClick?.(node.data as unknown as GraphNode);
    }, [onNodeClick]);

    // Custom minimap node color
    const minimapNodeColor = useCallback((node: Node) => {
        const type = node.data?.type as string;
        switch (type?.toLowerCase()) {
            case 'session': return 'rgb(0, 245, 212)';
            case 'thought': return 'rgb(139, 92, 246)';
            case 'action': return 'rgb(236, 72, 153)';
            case 'observation': return 'rgb(59, 130, 246)';
            default: return 'rgb(148, 163, 184)';
        }
    }, []);

    if (!data) {
        return (
            <div style={{ width: '100%', height: '100%' }}>
                <LoadingSkeleton />
            </div>
        );
    }

    if (!data.nodes || data.nodes.length === 0) {
        return (
            <div style={{ width: '100%', height: '100%' }}>
                <EmptyState />
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: '600px', position: 'relative' }}>
            {/* SVG Defs for gradients */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <defs>
                    <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="rgb(0, 245, 212)" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0.8" />
                    </linearGradient>
                </defs>
            </svg>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.3}
                maxZoom={1.5}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="rgba(0, 245, 212, 0.15)"
                />
                <Controls
                    showInteractive={false}
                />
                <MiniMap
                    nodeColor={minimapNodeColor}
                    maskColor="rgba(8, 10, 15, 0.8)"
                    style={{
                        backgroundColor: 'rgba(15, 20, 30, 0.8)',
                    }}
                />
            </ReactFlow>
        </div>
    );
}
