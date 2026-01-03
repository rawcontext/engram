"use client";

import type { ConflictWithMemories } from "@lib/conflict-queries";
import { useCallback, useEffect, useState } from "react";
import { EngramLogo } from "../components/EngramLogo";
import { colors, fontSizes, fonts, spacing } from "../components/shared/design-tokens";
import { GlassPanel } from "../components/shared/GlassPanel";
import { LoadingState } from "../components/shared/LoadingState";
import { SystemFooter } from "../components/shared/SystemFooter";
import { UserMenu } from "../components/UserMenu";
import { ConflictCard } from "./components/ConflictCard";
import { ConflictFilters } from "./components/ConflictFilters";

interface ConflictStats {
	pending: number;
	confirmed: number;
	dismissed: number;
	autoResolved: number;
}

interface ConflictsResponse {
	success: boolean;
	data: {
		conflicts: ConflictWithMemories[];
		pagination: {
			total: number;
			limit: number;
			offset: number;
			hasMore: boolean;
		};
		stats?: ConflictStats;
	};
}

export default function ConflictsPage() {
	const [conflicts, setConflicts] = useState<ConflictWithMemories[]>([]);
	const [stats, setStats] = useState<ConflictStats | undefined>();
	const [pagination, setPagination] = useState({ total: 0, hasMore: false });
	const [isLoading, setIsLoading] = useState(true);
	const [processingId, setProcessingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Filters
	const [status, setStatus] = useState<string | null>("pending_review");
	const [project, setProject] = useState<string | null>(null);

	const fetchConflicts = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			if (status) params.set("status", status);
			if (project) params.set("project", project);
			params.set("includeStats", "true");

			const response = await fetch(`/api/conflicts?${params}`);
			const data: ConflictsResponse = await response.json();

			if (!data.success) {
				throw new Error("Failed to fetch conflicts");
			}

			setConflicts(data.data.conflicts);
			setPagination({
				total: data.data.pagination.total,
				hasMore: data.data.pagination.hasMore,
			});
			if (data.data.stats) {
				setStats(data.data.stats);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsLoading(false);
		}
	}, [status, project]);

	useEffect(() => {
		fetchConflicts();
	}, [fetchConflicts]);

	const handleResolve = async (id: string, action: string) => {
		setProcessingId(id);
		try {
			const response = await fetch(`/api/conflicts/${id}/resolve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error?.message || "Failed to resolve conflict");
			}

			// Refresh the list
			await fetchConflicts();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to resolve conflict");
		} finally {
			setProcessingId(null);
		}
	};

	const handleDismiss = async (id: string) => {
		setProcessingId(id);
		try {
			const response = await fetch(`/api/conflicts/${id}/dismiss`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error?.message || "Failed to dismiss conflict");
			}

			// Refresh the list
			await fetchConflicts();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to dismiss conflict");
		} finally {
			setProcessingId(null);
		}
	};

	const HEADER_HEIGHT = 140;
	const FOOTER_HEIGHT = 48;

	return (
		<div
			style={{
				position: "relative",
				minHeight: "100vh",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				paddingTop: `${HEADER_HEIGHT + 24}px`,
				paddingBottom: `${FOOTER_HEIGHT + 24}px`,
			}}
		>
			{/* Fixed Header */}
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
					{/* Left side: Logo and branding */}
					<div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
						<a href="/" style={{ display: "flex", alignItems: "center" }}>
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
								CONFLICTS
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
								Memory Review Dashboard
							</p>
						</div>
					</div>

					<UserMenu />
				</div>
			</header>

			{/* Main Content */}
			<div
				style={{
					position: "relative",
					zIndex: 10,
					width: "100%",
					maxWidth: "1200px",
					padding: "0 2rem",
				}}
			>
				{/* Filters */}
				<ConflictFilters
					status={status}
					project={project}
					onStatusChange={setStatus}
					onProjectChange={setProject}
					stats={stats}
				/>

				{/* Error Message */}
				{error && (
					<GlassPanel
						variant="dark"
						accentColor="none"
						style={{ marginBottom: spacing[4], padding: spacing[4] }}
					>
						<div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
							<span
								style={{
									fontFamily: fonts.mono,
									fontSize: fontSizes.sm,
									color: colors.red.DEFAULT,
								}}
							>
								Error: {error}
							</span>
							<button
								type="button"
								onClick={() => setError(null)}
								style={{
									fontFamily: fonts.mono,
									fontSize: fontSizes.xs,
									color: colors.slate[400],
									background: "transparent",
									border: "none",
									cursor: "pointer",
								}}
							>
								Dismiss
							</button>
						</div>
					</GlassPanel>
				)}

				{/* Loading State */}
				{isLoading && (
					<div style={{ display: "flex", justifyContent: "center", padding: spacing[8] }}>
						<LoadingState message="Loading conflicts..." />
					</div>
				)}

				{/* Conflict List */}
				{!isLoading && conflicts.length === 0 && (
					<GlassPanel
						variant="dark"
						style={{
							padding: spacing[8],
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontFamily: fonts.display,
								fontSize: fontSizes.xl,
								color: colors.cyan.DEFAULT,
								marginBottom: spacing[3],
								letterSpacing: "0.1em",
							}}
						>
							NO CONFLICTS FOUND
						</div>
						<p
							style={{
								fontFamily: fonts.mono,
								fontSize: fontSizes.sm,
								color: colors.slate[400],
								margin: 0,
							}}
						>
							{status === "pending_review"
								? "All memory conflicts have been reviewed."
								: "No conflicts match the current filters."}
						</p>
					</GlassPanel>
				)}

				{!isLoading && conflicts.length > 0 && (
					<div>
						{/* Results Header */}
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: spacing[4],
							}}
						>
							<span
								style={{
									fontFamily: fonts.mono,
									fontSize: fontSizes.sm,
									color: colors.slate[400],
								}}
							>
								Showing {conflicts.length} of {pagination.total} conflicts
							</span>
						</div>

						{/* Conflict Cards */}
						{conflicts.map((conflict) => (
							<ConflictCard
								key={conflict.id}
								conflict={conflict}
								onResolve={handleResolve}
								onDismiss={handleDismiss}
								isLoading={processingId === conflict.id}
							/>
						))}

						{/* Load More */}
						{pagination.hasMore && (
							<div style={{ display: "flex", justifyContent: "center", marginTop: spacing[6] }}>
								<button
									type="button"
									onClick={() => {
										// TODO: Implement pagination
									}}
									style={{
										padding: `${spacing[3]} ${spacing[6]}`,
										fontFamily: fonts.display,
										fontSize: fontSizes.sm,
										letterSpacing: "0.05em",
										color: colors.cyan.DEFAULT,
										background: colors.cyan.subtle,
										border: `1px solid ${colors.cyan.border}`,
										borderRadius: "8px",
										cursor: "pointer",
									}}
								>
									LOAD MORE
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Fixed Footer */}
			<SystemFooter />
		</div>
	);
}
