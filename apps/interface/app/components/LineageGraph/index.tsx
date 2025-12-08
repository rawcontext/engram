"use client";

import React, { useEffect, useCallback, useMemo, useState, createContext, useContext } from 'react';
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

interface LineageGraphProps {
    data: LineageResponse | null;
    onNodeClick?: (node: GraphNode) => void;
    highlightedNodeId?: string | null;
    onNodeHover?: (nodeId: string | null) => void;
}

const nodeWidth = 160;
const nodeHeight = 50;

// Context for highlighted node to avoid prop drilling and re-renders
const HighlightContext = createContext<string | null>(null);

// Radial layout: session at center, thoughts in concentric rings
const getRadialLayout = (nodes: Node[], edges: Edge[], centerX: number, centerY: number) => {
    if (nodes.length === 0) return { nodes: [], edges };

    // Find the session node (root)
    const sessionNode = nodes.find(n => n.data?.type?.toLowerCase() === 'session');
    const otherNodes = nodes.filter(n => n.data?.type?.toLowerCase() !== 'session');

    if (!sessionNode) {
        // Fallback to grid if no session
        return getGridLayout(nodes, edges, centerX, centerY);
    }

    const layoutedNodes: Node[] = [];

    // Place session at center
    layoutedNodes.push({
        ...sessionNode,
        position: { x: centerX - nodeWidth / 2, y: centerY - nodeHeight / 2 },
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
    });

    // Calculate rings based on node count
    const nodeCount = otherNodes.length;
    const nodesPerRing = Math.min(12, Math.max(6, Math.ceil(Math.sqrt(nodeCount) * 2)));
    const ringCount = Math.ceil(nodeCount / nodesPerRing);
    const baseRadius = 180;
    const ringSpacing = 140;

    // Place other nodes in concentric rings
    otherNodes.forEach((node, index) => {
        const ringIndex = Math.floor(index / nodesPerRing);
        const positionInRing = index % nodesPerRing;
        const nodesInThisRing = Math.min(nodesPerRing, nodeCount - ringIndex * nodesPerRing);

        const radius = baseRadius + ringIndex * ringSpacing;
        const angleOffset = ringIndex * 0.3; // Rotate each ring slightly
        const angle = (positionInRing / nodesInThisRing) * 2 * Math.PI + angleOffset;

        // Add some organic randomness
        const jitterX = (Math.sin(index * 7.3) * 15);
        const jitterY = (Math.cos(index * 5.7) * 15);

        layoutedNodes.push({
            ...node,
            position: {
                x: centerX + Math.cos(angle) * radius - nodeWidth / 2 + jitterX,
                y: centerY + Math.sin(angle) * radius - nodeHeight / 2 + jitterY,
            },
            targetPosition: Position.Top,
            sourcePosition: Position.Bottom,
        });
    });

    return { nodes: layoutedNodes, edges };
};

// Grid fallback layout
const getGridLayout = (nodes: Node[], edges: Edge[], centerX: number, centerY: number) => {
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
};

// Node type configurations - Monochrome + Amber palette
// Silver/White (session), Amber (thought/action/observation), Slate (default)
const nodeTypeConfig = {
    session: {
        // Silver/White - clean, prominent session hub
        border: 'rgba(226, 232, 240, 0.8)',
        bg: 'rgba(226, 232, 240, 0.1)',
        glow: 'rgba(226, 232, 240, 0.5)',
        text: 'rgb(226, 232, 240)',
        icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
            </svg>
        ),
    },
    thought: {
        // Amber - warm neural firing (primary accent)
        border: 'rgba(251, 191, 36, 0.7)',
        bg: 'rgba(251, 191, 36, 0.1)',
        glow: 'rgba(251, 191, 36, 0.5)',
        text: 'rgb(251, 191, 36)',
        icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
            </svg>
        ),
    },
    action: {
        // Amber variant - slightly warmer for actions
        border: 'rgba(251, 191, 36, 0.6)',
        bg: 'rgba(251, 191, 36, 0.08)',
        glow: 'rgba(251, 191, 36, 0.4)',
        text: 'rgb(245, 158, 11)',
        icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                />
            </svg>
        ),
    },
    observation: {
        // Slate/Silver - neutral observation
        border: 'rgba(148, 163, 184, 0.6)',
        bg: 'rgba(148, 163, 184, 0.08)',
        glow: 'rgba(148, 163, 184, 0.4)',
        text: 'rgb(148, 163, 184)',
        icon: (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
            </svg>
        ),
    },
    default: {
        border: 'rgba(148, 163, 184, 0.4)',
        bg: 'rgba(148, 163, 184, 0.08)',
        glow: 'rgba(148, 163, 184, 0.25)',
        text: 'rgb(148, 163, 184)',
        icon: null,
    },
};

// Custom node component with neural styling - memoized for performance
const NeuralNode = React.memo(function NeuralNode({ data, selected, id }: NodeProps) {
    const nodeType = (data.type as string)?.toLowerCase() || 'default';
    const isSession = nodeType === 'session';
    const config = nodeTypeConfig[nodeType as keyof typeof nodeTypeConfig] || nodeTypeConfig.default;
    const highlightedNodeId = useContext(HighlightContext);
    const isHighlighted = highlightedNodeId === id;
    const [isHovered, setIsHovered] = useState(false);

    // Truncate label for display
    const displayLabel = useMemo(() => {
        const label = data.label as string;
        if (!label) return 'Node';
        // For UUIDs, show first 8 chars
        if (label.match(/^[a-f0-9-]{36}$/i)) {
            return label.slice(0, 8) + '...';
        }
        return label.length > 16 ? label.slice(0, 16) + '...' : label;
    }, [data.label]);

    const isActive = selected || isHighlighted || isHovered;

    return (
        <div
            style={{
                width: isSession ? nodeWidth + 40 : nodeWidth,
                transform: isActive ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Outer glow effect - always visible for session, on hover for others */}
            <div
                style={{
                    position: 'absolute',
                    inset: '-8px',
                    borderRadius: isSession ? '20px' : '14px',
                    background: `radial-gradient(ellipse at center, ${config.glow}, transparent 70%)`,
                    filter: 'blur(16px)',
                    opacity: isSession ? 0.6 : (isActive ? 0.7 : 0),
                    transition: 'opacity 0.3s ease',
                    pointerEvents: 'none',
                }}
            />

            {/* Animated effects for session node */}
            {isSession && (
                <>
                    {/* Pulsing glow ring */}
                    <div
                        style={{
                            position: 'absolute',
                            inset: '-6px',
                            borderRadius: '18px',
                            border: `2px solid ${config.border}`,
                            animation: 'session-pulse 2.5s ease-in-out infinite',
                            opacity: 0.6,
                        }}
                    />
                    {/* Expanding ring */}
                    <div
                        style={{
                            position: 'absolute',
                            inset: '-8px',
                            borderRadius: '22px',
                            border: `1px solid ${config.border}`,
                            animation: 'session-expand 3s ease-out infinite',
                        }}
                    />
                    <style>{`
                        @keyframes session-pulse {
                            0%, 100% { opacity: 0.6; transform: scale(1); }
                            50% { opacity: 0.3; transform: scale(1.02); }
                        }
                        @keyframes session-expand {
                            0% { transform: scale(1); opacity: 0.4; }
                            100% { transform: scale(1.15); opacity: 0; }
                        }
                    `}</style>
                </>
            )}

            {/* Main node container */}
            <div
                style={{
                    position: 'relative',
                    borderRadius: isSession ? '14px' : '10px',
                    background: isSession
                        ? `linear-gradient(135deg, rgba(226, 232, 240, 0.12) 0%, rgba(12, 15, 22, 0.98) 50%, rgba(226, 232, 240, 0.06) 100%)`
                        : `linear-gradient(135deg, ${config.bg}, rgba(12, 15, 22, 0.95))`,
                    border: `${isSession ? '2px' : '1px'} solid ${isActive ? config.border : config.border.replace(/[\d.]+\)$/, '0.4)')}`,
                    boxShadow: isActive
                        ? `0 0 30px ${config.glow}, 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.1)`
                        : `0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
                    padding: isSession ? '14px 18px' : '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: isSession ? '12px' : '10px',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {/* Icon with background */}
                {config.icon && (
                    <div style={{
                        width: isSession ? '32px' : '26px',
                        height: isSession ? '32px' : '26px',
                        borderRadius: isSession ? '8px' : '6px',
                        background: `linear-gradient(135deg, ${config.bg.replace(/[\d.]+\)$/, '0.3)')}, ${config.bg})`,
                        border: `1px solid ${config.border.replace(/[\d.]+\)$/, '0.3)')}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: config.text,
                        flexShrink: 0,
                        boxShadow: isActive ? `0 0 12px ${config.glow}` : 'none',
                        transition: 'box-shadow 0.2s ease',
                    }}>
                        {config.icon}
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Type label for session */}
                    {isSession && (
                        <div
                            style={{
                                fontFamily: 'Orbitron, sans-serif',
                                fontSize: '9px',
                                fontWeight: 700,
                                letterSpacing: '0.2em',
                                textTransform: 'uppercase',
                                color: config.text,
                                marginBottom: '4px',
                                textShadow: `0 0 10px ${config.glow}`,
                            }}
                        >
                            SESSION
                        </div>
                    )}
                    {/* Type badge for non-session */}
                    {!isSession && (
                        <div
                            style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '8px',
                                fontWeight: 600,
                                letterSpacing: '0.1em',
                                textTransform: 'capitalize',
                                color: config.text,
                                opacity: 0.8,
                                marginBottom: '2px',
                            }}
                        >
                            {nodeType}
                        </div>
                    )}
                    {/* Node label */}
                    <div
                        style={{
                            fontSize: isSession ? '12px' : '10px',
                            fontWeight: 500,
                            fontFamily: 'JetBrains Mono, monospace',
                            color: isSession ? 'rgba(240, 245, 255, 0.95)' : 'rgba(180, 190, 210, 0.9)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                        title={data.label as string}
                    >
                        {displayLabel}
                    </div>
                </div>
            </div>

            {/* Connection handles - styled */}
            <Handle
                type="target"
                position={Position.Top}
                style={{
                    width: '8px',
                    height: '8px',
                    border: 'none',
                    background: `linear-gradient(135deg, ${config.text}, ${config.border})`,
                    boxShadow: `0 0 8px ${config.glow}`,
                    opacity: isActive ? 1 : 0.5,
                    transition: 'opacity 0.2s ease',
                }}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                style={{
                    width: '8px',
                    height: '8px',
                    border: 'none',
                    background: `linear-gradient(135deg, ${config.text}, ${config.border})`,
                    boxShadow: `0 0 8px ${config.glow}`,
                    opacity: isActive ? 1 : 0.5,
                    transition: 'opacity 0.2s ease',
                }}
            />
        </div>
    );
});

// Loading skeleton
function LoadingSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
                <div
                    className="w-16 h-16 rounded-full border-2 border-[rgba(251,191,36,0.3)] animate-pulse"
                    style={{
                        background: 'radial-gradient(circle at 30% 30%, rgba(251,191,36,0.1), transparent 60%)'
                    }}
                />
                <div
                    className="absolute inset-0 w-16 h-16 rounded-full border border-[rgba(148,163,184,0.2)]"
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

// Stats bar for the graph - Monochrome + Amber palette
function GraphStats({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div
            style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                zIndex: 10,
                display: 'flex',
                alignItems: 'stretch',
                borderRadius: '10px',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, rgba(10, 15, 25, 0.95) 0%, rgba(15, 20, 30, 0.9) 100%)',
                border: '1px solid rgba(148, 163, 184, 0.15)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
        >
            {/* Nodes stat - white/silver for clean look */}
            <div
                style={{
                    padding: '10px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(-5px)',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                <span style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'rgb(226, 232, 240)',
                    textShadow: '0 0 20px rgba(226, 232, 240, 0.3)',
                    lineHeight: 1,
                }}>
                    {nodeCount}
                </span>
                <span style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '8px',
                    fontWeight: 600,
                    letterSpacing: '0.15em',
                    color: 'rgba(100, 116, 139, 0.7)',
                    textTransform: 'uppercase',
                }}>
                    nodes
                </span>
            </div>

            {/* Edges stat - amber accent */}
            <div
                style={{
                    padding: '10px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(-5px)',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s',
                }}
            >
                <span style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'rgb(251, 191, 36)',
                    textShadow: '0 0 20px rgba(251, 191, 36, 0.5), 0 0 40px rgba(251, 191, 36, 0.25)',
                    lineHeight: 1,
                }}>
                    {edgeCount}
                </span>
                <span style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '8px',
                    fontWeight: 600,
                    letterSpacing: '0.15em',
                    color: 'rgba(100, 116, 139, 0.7)',
                    textTransform: 'uppercase',
                }}>
                    edges
                </span>
            </div>
        </div>
    );
}

export function LineageGraph({ data, onNodeClick, highlightedNodeId, onNodeHover }: LineageGraphProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Initialize nodes and edges when data changes (not on highlight change)
    useEffect(() => {
        if (!data || !data.nodes || data.nodes.length === 0) {
            setNodes([]);
            setEdges([]);
            return;
        }

        const initialNodes: Node[] = data.nodes.map(n => ({
            id: n.id,
            position: { x: 0, y: 0 },
            data: {
                label: n.label || n.id,
                type: n.type,
                // Don't set isHighlighted here - let the node component read from ref
                ...n,
            },
            type: 'neural',
        }));

        // Create edges with animation
        const initialEdges: Edge[] = data.links.map((l, i) => ({
            id: `e${i}`,
            source: l.source,
            target: l.target,
            animated: true,
            style: {
                stroke: 'url(#edge-gradient)',
                strokeWidth: 1.5,
                opacity: 0.6,
            },
            // Hide labels by default to reduce clutter
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

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [data, setNodes, setEdges]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        onNodeClick?.(node.data as unknown as GraphNode);
    }, [onNodeClick]);

    const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
        onNodeHover?.(node.id);
    }, [onNodeHover]);

    const handleNodeMouseLeave = useCallback(() => {
        onNodeHover?.(null);
    }, [onNodeHover]);

    // Custom minimap node color - Monochrome + Amber palette
    const minimapNodeColor = useCallback((node: Node) => {
        const type = (node.data?.type as string)?.toLowerCase();
        switch (type) {
            case 'session': return 'rgb(226, 232, 240)';    // Silver/White
            case 'thought': return 'rgb(251, 191, 36)';     // Amber
            case 'action': return 'rgb(245, 158, 11)';      // Amber variant
            case 'observation': return 'rgb(148, 163, 184)'; // Slate
            default: return 'rgb(100, 116, 139)';
        }
    }, []);

    if (!data) {
        return (
            <div className="w-full h-full">
                <LoadingSkeleton />
            </div>
        );
    }

    if (!data.nodes || data.nodes.length === 0) {
        return (
            <div className="w-full h-full">
                <EmptyState />
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: '100%', minHeight: '500px', position: 'relative' }}>
            {/* Stats overlay */}
            <GraphStats nodeCount={data.nodes.length} edgeCount={data.links.length} />

            {/* Radial vignette overlay for depth */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 5,
                    background: 'radial-gradient(ellipse at center, transparent 0%, transparent 40%, rgba(0, 0, 0, 0.3) 100%)',
                }}
            />

            {/* Subtle scanline effect */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 6,
                    opacity: 0.02,
                    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(148, 163, 184, 0.5) 2px, rgba(148, 163, 184, 0.5) 4px)',
                }}
            />

            {/* SVG Defs for gradients - Monochrome + Amber style (Performance Optimized) */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <defs>
                    {/* Slate edge gradient with amber warmth at center */}
                    <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="rgb(148, 163, 184)" stopOpacity="0.5" />
                        <stop offset="50%" stopColor="rgb(251, 191, 36)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="rgb(148, 163, 184)" stopOpacity="0.5" />
                    </linearGradient>
                    <linearGradient id="edge-gradient-highlighted" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="rgb(226, 232, 240)" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="rgb(251, 191, 36)" stopOpacity="0.8" />
                    </linearGradient>
                    {/* Removed blur filter - too expensive for 100+ edges */}
                </defs>
            </svg>

            {/* Custom styles for ReactFlow - Monochrome + Amber (Performance Optimized) */}
            <style>{`
                /* GPU acceleration for pan/zoom transforms */
                .react-flow__viewport {
                    will-change: transform;
                }
                .react-flow__edge-path {
                    stroke: url(#edge-gradient) !important;
                    stroke-width: 1.5px !important;
                }
                .react-flow__edge.animated .react-flow__edge-path {
                    stroke-dasharray: 5 3;
                    animation: edgeFlow 1s linear infinite;
                }
                @keyframes edgeFlow {
                    from { stroke-dashoffset: 16; }
                    to { stroke-dashoffset: 0; }
                }
                .react-flow__controls {
                    background: linear-gradient(180deg, rgba(8, 12, 20, 0.98) 0%, rgba(12, 16, 24, 0.95) 100%) !important;
                    border: 1px solid rgba(148, 163, 184, 0.12) !important;
                    border-radius: 8px !important;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.02) !important;
                    overflow: hidden;
                }
                .react-flow__controls-button {
                    background: transparent !important;
                    border: none !important;
                    border-bottom: 1px solid rgba(148, 163, 184, 0.06) !important;
                    color: rgba(148, 163, 184, 0.5) !important;
                    width: 30px !important;
                    height: 30px !important;
                    transition: all 0.2s ease !important;
                }
                .react-flow__controls-button:hover {
                    background: rgba(251, 191, 36, 0.08) !important;
                    color: rgb(251, 191, 36) !important;
                }
                .react-flow__controls-button:last-child {
                    border-bottom: none !important;
                }
                .react-flow__controls-button svg {
                    fill: currentColor !important;
                    max-width: 14px !important;
                    max-height: 14px !important;
                }
                .react-flow__minimap {
                    background: linear-gradient(180deg, rgba(8, 12, 20, 0.98) 0%, rgba(12, 16, 24, 0.95) 100%) !important;
                    border: 1px solid rgba(148, 163, 184, 0.12) !important;
                    border-radius: 8px !important;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5) !important;
                    overflow: hidden;
                }
                .react-flow__minimap-mask {
                    fill: rgba(5, 8, 12, 0.8) !important;
                }
                /* Optimize node rendering */
                .react-flow__node {
                    will-change: transform;
                }
            `}</style>

            <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
            <HighlightContext.Provider value={highlightedNodeId ?? null}>
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
                        type: 'default',
                    }}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={24}
                        size={1}
                        color="rgba(148, 163, 184, 0.06)"
                    />
                    <Controls
                        showInteractive={false}
                        position="bottom-left"
                    />
                    <MiniMap
                        nodeColor={minimapNodeColor}
                        maskColor="rgba(8, 10, 15, 0.75)"
                        style={{
                            backgroundColor: 'rgba(15, 20, 30, 0.95)',
                            borderRadius: '10px',
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
