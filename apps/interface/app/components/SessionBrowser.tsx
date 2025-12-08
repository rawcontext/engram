"use client";

import { useSessionsStream } from "@app/hooks/useSessionsStream";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Session {
	id: string;
	title: string | null;
	userId: string;
	startedAt: number;
	lastEventAt: number | null;
	eventCount: number;
	preview: string | null;
	isActive: boolean;
}

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

function truncateId(id: string): string {
	if (id.length <= 8) return id;
	return `${id.slice(0, 8)}`;
}

// Generate activity bar segments based on event count
function getActivityLevel(eventCount: number): number[] {
	const maxEvents = 300;
	const normalized = Math.min(eventCount / maxEvents, 1);
	const segments = 5;
	const filled = Math.ceil(normalized * segments);
	return Array.from({ length: segments }, (_, i) => (i < filled ? 1 : 0.15));
}

// Session Card Component
function SessionCard({
	session,
	index,
	isHovered,
	onHover,
	onLeave,
	onClick,
	isLive = false,
}: {
	session: Session;
	index: number;
	isHovered: boolean;
	onHover: () => void;
	onLeave: () => void;
	onClick: () => void;
	isLive?: boolean;
}) {
	const activity = getActivityLevel(session.eventCount);

	// Colors based on live status
	const accentColor = isLive ? "rgb(34, 197, 94)" : "rgb(251, 191, 36)";
	const accentColorRgba = isLive ? "rgba(34, 197, 94," : "rgba(251, 191, 36,";

	return (
		<button
			onClick={onClick}
			onMouseEnter={onHover}
			onMouseLeave={onLeave}
			style={{
				display: "flex",
				flexDirection: "column",
				padding: "14px 16px",
				background: isHovered
					? `linear-gradient(135deg, ${accentColorRgba} 0.08) 0%, rgba(15, 20, 30, 0.8) 100%)`
					: "rgba(15, 20, 30, 0.6)",
				backdropFilter: "blur(8px)",
				border: isHovered
					? `1px solid ${accentColorRgba} 0.35)`
					: isLive
						? "1px solid rgba(34, 197, 94, 0.25)"
						: "1px solid rgba(71, 85, 105, 0.2)",
				borderRadius: "10px",
				cursor: "pointer",
				textAlign: "left",
				transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				animation: `cardReveal 0.4s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.06}s both`,
				boxShadow: isHovered
					? `0 4px 24px ${accentColorRgba} 0.12), inset 0 1px 0 ${accentColorRgba} 0.1)`
					: isLive
						? "0 2px 12px rgba(34, 197, 94, 0.1)"
						: "0 2px 8px rgba(0, 0, 0, 0.2)",
				transform: isHovered ? "translateY(-2px)" : "translateY(0)",
				position: "relative",
				overflow: "hidden",
			}}
		>
			{/* Top glow line on hover */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: "1px",
					background: isHovered
						? `linear-gradient(90deg, transparent, ${accentColorRgba} 0.5), transparent)`
						: isLive
							? "linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.3), transparent)"
							: "transparent",
					transition: "all 0.3s ease",
				}}
			/>

			{/* Row 1: Session ID + Time/Live Badge */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "10px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
					}}
				>
					<div
						style={{
							width: "4px",
							height: "4px",
							borderRadius: "50%",
							backgroundColor: isHovered || isLive ? accentColor : "rgb(100, 116, 139)",
							boxShadow: isHovered || isLive ? `0 0 8px ${accentColorRgba} 0.8)` : "none",
							transition: "all 0.2s ease",
							animation: isLive ? "livePulse 1.5s ease-in-out infinite" : "none",
						}}
					/>
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "11px",
							fontWeight: 500,
							color: isHovered ? accentColor : "rgb(203, 213, 225)",
							letterSpacing: "0.03em",
							transition: "color 0.2s ease",
						}}
					>
						{truncateId(session.id)}
					</span>
				</div>

				{isLive ? (
					<span
						style={{
							fontFamily: "Orbitron, sans-serif",
							fontSize: "8px",
							fontWeight: 700,
							letterSpacing: "0.1em",
							color: "rgb(34, 197, 94)",
							padding: "2px 6px",
							background: "rgba(34, 197, 94, 0.15)",
							border: "1px solid rgba(34, 197, 94, 0.3)",
							borderRadius: "3px",
							animation: "liveBadgePulse 2s ease-in-out infinite",
						}}
					>
						LIVE
					</span>
				) : (
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "9px",
							color: "rgb(100, 116, 139)",
							letterSpacing: "0.02em",
						}}
					>
						{formatRelativeTime(session.startedAt)}
					</span>
				)}
			</div>

			{/* Row 2: Event Count + Activity */}
			<div
				style={{
					display: "flex",
					alignItems: "flex-end",
					justifyContent: "space-between",
					gap: "12px",
				}}
			>
				{/* Event metric */}
				<div
					style={{
						display: "flex",
						alignItems: "baseline",
						gap: "4px",
					}}
				>
					<span
						style={{
							fontFamily: "Orbitron, sans-serif",
							fontSize: "20px",
							fontWeight: 700,
							color: isHovered ? accentColor : isLive ? "rgb(34, 197, 94)" : "rgb(226, 232, 240)",
							lineHeight: 1,
							transition: "color 0.2s ease",
						}}
					>
						{session.eventCount}
					</span>
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "9px",
							color: "rgb(100, 116, 139)",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
						}}
					>
						events
					</span>
				</div>

				{/* Activity bar */}
				<div
					style={{
						display: "flex",
						alignItems: "flex-end",
						gap: "2px",
						height: "16px",
					}}
				>
					{activity.map((level, i) => (
						<div
							key={i}
							style={{
								width: "4px",
								height: `${6 + i * 2}px`,
								borderRadius: "1px",
								backgroundColor:
									isHovered || isLive
										? `${accentColorRgba} ${level})`
										: `rgba(148, 163, 184, ${level * 0.7})`,
								transition: "all 0.2s ease",
								animation: isLive ? `barPulse 1s ease-in-out ${i * 0.1}s infinite` : "none",
							}}
						/>
					))}
				</div>
			</div>
		</button>
	);
}

export function SessionBrowser() {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const router = useRouter();

	// Use WebSocket streaming for real-time session updates - NO POLLING
	const {
		active: activeSessions,
		recent: recentSessions,
		isConnected,
		error,
	} = useSessionsStream();

	// Show loading state while WebSocket connects
	const loading = !isConnected && activeSessions.length === 0 && recentSessions.length === 0;

	const handleSessionClick = (sessionId: string) => {
		router.push(`/session/${sessionId}`);
	};

	if (loading) {
		return (
			<div
				style={{
					padding: "3rem 1rem",
					textAlign: "center",
				}}
			>
				<div
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: "12px",
						color: "rgb(148, 163, 184)",
						fontSize: "11px",
						letterSpacing: "0.15em",
						fontFamily: "Orbitron, sans-serif",
					}}
				>
					<div
						style={{
							width: "6px",
							height: "6px",
							borderRadius: "50%",
							backgroundColor: "rgb(251, 191, 36)",
							animation: "pulse 1s ease-in-out infinite",
							boxShadow: "0 0 12px rgba(251, 191, 36, 0.6)",
						}}
					/>
					SCANNING NEURAL PATHWAYS
				</div>
			</div>
		);
	}

	const totalSessions = activeSessions.length + recentSessions.length;

	if (error || totalSessions === 0) {
		return (
			<div
				style={{
					padding: "2rem",
					background: "rgba(15, 20, 30, 0.4)",
					borderRadius: "12px",
					border: "1px solid rgba(100, 116, 139, 0.15)",
					textAlign: "center",
				}}
			>
				<div
					style={{
						color: "rgb(100, 116, 139)",
						fontSize: "11px",
						letterSpacing: "0.1em",
						fontFamily: "JetBrains Mono, monospace",
					}}
				>
					{error || "No sessions detected"}
				</div>
			</div>
		);
	}

	return (
		<div>
			{/* LIVE SESSIONS Section */}
			{activeSessions.length > 0 && (
				<div style={{ marginBottom: "2rem" }}>
					{/* Live Section Header */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: "1rem",
							padding: "0 4px",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
							}}
						>
							<div
								style={{
									width: "8px",
									height: "8px",
									borderRadius: "50%",
									backgroundColor: "rgb(34, 197, 94)",
									boxShadow: "0 0 12px rgba(34, 197, 94, 0.8)",
									animation: "livePulse 1.5s ease-in-out infinite",
								}}
							/>
							<span
								style={{
									fontSize: "10px",
									fontFamily: "Orbitron, sans-serif",
									fontWeight: 600,
									letterSpacing: "0.2em",
									color: "rgb(34, 197, 94)",
								}}
							>
								LIVE SESSIONS
							</span>
						</div>
						<span
							style={{
								fontSize: "10px",
								fontFamily: "JetBrains Mono, monospace",
								color: "rgb(34, 197, 94)",
								padding: "3px 8px",
								background: "rgba(34, 197, 94, 0.1)",
								borderRadius: "4px",
								border: "1px solid rgba(34, 197, 94, 0.3)",
							}}
						>
							{activeSessions.length} active
						</span>
					</div>

					{/* Live Sessions Grid */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
							gap: "12px",
						}}
					>
						{activeSessions.map((session, index) => (
							<SessionCard
								key={`live-${session.id}-${index}`}
								session={session}
								index={index}
								isHovered={hoveredId === session.id}
								onHover={() => setHoveredId(session.id)}
								onLeave={() => setHoveredId(null)}
								onClick={() => handleSessionClick(session.id)}
								isLive={true}
							/>
						))}
					</div>
				</div>
			)}

			{/* RECENT SESSIONS Section */}
			{recentSessions.length > 0 && (
				<div>
					{/* Recent Section Header */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: "1rem",
							padding: "0 4px",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
							}}
						>
							<div
								style={{
									width: "6px",
									height: "6px",
									borderRadius: "50%",
									backgroundColor: "rgb(148, 163, 184)",
									boxShadow: "0 0 6px rgba(148, 163, 184, 0.4)",
								}}
							/>
							<span
								style={{
									fontSize: "10px",
									fontFamily: "Orbitron, sans-serif",
									fontWeight: 600,
									letterSpacing: "0.2em",
									color: "rgb(148, 163, 184)",
								}}
							>
								RECENT SESSIONS
							</span>
						</div>
						<span
							style={{
								fontSize: "10px",
								fontFamily: "JetBrains Mono, monospace",
								color: "rgb(71, 85, 105)",
								padding: "3px 8px",
								background: "rgba(15, 20, 30, 0.6)",
								borderRadius: "4px",
								border: "1px solid rgba(71, 85, 105, 0.3)",
							}}
						>
							{recentSessions.length} sessions
						</span>
					</div>

					{/* Recent Sessions Grid */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
							gap: "12px",
						}}
					>
						{recentSessions.map((session, index) => (
							<SessionCard
								key={`recent-${session.id}-${index}`}
								session={session}
								index={index}
								isHovered={hoveredId === session.id}
								onHover={() => setHoveredId(session.id)}
								onLeave={() => setHoveredId(null)}
								onClick={() => handleSessionClick(session.id)}
								isLive={false}
							/>
						))}
					</div>
				</div>
			)}

			{/* Keyframes */}
			<style jsx>{`
                @keyframes cardReveal {
                    from {
                        opacity: 0;
                        transform: translateY(12px) scale(0.98);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
                @keyframes livePulse {
                    0%, 100% {
                        opacity: 1;
                        transform: scale(1);
                        box-shadow: 0 0 12px rgba(34, 197, 94, 0.8);
                    }
                    50% {
                        opacity: 0.7;
                        transform: scale(1.1);
                        box-shadow: 0 0 20px rgba(34, 197, 94, 1);
                    }
                }
                @keyframes liveBadgePulse {
                    0%, 100% {
                        opacity: 1;
                        background: rgba(34, 197, 94, 0.15);
                    }
                    50% {
                        opacity: 0.8;
                        background: rgba(34, 197, 94, 0.25);
                    }
                }
                @keyframes barPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
            `}</style>
		</div>
	);
}
