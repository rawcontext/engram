"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamically import Three.js background to avoid SSR issues
const NeuralBackground = dynamic(
  () => import("./components/NeuralBackground").then((mod) => mod.NeuralBackground),
  { ssr: false }
);

// Floating particle component (fallback/additional particles)
function Particles() {
    const [particles, setParticles] = useState<Array<{
        id: number;
        x: number;
        y: number;
        size: number;
        duration: number;
        delay: number;
    }>>([]);

    useEffect(() => {
        const newParticles = Array.from({ length: 30 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: Math.random() * 3 + 1,
            duration: Math.random() * 20 + 15,
            delay: Math.random() * 10,
        }));
        setParticles(newParticles);
    }, []);

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
                        opacity: 0.3 + Math.random() * 0.4,
                    }}
                />
            ))}
        </div>
    );
}

// Animated neural network decoration
function NeuralDecoration() {
    return (
        <svg
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                opacity: 0.2
            }}
            viewBox="0 0 800 600"
            preserveAspectRatio="xMidYMid slice"
        >
            <defs>
                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgb(0, 245, 212)" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0.6" />
                </linearGradient>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                    <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {/* Neural connection lines */}
            <g stroke="url(#lineGradient)" strokeWidth="1" fill="none" filter="url(#glow)">
                <path d="M 100,100 Q 200,50 300,150" className="animate-pulse" />
                <path d="M 300,150 Q 400,200 500,100" style={{ animationDelay: '0.5s' }} className="animate-pulse" />
                <path d="M 500,100 Q 600,50 700,150" style={{ animationDelay: '1s' }} className="animate-pulse" />
                <path d="M 150,400 Q 250,350 350,450" style={{ animationDelay: '0.3s' }} className="animate-pulse" />
                <path d="M 450,350 Q 550,300 650,400" style={{ animationDelay: '0.7s' }} className="animate-pulse" />
            </g>

            {/* Neural nodes */}
            <g fill="rgb(0, 245, 212)" filter="url(#glow)">
                <circle cx="100" cy="100" r="4" className="animate-pulse" />
                <circle cx="300" cy="150" r="5" style={{ animationDelay: '0.2s' }} className="animate-pulse" />
                <circle cx="500" cy="100" r="4" style={{ animationDelay: '0.4s' }} className="animate-pulse" />
                <circle cx="700" cy="150" r="5" style={{ animationDelay: '0.6s' }} className="animate-pulse" />
                <circle cx="150" cy="400" r="4" style={{ animationDelay: '0.1s' }} className="animate-pulse" />
                <circle cx="350" cy="450" r="5" style={{ animationDelay: '0.3s' }} className="animate-pulse" />
                <circle cx="450" cy="350" r="4" style={{ animationDelay: '0.5s' }} className="animate-pulse" />
                <circle cx="650" cy="400" r="5" style={{ animationDelay: '0.7s' }} className="animate-pulse" />
            </g>
        </svg>
    );
}

export default function HomePage() {
    const [sessionId, setSessionId] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (sessionId) {
            router.push(`/session/${sessionId}`);
        }
    };

    return (
        <div
            style={{
                position: 'relative',
                minHeight: '100vh',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            {/* Background decorations - absolute positioned */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <Suspense fallback={null}>
                    <NeuralBackground />
                </Suspense>
                <Particles />
            </div>

            {/* Centered content container */}
            <div
                className="relative z-10 px-4 py-12"
                style={{
                    position: 'relative',
                    zIndex: 10
                }}
            >
                <div
                    className={`w-full transition-all duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`}
                    style={{
                        maxWidth: '32rem',
                        transform: mounted ? 'translateY(0)' : 'translateY(2rem)'
                    }}
                >
                    {/* Logo/Brand area */}
                    <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                        {/* Animated orbital rings */}
                        <div
                            style={{
                                position: 'relative',
                                width: '120px',
                                height: '120px',
                                margin: '0 auto 2rem auto',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {/* Outer ring */}
                            <div
                                style={{
                                    position: 'absolute',
                                    width: '120px',
                                    height: '120px',
                                    borderRadius: '50%',
                                    border: '1px solid rgba(0,245,212,0.2)',
                                    animation: 'spin 30s linear infinite reverse',
                                }}
                            />
                            {/* Middle ring */}
                            <div
                                style={{
                                    position: 'absolute',
                                    width: '90px',
                                    height: '90px',
                                    borderRadius: '50%',
                                    border: '1px solid rgba(139,92,246,0.3)',
                                    animation: 'spin 20s linear infinite',
                                }}
                            />
                            {/* Inner ring with glow */}
                            <div
                                style={{
                                    position: 'absolute',
                                    width: '60px',
                                    height: '60px',
                                    borderRadius: '50%',
                                    border: '1px solid rgba(0,245,212,0.5)',
                                    background: 'radial-gradient(circle at 30% 30%, rgba(0,245,212,0.2), transparent 60%)',
                                    boxShadow: '0 0 20px rgba(0,245,212,0.2), inset 0 0 20px rgba(0,245,212,0.1)',
                                }}
                            />
                            {/* Core glow */}
                            <div
                                style={{
                                    position: 'absolute',
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    background: 'radial-gradient(circle, rgba(0,245,212,1), rgba(0,245,212,0.5) 40%, transparent 70%)',
                                    boxShadow: '0 0 30px rgba(0,245,212,0.8), 0 0 60px rgba(0,245,212,0.4)',
                                }}
                            />
                        </div>

                        <h1
                            className="font-display text-glow"
                            style={{
                                fontSize: '2.5rem',
                                fontWeight: 700,
                                letterSpacing: '0.1em',
                                marginBottom: '1rem'
                            }}
                        >
                            SOUL SYSTEM
                        </h1>
                        <p style={{ color: 'rgb(148,163,184)', fontSize: '0.875rem', letterSpacing: '0.3em', textTransform: 'uppercase' }}>
                            Neural Observatory
                        </p>
                    </div>

                    {/* Session input card */}
                    <div
                        style={{
                            background: 'rgba(15, 20, 30, 0.8)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(0, 245, 212, 0.15)',
                            borderRadius: '16px',
                            padding: '2rem',
                        }}
                    >
                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label
                                    htmlFor="sessionId"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        color: 'rgb(148, 163, 184)',
                                        letterSpacing: '0.1em',
                                        marginBottom: '12px',
                                    }}
                                >
                                    <span
                                        style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: 'rgb(0, 245, 212)',
                                            boxShadow: '0 0 10px rgba(0, 245, 212, 0.6)',
                                            animation: 'pulse 2s ease-in-out infinite',
                                        }}
                                    />
                                    SESSION IDENTIFIER
                                </label>
                                <input
                                    id="sessionId"
                                    type="text"
                                    value={sessionId}
                                    onChange={(e) => setSessionId(e.target.value)}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    placeholder="Enter session UUID..."
                                    autoComplete="off"
                                    spellCheck={false}
                                    style={{
                                        width: '100%',
                                        padding: '16px 20px',
                                        fontSize: '14px',
                                        fontFamily: 'JetBrains Mono, monospace',
                                        color: 'rgb(240, 245, 255)',
                                        backgroundColor: 'rgba(22, 30, 45, 0.8)',
                                        border: isFocused
                                            ? '1px solid rgba(0, 245, 212, 0.5)'
                                            : '1px solid rgba(0, 245, 212, 0.2)',
                                        borderRadius: '12px',
                                        outline: 'none',
                                        transition: 'all 0.3s ease',
                                        boxShadow: isFocused
                                            ? '0 0 20px rgba(0, 245, 212, 0.15), inset 0 0 10px rgba(0, 245, 212, 0.05)'
                                            : 'none',
                                    }}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={!sessionId}
                                style={{
                                    width: '100%',
                                    padding: '16px 24px',
                                    fontSize: '13px',
                                    fontFamily: 'Orbitron, sans-serif',
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    textTransform: 'uppercase',
                                    color: sessionId ? 'rgb(0, 245, 212)' : 'rgb(100, 116, 139)',
                                    background: sessionId
                                        ? 'linear-gradient(135deg, rgba(0, 245, 212, 0.15), rgba(139, 92, 246, 0.15))'
                                        : 'rgba(22, 30, 45, 0.5)',
                                    border: sessionId
                                        ? '1px solid rgba(0, 245, 212, 0.4)'
                                        : '1px solid rgba(100, 116, 139, 0.2)',
                                    borderRadius: '12px',
                                    cursor: sessionId ? 'pointer' : 'not-allowed',
                                    transition: 'all 0.3s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '12px',
                                }}
                            >
                                <svg
                                    style={{ width: '18px', height: '18px', flexShrink: 0 }}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    />
                                </svg>
                                Observe Session
                            </button>
                        </form>
                    </div>

                    {/* Decorative status line */}
                    <div
                        style={{
                            marginTop: '2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '16px',
                            fontSize: '11px',
                            color: 'rgb(100, 116, 139)',
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                                style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    backgroundColor: 'rgb(34, 197, 94)',
                                    boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)',
                                }}
                            />
                            System Online
                        </span>
                        <span style={{ color: 'rgb(45, 55, 72)' }}>|</span>
                        <span>v1.0.0</span>
                        <span style={{ color: 'rgb(45, 55, 72)' }}>|</span>
                        <span style={{ letterSpacing: '0.1em' }}>READY</span>
                    </div>
                </div>
            </div>

            {/* Keyframe for spin animation */}
            <style jsx>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
