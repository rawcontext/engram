"use client";

import { useSession } from "@lib/auth-client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EngramLogo } from "../components/EngramLogo";
import { GlassPanel } from "../components/shared/GlassPanel";
import { SystemFooter } from "../components/shared/SystemFooter";
import { UserMenu } from "../components/UserMenu";

interface OAuthToken {
	id: string;
	accessTokenPrefix: string;
	clientId: string;
	scopes: string[];
	accessTokenExpiresAt: string;
	refreshTokenExpiresAt: string;
	createdAt: string;
	lastUsedAt: string | null;
	userAgent: string | null;
	ipAddress: string | null;
}

export default function TokensPage() {
	const { data: session, isPending } = useSession();
	const router = useRouter();
	const [tokens, setTokens] = useState<OAuthToken[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Redirect if not authenticated
	useEffect(() => {
		if (!isPending && !session) {
			router.push("/sign-in");
		}
	}, [session, isPending, router]);

	// Fetch tokens
	const fetchTokens = useCallback(async () => {
		try {
			setIsLoading(true);
			const res = await fetch("/api/tokens");
			const data = await res.json();
			if (data.success) {
				setTokens(data.data.tokens);
			} else {
				setError(data.error?.message || "Failed to load tokens");
			}
		} catch {
			setError("Failed to load tokens");
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (session) {
			fetchTokens();
		}
	}, [session, fetchTokens]);

	const handleRevokeToken = async (tokenId: string) => {
		if (
			!confirm(
				"Are you sure you want to revoke this token? The device will need to re-authenticate.",
			)
		) {
			return;
		}

		try {
			const res = await fetch(`/api/tokens?id=${tokenId}`, { method: "DELETE" });
			const data = await res.json();
			if (data.success) {
				fetchTokens();
			} else {
				setError(data.error?.message || "Failed to revoke token");
			}
		} catch {
			setError("Failed to revoke token");
		}
	};

	const formatRelativeTime = (dateStr: string | null) => {
		if (!dateStr) return "Never";
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return "Just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	};

	const parseUserAgent = (ua: string | null) => {
		if (!ua) return { device: "Unknown", platform: "Unknown" };

		const device =
			ua.includes("Claude") || ua.includes("claude")
				? "Claude Code"
				: ua.includes("node") || ua.includes("Node")
					? "Node.js"
					: ua.includes("Python")
						? "Python"
						: "Unknown Client";

		const platform =
			ua.includes("Darwin") || ua.includes("Mac")
				? "macOS"
				: ua.includes("Linux")
					? "Linux"
					: ua.includes("Windows")
						? "Windows"
						: "Unknown";

		return { device, platform };
	};

	const isExpiringSoon = (dateStr: string) => {
		const date = new Date(dateStr);
		const now = new Date();
		const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
		return diffDays < 2;
	};

	if (isPending || !session) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="animate-pulse text-cyan-400">Loading...</div>
			</div>
		);
	}

	const HEADER_HEIGHT = 140;
	const FOOTER_HEIGHT = 48;

	return (
		<div
			style={{
				position: "relative",
				minHeight: "100vh",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				paddingTop: `${HEADER_HEIGHT + 24}px`,
				paddingBottom: `${FOOTER_HEIGHT + 24}px`,
			}}
		>
			{/* Header */}
			<header
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					height: `${HEADER_HEIGHT}px`,
					zIndex: 50,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
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
						width: "100%",
						maxWidth: "1600px",
						padding: "0 2rem",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<div
						style={{
							position: "absolute",
							bottom: 0,
							left: "50%",
							transform: "translateX(-50%)",
							width: "100%",
							maxWidth: "1600px",
							padding: "0 2rem",
							pointerEvents: "none",
						}}
					>
						<div
							style={{
								width: "300px",
								height: "1px",
								background: "linear-gradient(90deg, rgba(139,92,246,0.4), transparent)",
							}}
						/>
					</div>

					<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
						<a href="/" style={{ display: "block", flexShrink: 0 }}>
							<EngramLogo />
						</a>
						<div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
							<h1
								className="font-display text-glow"
								style={{
									fontSize: "2rem",
									fontWeight: 700,
									letterSpacing: "0.1em",
									marginBottom: "0.25rem",
									lineHeight: 1,
								}}
							>
								ENGRAM
							</h1>
							<p
								style={{
									color: "rgb(148,163,184)",
									fontSize: "0.65rem",
									letterSpacing: "0.3em",
									textTransform: "uppercase",
									lineHeight: 1,
								}}
							>
								OAuth Sessions
							</p>
						</div>
					</div>

					<UserMenu />
				</div>
			</header>

			{/* Main Content */}
			<div style={{ width: "100%", maxWidth: "900px", padding: "0 2rem" }}>
				{/* Title & Description */}
				<div style={{ marginBottom: "2rem" }}>
					<h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#f1f5f9" }}>Active Sessions</h2>
					<p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.25rem" }}>
						Devices authenticated via OAuth device flow. Revoke to require re-authentication.
					</p>
				</div>

				{/* Error Message */}
				{error && (
					<div
						style={{
							padding: "1rem",
							background: "rgba(239, 68, 68, 0.1)",
							border: "1px solid rgba(239, 68, 68, 0.3)",
							borderRadius: "8px",
							color: "#f87171",
							marginBottom: "1rem",
						}}
					>
						{error}
						<button
							type="button"
							onClick={() => setError(null)}
							style={{ marginLeft: "1rem", textDecoration: "underline" }}
						>
							Dismiss
						</button>
					</div>
				)}

				{/* Tokens List */}
				{isLoading ? (
					<div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
						Loading sessions...
					</div>
				) : tokens.length === 0 ? (
					<GlassPanel style={{ padding: "3rem", textAlign: "center" }}>
						<div style={{ color: "#64748b", marginBottom: "1rem" }}>No active sessions</div>
						<p style={{ color: "#475569", fontSize: "0.875rem" }}>
							Connect a device using the MCP server to see it here
						</p>
					</GlassPanel>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
						{tokens.map((token) => {
							const { device, platform } = parseUserAgent(token.userAgent);
							const expiringSoon = isExpiringSoon(token.accessTokenExpiresAt);

							return (
								<GlassPanel key={token.id} style={{ padding: "1.25rem" }}>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "start",
										}}
									>
										<div style={{ flex: 1 }}>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "0.75rem",
												}}
											>
												<span style={{ color: "#f1f5f9", fontWeight: 500 }}>{device}</span>
												<span
													style={{
														padding: "0.125rem 0.5rem",
														background: "rgba(139, 92, 246, 0.15)",
														border: "1px solid rgba(139, 92, 246, 0.3)",
														borderRadius: "4px",
														color: "#a78bfa",
														fontSize: "0.7rem",
													}}
												>
													{platform}
												</span>
												{expiringSoon && (
													<span
														style={{
															padding: "0.125rem 0.5rem",
															background: "rgba(251, 191, 36, 0.15)",
															border: "1px solid rgba(251, 191, 36, 0.3)",
															borderRadius: "4px",
															color: "#fbbf24",
															fontSize: "0.7rem",
														}}
													>
														Expires soon
													</span>
												)}
											</div>
											<div
												style={{
													display: "flex",
													gap: "1.5rem",
													marginTop: "0.75rem",
													fontSize: "0.75rem",
													color: "#475569",
												}}
											>
												<span>
													<span style={{ color: "#64748b" }}>Token:</span>{" "}
													<code style={{ color: "#94a3b8" }}>{token.accessTokenPrefix}</code>
												</span>
												<span>
													<span style={{ color: "#64748b" }}>Created:</span>{" "}
													{new Date(token.createdAt).toLocaleDateString()}
												</span>
												<span>
													<span style={{ color: "#64748b" }}>Last used:</span>{" "}
													{formatRelativeTime(token.lastUsedAt)}
												</span>
											</div>
											<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
												{token.scopes.map((scope) => (
													<span
														key={scope}
														style={{
															padding: "0.125rem 0.375rem",
															background: "rgba(56, 189, 248, 0.1)",
															border: "1px solid rgba(56, 189, 248, 0.2)",
															borderRadius: "3px",
															color: "#38bdf8",
															fontSize: "0.65rem",
														}}
													>
														{scope}
													</span>
												))}
											</div>
										</div>
										<button
											type="button"
											onClick={() => handleRevokeToken(token.id)}
											style={{
												padding: "0.375rem 0.75rem",
												background: "transparent",
												border: "1px solid rgba(239, 68, 68, 0.3)",
												borderRadius: "4px",
												color: "#f87171",
												fontSize: "0.75rem",
												cursor: "pointer",
												transition: "all 0.15s ease",
											}}
											onMouseOver={(e) => {
												e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
											}}
											onFocus={(e) => {
												e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
											}}
											onMouseOut={(e) => {
												e.currentTarget.style.background = "transparent";
											}}
											onBlur={(e) => {
												e.currentTarget.style.background = "transparent";
											}}
										>
											Revoke
										</button>
									</div>
								</GlassPanel>
							);
						})}
					</div>
				)}

				{/* Info Box */}
				<GlassPanel style={{ marginTop: "2rem", padding: "1rem" }}>
					<div style={{ display: "flex", gap: "0.75rem", alignItems: "start" }}>
						<span style={{ color: "#64748b", fontSize: "1rem" }}>i</span>
						<div style={{ fontSize: "0.8125rem", color: "#64748b" }}>
							<p style={{ marginBottom: "0.5rem" }}>
								OAuth sessions are created when you authenticate a device (like Claude Code) via the
								device flow.
							</p>
							<p>
								Revoking a session will require the device to re-authenticate. Tokens expire
								automatically after 7 days.
							</p>
						</div>
					</div>
				</GlassPanel>
			</div>

			<SystemFooter />
		</div>
	);
}
