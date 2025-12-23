"use client";

import { useSession } from "@lib/auth-client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EngramLogo } from "../components/EngramLogo";
import { GlassPanel } from "../components/shared/GlassPanel";
import { SystemFooter } from "../components/shared/SystemFooter";
import { UserMenu } from "../components/UserMenu";

interface ApiKey {
	id: string;
	keyPrefix: string;
	keyType: string;
	name: string;
	description?: string;
	scopes: string[];
	rateLimitRpm: number;
	isActive: boolean;
	expiresAt?: string;
	createdAt: string;
	lastUsedAt?: string;
}

interface NewKeyResponse {
	id: string;
	key: string;
	keyPrefix: string;
	name: string;
	scopes: string[];
}

export default function KeysPage() {
	const { data: session, isPending } = useSession();
	const router = useRouter();
	const [keys, setKeys] = useState<ApiKey[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Create key modal state
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [newKeyDescription, setNewKeyDescription] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	// Newly created key (shown once)
	const [createdKey, setCreatedKey] = useState<NewKeyResponse | null>(null);
	const [copied, setCopied] = useState(false);

	// Redirect if not authenticated
	useEffect(() => {
		if (!isPending && !session) {
			router.push("/sign-in");
		}
	}, [session, isPending, router]);

	// Fetch keys
	const fetchKeys = useCallback(async () => {
		try {
			setIsLoading(true);
			const res = await fetch("/api/keys");
			const data = await res.json();
			if (data.success) {
				setKeys(data.data.keys);
			} else {
				setError(data.error?.message || "Failed to load keys");
			}
		} catch {
			setError("Failed to load keys");
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (session) {
			fetchKeys();
		}
	}, [session, fetchKeys]);

	const handleCreateKey = async () => {
		if (!newKeyName.trim()) return;

		setIsCreating(true);
		try {
			const res = await fetch("/api/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: newKeyName.trim(),
					description: newKeyDescription.trim() || undefined,
				}),
			});
			const data = await res.json();
			if (data.success) {
				setCreatedKey(data.data);
				setShowCreateModal(false);
				setNewKeyName("");
				setNewKeyDescription("");
				fetchKeys();
			} else {
				setError(data.error?.message || "Failed to create key");
			}
		} catch {
			setError("Failed to create key");
		} finally {
			setIsCreating(false);
		}
	};

	const handleRevokeKey = async (keyId: string) => {
		if (!confirm("Are you sure you want to revoke this key? This cannot be undone.")) {
			return;
		}

		try {
			const res = await fetch(`/api/keys?id=${keyId}`, { method: "DELETE" });
			const data = await res.json();
			if (data.success) {
				fetchKeys();
			} else {
				setError(data.error?.message || "Failed to revoke key");
			}
		} catch {
			setError("Failed to revoke key");
		}
	};

	const copyToClipboard = async (text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
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
				{/* Inner container matching body width */}
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
					{/* Gradient accent line at bottom */}
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
								background: "linear-gradient(90deg, rgba(251,191,36,0.4), transparent)",
							}}
						/>
					</div>

					{/* Left side: Logo and branding */}
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
								API Keys
							</p>
						</div>
					</div>

					{/* Right side: User Menu */}
					<UserMenu />
				</div>
			</header>

			{/* Main Content */}
			<div style={{ width: "100%", maxWidth: "900px", padding: "0 2rem" }}>
				{/* Title & Create Button */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "2rem",
					}}
				>
					<div>
						<h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "#f1f5f9" }}>API Keys</h2>
						<p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.25rem" }}>
							Manage your API keys for accessing Engram services
						</p>
					</div>
					<button
						type="button"
						onClick={() => setShowCreateModal(true)}
						style={{
							padding: "0.625rem 1.25rem",
							background:
								"linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(56, 189, 248, 0.2))",
							border: "1px solid rgba(0, 245, 212, 0.3)",
							borderRadius: "8px",
							color: "#00f5d4",
							fontSize: "0.875rem",
							fontWeight: 500,
							cursor: "pointer",
							transition: "all 0.15s ease",
						}}
						onMouseOver={(e) => {
							e.currentTarget.style.background =
								"linear-gradient(135deg, rgba(0, 245, 212, 0.3), rgba(56, 189, 248, 0.3))";
						}}
						onFocus={(e) => {
							e.currentTarget.style.background =
								"linear-gradient(135deg, rgba(0, 245, 212, 0.3), rgba(56, 189, 248, 0.3))";
						}}
						onMouseOut={(e) => {
							e.currentTarget.style.background =
								"linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(56, 189, 248, 0.2))";
						}}
						onBlur={(e) => {
							e.currentTarget.style.background =
								"linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(56, 189, 248, 0.2))";
						}}
					>
						+ Create Key
					</button>
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

				{/* Newly Created Key Banner */}
				{createdKey && (
					<GlassPanel style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
							<div>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.5rem",
										marginBottom: "0.5rem",
									}}
								>
									<span style={{ color: "#22c55e", fontSize: "1.25rem" }}>✓</span>
									<span style={{ color: "#22c55e", fontWeight: 600 }}>
										Key Created Successfully
									</span>
								</div>
								<p style={{ color: "#fbbf24", fontSize: "0.875rem", marginBottom: "1rem" }}>
									Copy this key now — you won't be able to see it again!
								</p>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.75rem",
										background: "rgba(0, 0, 0, 0.3)",
										padding: "0.75rem 1rem",
										borderRadius: "6px",
										fontFamily: "monospace",
									}}
								>
									<code style={{ color: "#00f5d4", fontSize: "0.875rem", wordBreak: "break-all" }}>
										{createdKey.key}
									</code>
									<button
										type="button"
										onClick={() => copyToClipboard(createdKey.key)}
										style={{
											padding: "0.375rem 0.75rem",
											background: copied ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.1)",
											border: "1px solid rgba(255, 255, 255, 0.2)",
											borderRadius: "4px",
											color: copied ? "#22c55e" : "#f1f5f9",
											fontSize: "0.75rem",
											cursor: "pointer",
											whiteSpace: "nowrap",
										}}
									>
										{copied ? "Copied!" : "Copy"}
									</button>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setCreatedKey(null)}
								style={{
									background: "transparent",
									border: "none",
									color: "#64748b",
									cursor: "pointer",
									fontSize: "1.25rem",
								}}
							>
								×
							</button>
						</div>
					</GlassPanel>
				)}

				{/* Keys List */}
				{isLoading ? (
					<div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
						Loading keys...
					</div>
				) : keys.length === 0 ? (
					<GlassPanel style={{ padding: "3rem", textAlign: "center" }}>
						<div style={{ color: "#64748b", marginBottom: "1rem" }}>No API keys yet</div>
						<p style={{ color: "#475569", fontSize: "0.875rem" }}>
							Create your first API key to start using Engram services
						</p>
					</GlassPanel>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
						{keys.map((key) => (
							<GlassPanel key={key.id} style={{ padding: "1.25rem" }}>
								<div
									style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}
								>
									<div style={{ flex: 1 }}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
											<span style={{ color: "#f1f5f9", fontWeight: 500 }}>{key.name}</span>
											{!key.isActive && (
												<span
													style={{
														padding: "0.125rem 0.5rem",
														background: "rgba(239, 68, 68, 0.2)",
														border: "1px solid rgba(239, 68, 68, 0.3)",
														borderRadius: "4px",
														color: "#f87171",
														fontSize: "0.7rem",
													}}
												>
													Revoked
												</span>
											)}
										</div>
										{key.description && (
											<p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.25rem" }}>
												{key.description}
											</p>
										)}
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
												<span style={{ color: "#64748b" }}>Prefix:</span>{" "}
												<code style={{ color: "#94a3b8" }}>{key.keyPrefix}</code>
											</span>
											<span>
												<span style={{ color: "#64748b" }}>Created:</span>{" "}
												{new Date(key.createdAt).toLocaleDateString()}
											</span>
											{key.lastUsedAt && (
												<span>
													<span style={{ color: "#64748b" }}>Last used:</span>{" "}
													{new Date(key.lastUsedAt).toLocaleDateString()}
												</span>
											)}
										</div>
										<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
											{key.scopes.map((scope) => (
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
									{key.isActive && (
										<button
											type="button"
											onClick={() => handleRevokeKey(key.id)}
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
									)}
								</div>
							</GlassPanel>
						))}
					</div>
				)}
			</div>

			{/* Create Key Modal */}
			{showCreateModal && (
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="create-key-title"
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0, 0, 0, 0.7)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 100,
					}}
					onClick={() => setShowCreateModal(false)}
					onKeyDown={(e) => e.key === "Escape" && setShowCreateModal(false)}
				>
					<div
						role="document"
						style={{
							background: "#0f1319",
							border: "1px solid rgba(255, 255, 255, 0.1)",
							borderRadius: "12px",
							padding: "1.5rem",
							width: "100%",
							maxWidth: "400px",
							boxShadow: "0 25px 50px rgba(0, 0, 0, 0.5)",
						}}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<h3
							id="create-key-title"
							style={{
								color: "#f1f5f9",
								fontSize: "1.25rem",
								fontWeight: 600,
								marginBottom: "1rem",
							}}
						>
							Create API Key
						</h3>

						<div style={{ marginBottom: "1rem" }}>
							<label
								htmlFor="key-name"
								style={{
									display: "block",
									color: "#94a3b8",
									fontSize: "0.875rem",
									marginBottom: "0.5rem",
								}}
							>
								Name *
							</label>
							<input
								id="key-name"
								type="text"
								value={newKeyName}
								onChange={(e) => setNewKeyName(e.target.value)}
								placeholder="My API Key"
								style={{
									width: "100%",
									padding: "0.625rem 0.875rem",
									background: "rgba(0, 0, 0, 0.3)",
									border: "1px solid rgba(255, 255, 255, 0.1)",
									borderRadius: "6px",
									color: "#f1f5f9",
									fontSize: "0.875rem",
									outline: "none",
								}}
							/>
						</div>

						<div style={{ marginBottom: "1.5rem" }}>
							<label
								htmlFor="key-description"
								style={{
									display: "block",
									color: "#94a3b8",
									fontSize: "0.875rem",
									marginBottom: "0.5rem",
								}}
							>
								Description (optional)
							</label>
							<input
								id="key-description"
								type="text"
								value={newKeyDescription}
								onChange={(e) => setNewKeyDescription(e.target.value)}
								placeholder="Used for..."
								style={{
									width: "100%",
									padding: "0.625rem 0.875rem",
									background: "rgba(0, 0, 0, 0.3)",
									border: "1px solid rgba(255, 255, 255, 0.1)",
									borderRadius: "6px",
									color: "#f1f5f9",
									fontSize: "0.875rem",
									outline: "none",
								}}
							/>
						</div>

						<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
							<button
								type="button"
								onClick={() => setShowCreateModal(false)}
								style={{
									padding: "0.5rem 1rem",
									background: "transparent",
									border: "1px solid rgba(255, 255, 255, 0.2)",
									borderRadius: "6px",
									color: "#94a3b8",
									fontSize: "0.875rem",
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleCreateKey}
								disabled={!newKeyName.trim() || isCreating}
								style={{
									padding: "0.5rem 1rem",
									background:
										newKeyName.trim() && !isCreating
											? "linear-gradient(135deg, rgba(0, 245, 212, 0.3), rgba(56, 189, 248, 0.3))"
											: "rgba(255, 255, 255, 0.05)",
									border: "1px solid rgba(0, 245, 212, 0.3)",
									borderRadius: "6px",
									color: newKeyName.trim() && !isCreating ? "#00f5d4" : "#475569",
									fontSize: "0.875rem",
									cursor: newKeyName.trim() && !isCreating ? "pointer" : "not-allowed",
								}}
							>
								{isCreating ? "Creating..." : "Create Key"}
							</button>
						</div>
					</div>
				</div>
			)}

			<SystemFooter />
		</div>
	);
}
