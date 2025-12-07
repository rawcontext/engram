"use client";

import React from 'react';
import type { ReplayResponse } from '@lib/types';

interface SessionReplayProps {
    data: ReplayResponse | null;
}

// Get icon and color based on event type
function getEventStyle(item: Record<string, unknown>) {
    const type = (item.type as string)?.toLowerCase() || '';
    const role = (item.role as string)?.toLowerCase() || '';

    if (type.includes('thought') || role === 'assistant') {
        return {
            color: 'rgb(139, 92, 246)',
            bgColor: 'rgba(139, 92, 246, 0.1)',
            borderColor: 'rgba(139, 92, 246, 0.3)',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                </svg>
            ),
            label: 'Thought',
        };
    }

    if (type.includes('action') || type.includes('tool')) {
        return {
            color: 'rgb(236, 72, 153)',
            bgColor: 'rgba(236, 72, 153, 0.1)',
            borderColor: 'rgba(236, 72, 153, 0.3)',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                </svg>
            ),
            label: 'Action',
        };
    }

    if (type.includes('observation') || role === 'user') {
        return {
            color: 'rgb(59, 130, 246)',
            bgColor: 'rgba(59, 130, 246, 0.1)',
            borderColor: 'rgba(59, 130, 246, 0.3)',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                </svg>
            ),
            label: 'Observation',
        };
    }

    // Default / Session
    return {
        color: 'rgb(0, 245, 212)',
        bgColor: 'rgba(0, 245, 212, 0.1)',
        borderColor: 'rgba(0, 245, 212, 0.3)',
        icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                />
            </svg>
        ),
        label: type || 'Event',
    };
}

// Format content for display
function formatContent(item: Record<string, unknown>): string {
    // Try to extract meaningful content
    const content = item.content || item.message || item.text || item.data;

    if (typeof content === 'string') {
        return content.length > 500 ? content.slice(0, 500) + '...' : content;
    }

    if (content && typeof content === 'object') {
        return JSON.stringify(content, null, 2);
    }

    // Fallback to full item (excluding some noise fields)
    const { id, type, timestamp, ...rest } = item;
    return JSON.stringify(rest, null, 2);
}

// Loading skeleton
function LoadingSkeleton() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px' }}>
            <div style={{ position: 'relative' }}>
                <div
                    style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        border: '2px solid rgba(139,92,246,0.3)',
                        background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.1), transparent 60%)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        border: '1px solid rgba(0,245,212,0.2)',
                        animation: 'spin 3s linear infinite',
                    }}
                />
            </div>
            <div style={{ fontSize: '14px', color: 'rgb(100,116,139)', letterSpacing: '0.05em' }}>
                Loading thought stream...
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
                style={{ width: '64px', height: '64px', color: 'rgb(139,92,246)', opacity: 0.5, flexShrink: 0 }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
            <div>
                <div style={{ color: 'rgb(148,163,184)', marginBottom: '4px' }}>No thoughts recorded</div>
                <div style={{ fontSize: '12px', color: 'rgb(100,116,139)' }}>
                    Waiting for cognitive activity...
                </div>
            </div>
        </div>
    );
}

export function SessionReplay({ data }: SessionReplayProps) {
    if (!data) {
        return (
            <div style={{ width: '100%', height: '100%' }}>
                <LoadingSkeleton />
            </div>
        );
    }

    if (!data.timeline || data.timeline.length === 0) {
        return (
            <div style={{ width: '100%', height: '100%' }}>
                <EmptyState />
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', overflowY: 'auto', height: '100%' }}>
            {/* Timeline connector line */}
            <div
                className="absolute left-[27px] top-0 bottom-0 w-px"
                style={{
                    background: 'linear-gradient(to bottom, rgba(0,245,212,0.3), rgba(139,92,246,0.3), rgba(0,245,212,0.3))'
                }}
            />

            <div className="p-4 space-y-4">
                {data.timeline.map((item, i) => {
                    if (!item) return null;

                    const style = getEventStyle(item as Record<string, unknown>);
                    const content = formatContent(item as Record<string, unknown>);
                    const timestamp = (item as Record<string, unknown>).timestamp as string;

                    return (
                        <div
                            key={(item as Record<string, unknown>).id as string || i}
                            className="relative flex gap-4 animate-fade-in-up"
                            style={{ animationDelay: `${Math.min(i * 0.05, 0.5)}s` }}
                        >
                            {/* Timeline node */}
                            <div
                                className="relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110"
                                style={{
                                    background: style.bgColor,
                                    border: `1px solid ${style.borderColor}`,
                                    color: style.color,
                                    boxShadow: `0 0 15px ${style.bgColor}`,
                                }}
                            >
                                {style.icon}
                            </div>

                            {/* Content card */}
                            <div className="flex-1 min-w-0">
                                {/* Header */}
                                <div className="flex items-center gap-2 mb-2">
                                    <span
                                        className="text-xs font-medium tracking-wider uppercase"
                                        style={{ color: style.color }}
                                    >
                                        {style.label}
                                    </span>
                                    <span className="text-[rgb(45,55,72)]">•</span>
                                    <span className="text-xs text-[rgb(100,116,139)]">
                                        Step {i + 1}
                                    </span>
                                    {timestamp && (
                                        <>
                                            <span className="text-[rgb(45,55,72)]">•</span>
                                            <span className="text-xs text-[rgb(100,116,139)]">
                                                {new Date(timestamp).toLocaleTimeString()}
                                            </span>
                                        </>
                                    )}
                                </div>

                                {/* Content */}
                                <div
                                    className="rounded-lg p-3 transition-all duration-300 hover:border-opacity-50"
                                    style={{
                                        background: 'rgba(15, 20, 30, 0.6)',
                                        border: `1px solid ${style.borderColor}`,
                                    }}
                                >
                                    <pre className="text-xs whitespace-pre-wrap break-words text-[rgb(148,163,184)] overflow-hidden">
                                        {content}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
