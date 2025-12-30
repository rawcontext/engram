"use client";

import {
	AlertCircle,
	ArrowUpRight,
	CheckCircle2,
	ChevronRight,
	Clock,
	GitBranch,
	GitCommit,
	Loader2,
	MoreVertical,
	Rocket,
	RotateCcw,
	Timer,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

type DeploymentStatus = "success" | "failed" | "in_progress" | "pending" | "cancelled";
type Environment = "production" | "staging" | "development";

interface Deployment {
	id: string;
	status: DeploymentStatus;
	commitHash: string;
	commitMessage: string;
	branch: string;
	environment: Environment;
	duration?: number;
	deployedAt: number;
	deployedBy: string;
	version?: string;
}

// ============================================
// Constants
// ============================================

const ENVIRONMENTS: Environment[] = ["production", "staging", "development"];

const STATUS_CONFIG: Record<
	DeploymentStatus,
	{ color: string; icon: typeof CheckCircle2; label: string; animate?: boolean }
> = {
	success: { color: "--success", icon: CheckCircle2, label: "Success" },
	failed: { color: "--destructive", icon: XCircle, label: "Failed" },
	in_progress: { color: "--primary", icon: Loader2, label: "Deploying", animate: true },
	pending: { color: "--warning", icon: Clock, label: "Pending" },
	cancelled: { color: "--muted-foreground", icon: AlertCircle, label: "Cancelled" },
};

const ENV_CONFIG: Record<Environment, { color: string; label: string }> = {
	production: { color: "--destructive", label: "PROD" },
	staging: { color: "--warning", label: "STG" },
	development: { color: "--primary", label: "DEV" },
};

// ============================================
// Helper Functions
// ============================================

function formatDuration(ms?: number): string {
	if (!ms) return "-";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	if (diff < 60000) return "Just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

// ============================================
// Status Badge Component
// ============================================

function StatusBadge({ status }: { status: DeploymentStatus }) {
	const config = STATUS_CONFIG[status];
	const Icon = config.icon;

	return (
		<span
			className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium"
			style={{
				background: `color-mix(in oklch, var(${config.color}) 15%, transparent)`,
				color: `hsl(var(${config.color}))`,
			}}
		>
			<Icon className={`w-3.5 h-3.5 ${config.animate ? "animate-spin" : ""}`} />
			{config.label}
		</span>
	);
}

// ============================================
// Environment Badge Component
// ============================================

function EnvBadge({ env }: { env: Environment }) {
	const config = ENV_CONFIG[env];

	return (
		<span
			className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border"
			style={{
				borderColor: `color-mix(in oklch, var(${config.color}) 30%, transparent)`,
				color: `hsl(var(${config.color}))`,
			}}
		>
			{config.label}
		</span>
	);
}

// ============================================
// Active Deployment Card
// ============================================

function ActiveDeploymentCard({ deployment }: { deployment: Deployment }) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setElapsed(Date.now() - deployment.deployedAt);
		}, 1000);
		return () => clearInterval(interval);
	}, [deployment.deployedAt]);

	return (
		<div className="bg-card border border-border rounded-lg p-4 mb-6 relative overflow-hidden">
			{/* Animated border */}
			<div className="absolute inset-0 rounded-lg">
				<div
					className="absolute inset-0 rounded-lg animate-pulse"
					style={{
						background: `linear-gradient(90deg, transparent, color-mix(in oklch, var(--primary) 10%, transparent), transparent)`,
						animation: "shimmer 2s linear infinite",
					}}
				/>
			</div>

			<div className="relative flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div className="w-12 h-12 rounded-lg bg-primary/15 flex items-center justify-center">
						<Loader2 className="w-6 h-6 text-primary animate-spin" />
					</div>
					<div>
						<div className="flex items-center gap-2 mb-1">
							<span className="font-display text-lg text-foreground">Deployment in Progress</span>
							<EnvBadge env={deployment.environment} />
						</div>
						<div className="flex items-center gap-3 text-sm text-muted-foreground">
							<span className="font-mono">{deployment.commitHash.slice(0, 7)}</span>
							<span>•</span>
							<span>{deployment.commitMessage.slice(0, 50)}...</span>
						</div>
					</div>
				</div>

				<div className="flex items-center gap-6">
					<div className="text-right">
						<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
							Elapsed
						</div>
						<div className="font-mono text-lg text-primary">{formatDuration(elapsed)}</div>
					</div>
					<button
						type="button"
						className="px-4 py-2 rounded-lg bg-destructive/15 text-destructive text-sm font-medium hover:bg-destructive/25 transition-colors"
					>
						Cancel
					</button>
				</div>
			</div>

			{/* Progress bar */}
			<div className="mt-4 h-1 bg-secondary rounded-full overflow-hidden">
				<div
					className="h-full bg-primary rounded-full transition-all duration-1000"
					style={{
						width: `${Math.min((elapsed / 120000) * 100, 95)}%`,
						boxShadow: "0 0 10px color-mix(in oklch, var(--primary) 50%, transparent)",
					}}
				/>
			</div>
		</div>
	);
}

// ============================================
// Deployment Row Component
// ============================================

function DeploymentRow({
	deployment,
	onRollback,
}: {
	deployment: Deployment;
	onRollback: (id: string) => void;
}) {
	const [showMenu, setShowMenu] = useState(false);

	return (
		<tr className="group hover:bg-primary/[0.03] transition-colors">
			{/* Status */}
			<td className="px-4 py-3">
				<StatusBadge status={deployment.status} />
			</td>

			{/* Commit */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-2">
					<GitCommit className="w-4 h-4 text-muted-foreground" />
					<span className="font-mono text-sm text-purple-500">
						{deployment.commitHash.slice(0, 7)}
					</span>
				</div>
				<p className="mt-0.5 text-sm text-secondary-foreground truncate max-w-[300px]">
					{deployment.commitMessage}
				</p>
			</td>

			{/* Branch */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5">
					<GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
					<span className="font-mono text-sm text-secondary-foreground">{deployment.branch}</span>
				</div>
			</td>

			{/* Environment */}
			<td className="px-4 py-3">
				<EnvBadge env={deployment.environment} />
			</td>

			{/* Duration */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
					<Timer className="w-3.5 h-3.5" />
					<span className="font-mono">{formatDuration(deployment.duration)}</span>
				</div>
			</td>

			{/* Deployed At */}
			<td className="px-4 py-3">
				<span className="text-sm text-muted-foreground">
					{formatRelativeTime(deployment.deployedAt)}
				</span>
			</td>

			{/* Actions */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
					{deployment.status === "success" && deployment.environment === "production" && (
						<button
							type="button"
							onClick={() => onRollback(deployment.id)}
							className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
						>
							<RotateCcw className="w-3.5 h-3.5" />
							Rollback
						</button>
					)}
					<div className="relative">
						<button
							type="button"
							onClick={() => setShowMenu(!showMenu)}
							className="p-1.5 rounded-md hover:bg-secondary transition-colors"
						>
							<MoreVertical className="w-4 h-4 text-muted-foreground" />
						</button>
						{showMenu && (
							<>
								{/* biome-ignore lint/a11y/useKeyWithClickEvents: menu overlay */}
								<div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
								<div className="absolute right-0 top-full mt-1 z-20 w-40 py-1 rounded-lg bg-card border border-primary/20 shadow-xl">
									<button
										type="button"
										className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
									>
										<ArrowUpRight className="w-3.5 h-3.5" />
										View logs
									</button>
									<button
										type="button"
										className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
									>
										<GitCommit className="w-3.5 h-3.5" />
										View commit
									</button>
								</div>
							</>
						)}
					</div>
				</div>
			</td>
		</tr>
	);
}

// ============================================
// Main Component
// ============================================

export default function DeploymentsPage() {
	const apiClient = useApiClient();
	const [deployments, setDeployments] = useState<Deployment[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedEnv, setSelectedEnv] = useState<Environment | "all">("all");

	const fetchDeployments = useCallback(async () => {
		setIsLoading(true);
		try {
			const data = await apiClient.getDeployments();
			setDeployments(data);
		} catch (err) {
			console.error("Failed to fetch deployments:", err);
			// Keep empty state - no mock data
		} finally {
			setIsLoading(false);
		}
	}, [apiClient]);

	useEffect(() => {
		fetchDeployments();
	}, [fetchDeployments]);

	// Polling for active deployments
	useEffect(() => {
		const hasActive = deployments.some((d) => d.status === "in_progress");
		if (!hasActive) return;

		const interval = setInterval(fetchDeployments, 5000);
		return () => clearInterval(interval);
	}, [deployments, fetchDeployments]);

	const handleRollback = (id: string) => {
		console.log("Rollback deployment:", id);
	};

	const activeDeployment = deployments.find((d) => d.status === "in_progress");
	const filteredDeployments =
		selectedEnv === "all" ? deployments : deployments.filter((d) => d.environment === selectedEnv);

	// Stats
	const stats = {
		total: deployments.length,
		success: deployments.filter((d) => d.status === "success").length,
		failed: deployments.filter((d) => d.status === "failed").length,
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-primary flex items-center justify-center shadow-lg shadow-purple-500/20">
						<Rocket className="w-5 h-5 text-background" />
					</div>
					<div>
						<h1 className="font-display text-2xl text-foreground">Deployments</h1>
						<p className="text-sm text-muted-foreground">CI/CD pipeline and deployment history</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					{/* Stats */}
					<div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-secondary">
						<div className="flex items-center gap-2">
							<CheckCircle2 className="w-4 h-4 text-green-500" />
							<span className="font-mono text-sm text-secondary-foreground">{stats.success}</span>
						</div>
						<div className="w-px h-4 bg-primary/20" />
						<div className="flex items-center gap-2">
							<XCircle className="w-4 h-4 text-destructive" />
							<span className="font-mono text-sm text-secondary-foreground">{stats.failed}</span>
						</div>
					</div>

					<button
						type="button"
						className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-background font-medium text-sm hover:opacity-90 transition-opacity"
					>
						<Rocket className="w-4 h-4" />
						Deploy
					</button>
				</div>
			</div>

			{/* Active Deployment */}
			{activeDeployment && <ActiveDeploymentCard deployment={activeDeployment} />}

			{/* Environment Tabs */}
			<div className="flex items-center gap-1 p-1 rounded-lg bg-secondary w-fit">
				<button
					type="button"
					onClick={() => setSelectedEnv("all")}
					className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
						selectedEnv === "all"
							? "bg-card text-foreground shadow-sm"
							: "text-muted-foreground hover:text-secondary-foreground"
					}`}
				>
					All
				</button>
				{ENVIRONMENTS.map((env) => {
					const config = ENV_CONFIG[env];
					const count = deployments.filter((d) => d.environment === env).length;
					return (
						<button
							type="button"
							key={env}
							onClick={() => setSelectedEnv(env)}
							className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
								selectedEnv === env
									? "bg-card shadow-sm"
									: "text-muted-foreground hover:text-secondary-foreground"
							}`}
							style={{
								color: selectedEnv === env ? `hsl(var(${config.color}))` : undefined,
							}}
						>
							<span className="capitalize">{env}</span>
							<span
								className="px-1.5 py-0.5 rounded text-xs font-mono"
								style={{
									background:
										selectedEnv === env
											? `color-mix(in oklch, var(${config.color}) 15%, transparent)`
											: "transparent",
								}}
							>
								{count}
							</span>
						</button>
					);
				})}
			</div>

			{/* Deployments Table */}
			<div className="bg-card border border-border rounded-lg overflow-hidden">
				<table className="w-full">
					<thead>
						<tr className="border-b border-primary/10 bg-secondary">
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Status
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Commit
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Branch
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Env
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Duration
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Deployed
							</th>
							<th className="px-4 py-3 text-left text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
								Actions
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-primary/[0.05]">
						{isLoading ? (
							Array.from({ length: 5 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
								<tr key={`skeleton-${i}`}>
									<td className="px-4 py-3">
										<div className="h-6 w-20 rounded-full bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-48 rounded bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-24 rounded bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3">
										<div className="h-5 w-12 rounded bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-16 rounded bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3">
										<div className="h-4 w-16 rounded bg-secondary animate-pulse" />
									</td>
									<td className="px-4 py-3" />
								</tr>
							))
						) : filteredDeployments.length === 0 ? (
							<tr>
								<td colSpan={7} className="px-4 py-12 text-center">
									<div className="flex flex-col items-center gap-3 text-muted-foreground">
										<Rocket className="w-12 h-12 opacity-30" />
										<span className="font-mono text-sm">No deployments found</span>
									</div>
								</td>
							</tr>
						) : (
							filteredDeployments.map((deployment) => (
								<DeploymentRow
									key={deployment.id}
									deployment={deployment}
									onRollback={handleRollback}
								/>
							))
						)}
					</tbody>
				</table>
			</div>

			{/* Pipeline Visual */}
			<div className="bg-card border border-border rounded-lg p-4">
				<div className="flex items-center gap-2 mb-4">
					<ChevronRight className="w-4 h-4 text-primary" />
					<span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
						Pipeline Overview
					</span>
				</div>
				<div className="flex items-center justify-between">
					{["Build", "Test", "Deploy Staging", "Deploy Prod"].map((stage, i) => (
						<div key={stage} className="flex items-center flex-1">
							<div className="flex-1 flex flex-col items-center">
								<div
									className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${i < 3 ? "bg-green-500/15" : "bg-primary/15"}`}
								>
									{i < 3 ? (
										<CheckCircle2 className="w-5 h-5 text-green-500" />
									) : (
										<Loader2 className="w-5 h-5 text-primary animate-spin" />
									)}
								</div>
								<span className="text-xs font-mono text-secondary-foreground">{stage}</span>
								<span className="text-[10px] text-muted-foreground mt-0.5">
									{i < 3 ? "2m 34s" : "In progress..."}
								</span>
							</div>
							{i < 3 && <div className="flex-1 h-0.5 bg-green-500/30 mx-2" />}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
