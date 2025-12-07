"use client";

import React, { useState, Suspense } from 'react';
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

// Animated background particles (lighter version for session view)
function Particles() {
    const particles = Array.from({ length: 15 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 1,
        duration: Math.random() * 20 + 15,
        delay: Math.random() * 10,
    }));

    return (
        <div className="particles">
            {particles.map((p) => (
                <div
                    key={p.id}
                    className="particle"
                    style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        animation: `float ${p.duration}s ease-in-out infinite`,
                        animationDelay: `${p.delay}s`,
                        opacity: 0.2 + Math.random() * 0.2,
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

    const lineageLoading = !lineageData && !error;
    const replayLoading = !replayData && !error;

    return (
        <div style={{ minHeight: '100vh', position: 'relative' }}>
            {/* Three.js Neural Background */}
            <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.4 }}>
                <Suspense fallback={null}>
                    <NeuralBackground />
                </Suspense>
            </div>
            <Particles />

            {/* Header */}
            <header
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                    background: 'rgba(15, 20, 30, 0.9)',
                    backdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(0, 245, 212, 0.1)',
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
                                        border: '1px solid rgba(0, 245, 212, 0.4)',
                                        background: 'radial-gradient(circle at 30% 30%, rgba(0,245,212,0.3), transparent 60%)',
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
                                        background: 'radial-gradient(circle, rgba(0,245,212,0.9), transparent 70%)',
                                        boxShadow: '0 0 15px rgba(0,245,212,0.6)',
                                    }}
                                />
                            </div>
                            <span
                                style={{
                                    fontFamily: 'Orbitron, sans-serif',
                                    fontSize: '18px',
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    color: 'rgb(0, 245, 212)',
                                }}
                            >
                                SOUL
                            </span>
                        </Link>

                        <div style={{ height: '24px', width: '1px', background: 'rgba(0, 245, 212, 0.2)' }} />

                        <nav style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgb(100, 116, 139)' }}>
                            <span>Sessions</span>
                            <svg style={{ width: '14px', height: '14px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span
                                style={{
                                    color: 'rgb(0, 245, 212)',
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

            {/* Main content - Two column layout */}
            <main
                style={{
                    maxWidth: '1400px',
                    margin: '0 auto',
                    padding: '24px',
                    position: 'relative',
                    zIndex: 10,
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '24px',
                        alignItems: 'start',
                    }}
                >
                    {/* Left Column - Lineage Graph */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                                        backgroundColor: 'rgb(0, 245, 212)',
                                        boxShadow: '0 0 10px rgba(0, 245, 212, 0.6)',
                                    }}
                                />
                                <span
                                    style={{
                                        background: 'linear-gradient(135deg, rgb(0, 245, 212), rgb(139, 92, 246))',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        backgroundClip: 'text',
                                    }}
                                >
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
                                background: 'rgba(15, 20, 30, 0.6)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(0, 245, 212, 0.1)',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                height: 'calc(100vh - 200px)',
                                minHeight: '500px',
                            }}
                        >
                            <LineageGraph
                                data={lineageData || null}
                                onNodeClick={setSelectedNode}
                            />
                        </div>

                        {/* Node details panel */}
                        {selectedNode && (
                            <div
                                style={{
                                    background: 'rgba(15, 20, 30, 0.8)',
                                    backdropFilter: 'blur(20px)',
                                    border: '1px solid rgba(0, 245, 212, 0.3)',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    boxShadow: '0 0 15px rgba(0, 245, 212, 0.1)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                    <div>
                                        <div style={{ fontSize: '11px', color: 'rgb(100, 116, 139)', marginBottom: '4px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                            Selected Node
                                        </div>
                                        <h3 style={{ fontFamily: 'Orbitron, sans-serif', color: 'rgb(0, 245, 212)', margin: 0, letterSpacing: '0.05em' }}>
                                            {selectedNode.label}
                                        </h3>
                                    </div>
                                    <button
                                        onClick={() => setSelectedNode(null)}
                                        style={{
                                            padding: '8px',
                                            borderRadius: '8px',
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'rgb(100, 116, 139)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                                <pre
                                    style={{
                                        fontSize: '11px',
                                        overflow: 'auto',
                                        maxHeight: '150px',
                                        padding: '16px',
                                        borderRadius: '8px',
                                        background: 'rgba(8, 10, 15, 0.8)',
                                        border: '1px solid rgba(0, 245, 212, 0.1)',
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

                    {/* Right Column - Thought Stream */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                                        backgroundColor: 'rgb(139, 92, 246)',
                                        boxShadow: '0 0 10px rgba(139, 92, 246, 0.6)',
                                    }}
                                />
                                <span style={{ color: 'rgb(139, 92, 246)' }}>THOUGHT STREAM</span>
                            </h2>
                            {replayLoading && (
                                <span style={{ fontSize: '11px', color: 'rgb(100, 116, 139)' }}>
                                    Syncing...
                                </span>
                            )}
                        </div>

                        <div
                            style={{
                                background: 'rgba(15, 20, 30, 0.6)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(139, 92, 246, 0.1)',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                height: 'calc(100vh - 200px)',
                                minHeight: '500px',
                            }}
                        >
                            <SessionReplay data={replayData || null} />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
