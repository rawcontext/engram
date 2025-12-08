"use client";

import React, { useState, Suspense, useCallback } from 'react';
import dynamic from "next/dynamic";
import { LineageGraph } from "../../components/LineageGraph";
import { SessionReplay } from "../../components/SessionReplay";
import { useSessionStream } from "../../hooks/useSessionStream";
import type { GraphNode } from "@lib/types";
import Link from 'next/link';

// Dynamically import Three.js background to avoid SSR issues
const NeuralBackground = dynamic(
  () => import("../../components/NeuralBackground").then((mod) => mod.NeuralBackground),
  { ssr: false }
);

// Pre-computed particle positions to avoid hydration mismatch
const PARTICLE_DATA = [
    { x: 12, y: 85, size: 1.5, duration: 22, delay: 3, opacity: 0.25 },
    { x: 45, y: 15, size: 2.2, duration: 28, delay: 7, opacity: 0.32 },
    { x: 78, y: 42, size: 1.8, duration: 19, delay: 1, opacity: 0.28 },
    { x: 23, y: 67, size: 2.5, duration: 31, delay: 5, opacity: 0.35 },
    { x: 91, y: 23, size: 1.2, duration: 25, delay: 9, opacity: 0.22 },
    { x: 56, y: 89, size: 2.0, duration: 17, delay: 2, opacity: 0.30 },
    { x: 34, y: 34, size: 1.6, duration: 33, delay: 6, opacity: 0.27 },
    { x: 67, y: 56, size: 2.8, duration: 21, delay: 4, opacity: 0.38 },
    { x: 8, y: 12, size: 1.3, duration: 29, delay: 8, opacity: 0.24 },
    { x: 89, y: 78, size: 2.3, duration: 16, delay: 0, opacity: 0.33 },
    { x: 41, y: 91, size: 1.9, duration: 27, delay: 3, opacity: 0.29 },
    { x: 72, y: 8, size: 2.6, duration: 23, delay: 7, opacity: 0.36 },
    { x: 15, y: 45, size: 1.4, duration: 32, delay: 1, opacity: 0.26 },
    { x: 58, y: 62, size: 2.1, duration: 18, delay: 5, opacity: 0.31 },
    { x: 95, y: 95, size: 1.7, duration: 26, delay: 9, opacity: 0.23 },
];

// Animated background particles (lighter version for session view)
function Particles() {
    return (
        <div className="particles">
            {PARTICLE_DATA.map((p, i) => (
                <div
                    key={i}
                    className="particle"
                    style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        animation: `float ${p.duration}s ease-in-out infinite`,
                        animationDelay: `${p.delay}s`,
                        opacity: p.opacity,
                    }}
                />
            ))}
        </div>
    );
}

export function SessionView({ sessionId }: { sessionId: string }) {
    // Use real-time WebSocket streaming with polling fallback
    const {
        lineage: lineageData,
        replay: replayData,
        isConnected,
        error,
    } = useSessionStream({ sessionId });

    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

    const lineageLoading = !lineageData && !error;
    const replayLoading = !replayData && !error;

    // Handle hover events from both panels
    const handleGraphNodeHover = useCallback((nodeId: string | null) => {
        setHighlightedNodeId(nodeId);
    }, []);

    const handleTimelineEventHover = useCallback((nodeId: string | null) => {
        setHighlightedNodeId(nodeId);
    }, []);

    return (
        <div style={{ minHeight: '100vh', position: 'relative' }}>
            {/* Three.js Neural Background */}
            <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.4 }}>
                <Suspense fallback={null}>
                    <NeuralBackground />
                </Suspense>
            </div>
            <Particles />

            {/* Header - Monochrome with amber accent */}
            <header
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                    background: 'rgba(12, 14, 20, 0.95)',
                    backdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                }}
            >
                <div
                    style={{
                        maxWidth: '1400px',
                        margin: '0 auto',
                        padding: '16px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    {/* Logo and nav */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Link
                            href="/"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                textDecoration: 'none',
                            }}
                        >
                            <div
                                style={{
                                    position: 'relative',
                                    width: '32px',
                                    height: '32px',
                                }}
                            >
                                <div
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        border: '1px solid rgba(251, 191, 36, 0.4)',
                                        background: 'radial-gradient(circle at 30% 30%, rgba(251, 191, 36, 0.2), transparent 60%)',
                                    }}
                                />
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        width: '12px',
                                        height: '12px',
                                        borderRadius: '50%',
                                        background: 'radial-gradient(circle, rgba(251, 191, 36, 0.9), transparent 70%)',
                                        boxShadow: '0 0 15px rgba(251, 191, 36, 0.5)',
                                    }}
                                />
                            </div>
                            <span
                                style={{
                                    fontFamily: 'Orbitron, sans-serif',
                                    fontSize: '18px',
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    color: 'rgb(251, 191, 36)',
                                }}
                            >
                                SOUL
                            </span>
                        </Link>

                        <div style={{ height: '24px', width: '1px', background: 'rgba(148, 163, 184, 0.15)' }} />

                        <nav style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgb(100, 116, 139)' }}>
                            <span>Sessions</span>
                            <svg style={{ width: '14px', height: '14px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span
                                style={{
                                    color: 'rgb(226, 232, 240)',
                                    fontWeight: 500,
                                    fontFamily: 'JetBrains Mono, monospace',
                                    fontSize: '11px',
                                    maxWidth: '180px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {sessionId}
                            </span>
                        </nav>
                    </div>

                    {/* Status indicators */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'rgb(100, 116, 139)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                                style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    backgroundColor: isConnected ? 'rgb(34, 197, 94)' : 'rgb(250, 204, 21)',
                                    boxShadow: isConnected
                                        ? '0 0 8px rgba(34, 197, 94, 0.6)'
                                        : '0 0 8px rgba(250, 204, 21, 0.6)',
                                }}
                            />
                            <span>{isConnected ? 'Live' : 'Polling'}</span>
                        </div>
                        <span style={{ color: 'rgb(45, 55, 72)' }}>|</span>
                        <span>{lineageData?.nodes?.length || 0} nodes</span>
                        <span style={{ color: 'rgb(45, 55, 72)' }}>|</span>
                        <span>{replayData?.timeline?.length || 0} events</span>
                    </div>
                </div>
            </header>

            {/* Main content - Two column layout, full width */}
            <main
                style={{
                    height: 'calc(100vh - 65px)',
                    padding: '16px',
                    position: 'relative',
                    zIndex: 10,
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '16px',
                        height: '100%',
                    }}
                >
                    {/* Left Column - Lineage Graph */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                            <h2
                                style={{
                                    fontFamily: 'Orbitron, sans-serif',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    margin: 0,
                                }}
                            >
                                <span
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: 'rgb(251, 191, 36)',
                                        boxShadow: '0 0 10px rgba(251, 191, 36, 0.5)',
                                    }}
                                />
                                <span style={{ color: 'rgb(226, 232, 240)' }}>
                                    LINEAGE GRAPH
                                </span>
                            </h2>
                            {lineageLoading && (
                                <span style={{ fontSize: '11px', color: 'rgb(100, 116, 139)' }}>
                                    Syncing...
                                </span>
                            )}
                        </div>

                        <div
                            style={{
                                position: 'relative',
                                background: 'rgba(12, 14, 20, 0.7)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(148, 163, 184, 0.1)',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                flex: 1,
                                minHeight: 0,
                            }}
                        >
                            <LineageGraph
                                data={lineageData || null}
                                onNodeClick={setSelectedNode}
                                highlightedNodeId={highlightedNodeId}
                                onNodeHover={handleGraphNodeHover}
                            />

                            {/* Node details panel - overlay inside graph */}
                            {selectedNode && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        bottom: '16px',
                                        left: '16px',
                                        right: '16px',
                                        maxWidth: '400px',
                                        background: 'rgba(12, 14, 20, 0.95)',
                                        backdropFilter: 'blur(20px)',
                                        border: '1px solid rgba(251, 191, 36, 0.25)',
                                        borderRadius: '12px',
                                        padding: '16px',
                                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(251, 191, 36, 0.08)',
                                        zIndex: 20,
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontSize: '10px', color: 'rgb(100, 116, 139)', marginBottom: '4px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                                Selected Node
                                            </div>
                                            <h3 style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '14px', color: 'rgb(251, 191, 36)', margin: 0, letterSpacing: '0.05em' }}>
                                                {selectedNode.label}
                                            </h3>
                                        </div>
                                        <button
                                            onClick={() => setSelectedNode(null)}
                                            style={{
                                                padding: '6px',
                                                borderRadius: '6px',
                                                background: 'rgba(148, 163, 184, 0.1)',
                                                border: 'none',
                                                color: 'rgb(148, 163, 184)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    <pre
                                        style={{
                                            fontSize: '10px',
                                            overflow: 'auto',
                                            maxHeight: '120px',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            background: 'rgba(8, 10, 15, 0.8)',
                                            border: '1px solid rgba(148, 163, 184, 0.1)',
                                            color: 'rgb(148, 163, 184)',
                                            margin: 0,
                                            fontFamily: 'JetBrains Mono, monospace',
                                        }}
                                    >
                                        {JSON.stringify(selectedNode, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column - Thought Stream */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                            <h2
                                style={{
                                    fontFamily: 'Orbitron, sans-serif',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    margin: 0,
                                }}
                            >
                                <span
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: 'rgb(251, 191, 36)',
                                        boxShadow: '0 0 10px rgba(251, 191, 36, 0.5)',
                                    }}
                                />
                                <span style={{ color: 'rgb(226, 232, 240)' }}>THOUGHT STREAM</span>
                            </h2>
                            {replayLoading && (
                                <span style={{ fontSize: '11px', color: 'rgb(100, 116, 139)' }}>
                                    Syncing...
                                </span>
                            )}
                        </div>

                        <div
                            style={{
                                background: 'rgba(12, 14, 20, 0.7)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(148, 163, 184, 0.1)',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                flex: 1,
                                minHeight: 0,
                            }}
                        >
                            <SessionReplay
                                data={replayData || null}
                                selectedNodeId={selectedNode?.id || highlightedNodeId}
                                onEventHover={handleTimelineEventHover}
                            />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
