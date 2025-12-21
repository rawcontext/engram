"use client";

import type { GraphNode } from "@lib/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { EngramLogo } from "../../components/EngramLogo";
import { LineageGraph } from "../../components/LineageGraph";
import { SessionReplay } from "../../components/SessionReplay";
import { Particles } from "../../components/shared";
import { useSessionStream } from "../../hooks/useSessionStream";

// Dynamically import Three.js background to avoid SSR issues
const NeuralBackground = dynamic(
	() => import("../../components/NeuralBackground").then((mod) => mod.NeuralBackground),
	{ ssr: false },
);

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
		<div style={{ minHeight: "100vh", position: "relative" }}>
			{/* Three.js Neural Background - fixed for glassmorphism */}
			<div style={{ position: "fixed", inset: 0, pointerEvents: "none", opacity: 0.4, zIndex: 1 }}>
				<Suspense fallback={null}>
					<NeuralBackground />
				</Suspense>
				<Particles count={15} precomputed />
			</div>

			{/* Header - Glassmorphism with EngramLogo */}
			<header
				style={{
					position: "sticky",
					top: 0,
					zIndex: 50,
					// Glassmorphism - balanced translucency
					background: `linear-gradient(
						180deg,
						rgba(8, 10, 15, 0.35) 0%,
						rgba(15, 20, 30, 0.3) 100%
					)`,
					backdropFilter: "blur(8px) saturate(150%)",
					WebkitBackdropFilter: "blur(8px) saturate(150%)",
					borderBottom: "1px solid rgba(0, 245, 212, 0.15)",
					boxShadow:
						"inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.1), 0 4px 30px rgba(0,0,0,0.3)",
				}}
			>
				<div
					style={{
						padding: "8px 16px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					{/* Logo and nav */}
					<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
						<Link
							href="/"
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
								textDecoration: "none",
							}}
						>
							<EngramLogo size={40} />
							<span
								style={{
									fontFamily: "Orbitron, sans-serif",
									fontSize: "16px",
									fontWeight: 600,
									letterSpacing: "0.1em",
									color: "rgb(251, 191, 36)",
								}}
							>
								ENGRAM
							</span>
						</Link>

						<div
							style={{ height: "24px", width: "1px", background: "rgba(148, 163, 184, 0.15)" }}
						/>

						<nav
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								fontSize: "12px",
								color: "rgb(100, 116, 139)",
							}}
						>
							<span>Sessions</span>
							<svg
								style={{ width: "14px", height: "14px", flexShrink: 0 }}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
							<span
								style={{
									color: "rgb(226, 232, 240)",
									fontWeight: 500,
									fontFamily: "JetBrains Mono, monospace",
									fontSize: "11px",
									maxWidth: "180px",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{sessionId}
							</span>
						</nav>
					</div>

					{/* Status indicators */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "16px",
							fontSize: "12px",
							color: "rgb(100, 116, 139)",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
							<span
								style={{
									width: "6px",
									height: "6px",
									borderRadius: "50%",
									backgroundColor: isConnected ? "rgb(34, 197, 94)" : "rgb(250, 204, 21)",
									boxShadow: isConnected
										? "0 0 8px rgba(34, 197, 94, 0.6)"
										: "0 0 8px rgba(250, 204, 21, 0.6)",
								}}
							/>
							<span>{isConnected ? "Live" : "Polling"}</span>
						</div>
						<span style={{ color: "rgb(45, 55, 72)" }}>|</span>
						<span>{lineageData?.nodes?.length || 0} nodes</span>
						<span style={{ color: "rgb(45, 55, 72)" }}>|</span>
						<span>{replayData?.timeline?.length || 0} events</span>
					</div>
				</div>
			</header>

			{/* Main content - Two column layout, full width */}
			<main
				style={{
					height: "calc(100vh - 65px)",
					padding: "16px",
					position: "relative",
					zIndex: 10,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "16px",
						height: "100%",
					}}
				>
					{/* Left Column - Lineage Graph */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "12px",
							height: "100%",
							minHeight: 0,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								flexShrink: 0,
							}}
						>
							<h2
								style={{
									fontFamily: "Orbitron, sans-serif",
									fontSize: "14px",
									fontWeight: 600,
									letterSpacing: "0.1em",
									display: "flex",
									alignItems: "center",
									gap: "10px",
									margin: 0,
								}}
							>
								<span
									style={{
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										backgroundColor: "rgb(251, 191, 36)",
										boxShadow: "0 0 10px rgba(251, 191, 36, 0.5)",
									}}
								/>
								<span style={{ color: "rgb(226, 232, 240)" }}>LINEAGE GRAPH</span>
							</h2>
							{lineageLoading && (
								<span style={{ fontSize: "11px", color: "rgb(100, 116, 139)" }}>Syncing...</span>
							)}
						</div>

						<div
							style={{
								position: "relative",
								background: "rgba(12, 14, 20, 0.7)",
								backdropFilter: "blur(20px)",
								border: "1px solid rgba(148, 163, 184, 0.1)",
								borderRadius: "12px",
								overflow: "hidden",
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
										position: "absolute",
										bottom: "16px",
										left: "16px",
										right: "16px",
										maxWidth: "400px",
										background: "rgba(12, 14, 20, 0.95)",
										backdropFilter: "blur(20px)",
										border: "1px solid rgba(251, 191, 36, 0.25)",
										borderRadius: "12px",
										padding: "16px",
										boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(251, 191, 36, 0.08)",
										zIndex: 20,
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "flex-start",
											marginBottom: "12px",
										}}
									>
										<div>
											<div
												style={{
													fontSize: "10px",
													color: "rgb(100, 116, 139)",
													marginBottom: "4px",
													letterSpacing: "0.1em",
													textTransform: "uppercase",
												}}
											>
												Selected Node
											</div>
											<h3
												style={{
													fontFamily: "Orbitron, sans-serif",
													fontSize: "14px",
													color: "rgb(251, 191, 36)",
													margin: 0,
													letterSpacing: "0.05em",
												}}
											>
												{selectedNode.label}
											</h3>
										</div>
										<button
											type="button"
											onClick={() => setSelectedNode(null)}
											style={{
												padding: "6px",
												borderRadius: "6px",
												background: "rgba(148, 163, 184, 0.1)",
												border: "none",
												color: "rgb(148, 163, 184)",
												cursor: "pointer",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											<svg
												style={{ width: "14px", height: "14px" }}
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</div>
									<pre
										style={{
											fontSize: "10px",
											overflow: "auto",
											maxHeight: "120px",
											padding: "12px",
											borderRadius: "8px",
											background: "rgba(8, 10, 15, 0.8)",
											border: "1px solid rgba(148, 163, 184, 0.1)",
											color: "rgb(148, 163, 184)",
											margin: 0,
											fontFamily: "JetBrains Mono, monospace",
										}}
									>
										{JSON.stringify(selectedNode, null, 2)}
									</pre>
								</div>
							)}
						</div>
					</div>

					{/* Right Column - Thought Stream */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "12px",
							height: "100%",
							minHeight: 0,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								flexShrink: 0,
							}}
						>
							<h2
								style={{
									fontFamily: "Orbitron, sans-serif",
									fontSize: "14px",
									fontWeight: 600,
									letterSpacing: "0.1em",
									display: "flex",
									alignItems: "center",
									gap: "10px",
									margin: 0,
								}}
							>
								<span
									style={{
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										backgroundColor: "rgb(251, 191, 36)",
										boxShadow: "0 0 10px rgba(251, 191, 36, 0.5)",
									}}
								/>
								<span style={{ color: "rgb(226, 232, 240)" }}>THOUGHT STREAM</span>
							</h2>
							{replayLoading && (
								<span style={{ fontSize: "11px", color: "rgb(100, 116, 139)" }}>Syncing...</span>
							)}
						</div>

						<div
							style={{
								background: "rgba(12, 14, 20, 0.7)",
								backdropFilter: "blur(20px)",
								border: "1px solid rgba(148, 163, 184, 0.1)",
								borderRadius: "12px",
								overflow: "hidden",
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
