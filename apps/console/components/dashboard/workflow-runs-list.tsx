"use client";

import {
	AlertCircle,
	CheckCircle2,
	CircleDot,
	Clock,
	ExternalLink,
	GitBranch,
	Loader2,
	MoreVertical,
	Play,
	RotateCcw,
	Timer,
	User,
	Workflow,
	XCircle,
	XOctagon,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getEngramGitHubClient, type WorkflowRun } from "@/lib/github";

// ============================================
// Types & Constants
// ============================================

type RunStatus = WorkflowRun["status"];
type RunConclusion = NonNullable<WorkflowRun["conclusion"]>;

const STATUS_CONFIG: Record<
	RunStatus,
	{ color: string; icon: typeof CheckCircle2; label: string; animate?: boolean }
> = {
	queued: { color: "amber-500", icon: Clock, label: "Queued" },
	in_progress: { color: "blue-500", icon: Loader2, label: "Running", animate: true },
	completed: { color: "muted-foreground", icon: CheckCircle2, label: "Completed" },
	waiting: { color: "amber-500", icon: Clock, label: "Waiting" },
	requested: { color: "muted-foreground", icon: CircleDot, label: "Requested" },
	pending: { color: "amber-500", icon: Clock, label: "Pending" },
};

const CONCLUSION_CONFIG: Record<
	RunConclusion,
	{ color: string; icon: typeof CheckCircle2; label: string }
> = {
	success: { color: "green-500", icon: CheckCircle2, label: "Success" },
	failure: { color: "destructive", icon: XCircle, label: "Failed" },
	neutral: { color: "muted-foreground", icon: CircleDot, label: "Neutral" },
	cancelled: { color: "muted-foreground", icon: XOctagon, label: "Cancelled" },
	skipped: { color: "muted-foreground", icon: CircleDot, label: "Skipped" },
	timed_out: { color: "amber-500", icon: Timer, label: "Timed Out" },
	action_required: { color: "amber-500", icon: AlertCircle, label: "Action Required" },
};

// ============================================
// Helper Functions
// ============================================

function formatDuration(startTime: string, endTime?: string): string {
	const start = new Date(startTime).getTime();
	const end = endTime ? new Date(endTime).getTime() : Date.now();
	const diff = end - start;

	if (diff < 1000) return "<1s";
	if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
	if (diff < 3600000) {
		const mins = Math.floor(diff / 60000);
		const secs = Math.floor((diff % 60000) / 1000);
		return `${mins}m ${secs}s`;
	}
	const hours = Math.floor(diff / 3600000);
	const mins = Math.floor((diff % 3600000) / 60000);
	return `${hours}h ${mins}m`;
}

function formatRelativeTime(timestamp: string): string {
	const now = Date.now();
	const time = new Date(timestamp).getTime();
	const diff = now - time;

	if (diff < 60000) return "Just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

function getEventIcon(event: string): string {
	switch (event) {
		case "push":
			return "⬆";
		case "pull_request":
			return "⤴";
		case "workflow_dispatch":
			return "▶";
		case "schedule":
			return "⏰";
		default:
			return "•";
	}
}

// ============================================
// Status Badge Component
// ============================================

function RunStatusBadge({ run }: { run: WorkflowRun }) {
	// Show conclusion if completed, otherwise show status
	const isCompleted = run.status === "completed" && run.conclusion;

	if (isCompleted && run.conclusion) {
		const config = CONCLUSION_CONFIG[run.conclusion];
		const Icon = config.icon;
		return (
			<Badge
				variant="outline"
				className={`bg-${config.color}/10 text-${config.color} border-${config.color}/30 hover:bg-${config.color}/20`}
			>
				<Icon className="mr-1 h-3 w-3" />
				{config.label}
			</Badge>
		);
	}

	const config = STATUS_CONFIG[run.status];
	const Icon = config.icon;
	return (
		<Badge
			variant="outline"
			className={`bg-${config.color}/10 text-${config.color} border-${config.color}/30 hover:bg-${config.color}/20`}
		>
			<Icon className={`mr-1 h-3 w-3 ${config.animate ? "animate-spin" : ""}`} />
			{config.label}
		</Badge>
	);
}

// ============================================
// Workflow Run Row Component
// ============================================

function WorkflowRunRow({
	run,
	onRerun,
	onCancel,
	isActioning,
}: {
	run: WorkflowRun;
	onRerun: (id: number) => Promise<void>;
	onCancel: (id: number) => Promise<void>;
	isActioning: boolean;
}) {
	const [showMenu, setShowMenu] = useState(false);
	const [actionInProgress, setActionInProgress] = useState<string | null>(null);
	const isInProgress = run.status === "in_progress" || run.status === "queued";
	const canRerun = run.status === "completed";

	const handleAction = async (action: string, fn: (id: number) => Promise<void>) => {
		setActionInProgress(action);
		try {
			await fn(run.id);
		} finally {
			setActionInProgress(null);
			setShowMenu(false);
		}
	};

	return (
		<tr className="group hover:bg-primary/[0.02] transition-colors border-b border-primary/5 last:border-0">
			{/* Workflow Name */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-3">
					<div
						className={`w-8 h-8 rounded-lg flex items-center justify-center ${
							run.conclusion === "success"
								? "bg-green-500/10"
								: run.conclusion === "failure"
									? "bg-destructive/10"
									: isInProgress
										? "bg-blue-500/10"
										: "bg-muted"
						}`}
					>
						<Workflow
							className={`w-4 h-4 ${
								run.conclusion === "success"
									? "text-green-500"
									: run.conclusion === "failure"
										? "text-destructive"
										: isInProgress
											? "text-blue-500"
											: "text-muted-foreground"
							}`}
						/>
					</div>
					<div>
						<div className="font-mono text-sm font-medium text-foreground">{run.name}</div>
						<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
							<span>{getEventIcon(run.event)}</span>
							<span className="font-mono">#{run.runNumber}</span>
						</div>
					</div>
				</div>
			</td>

			{/* Branch */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5">
					<GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
					<span className="font-mono text-xs text-secondary-foreground truncate max-w-[120px]">
						{run.headBranch}
					</span>
				</div>
				<div className="font-mono text-[10px] text-muted-foreground mt-0.5">
					{run.headSha.slice(0, 7)}
				</div>
			</td>

			{/* Status */}
			<td className="px-4 py-3">
				<RunStatusBadge run={run} />
			</td>

			{/* Duration */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5">
					<Timer className="w-3.5 h-3.5 text-muted-foreground" />
					<span className="font-mono text-xs text-secondary-foreground">
						{formatDuration(
							run.runStartedAt,
							run.status === "completed" ? run.updatedAt : undefined,
						)}
					</span>
				</div>
			</td>

			{/* Actor */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-2">
					{run.actor.avatarUrl ? (
						<Image
							src={run.actor.avatarUrl}
							alt={run.actor.login}
							width={20}
							height={20}
							className="rounded-full border border-primary/10"
							unoptimized
						/>
					) : (
						<div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
							<User className="w-3 h-3 text-muted-foreground" />
						</div>
					)}
					<span className="font-mono text-xs text-secondary-foreground">{run.actor.login}</span>
				</div>
			</td>

			{/* Triggered */}
			<td className="px-4 py-3">
				<span className="text-xs text-muted-foreground">{formatRelativeTime(run.createdAt)}</span>
			</td>

			{/* Actions */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					{canRerun && (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
							onClick={() => handleAction("rerun", onRerun)}
							disabled={isActioning || actionInProgress !== null}
							title="Rerun workflow"
						>
							{actionInProgress === "rerun" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<RotateCcw className="h-3.5 w-3.5" />
							)}
						</Button>
					)}
					{isInProgress && (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
							onClick={() => handleAction("cancel", onCancel)}
							disabled={isActioning || actionInProgress !== null}
							title="Cancel workflow"
						>
							{actionInProgress === "cancel" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<XOctagon className="h-3.5 w-3.5" />
							)}
						</Button>
					)}

					{/* More menu */}
					<div className="relative">
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={() => setShowMenu(!showMenu)}
						>
							<MoreVertical className="h-3.5 w-3.5" />
						</Button>
						{showMenu && (
							<>
								{/* biome-ignore lint/a11y/useKeyWithClickEvents: menu overlay */}
								<div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
								<div className="absolute right-0 top-full mt-1 z-20 w-40 py-1 rounded-lg bg-card border border-primary/20 shadow-xl">
									<a
										href={run.htmlUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
									>
										<ExternalLink className="w-3.5 h-3.5" />
										View on GitHub
									</a>
									{canRerun && (
										<button
											type="button"
											className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
											onClick={() => handleAction("rerun", onRerun)}
										>
											<Play className="w-3.5 h-3.5" />
											Re-run with Debug
										</button>
									)}
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
// Skeleton Row Component
// ============================================

function WorkflowRunRowSkeleton() {
	return (
		<tr className="border-b border-primary/5">
			<td className="px-4 py-3">
				<div className="flex items-center gap-3">
					<Skeleton className="w-8 h-8 rounded-lg" />
					<div className="space-y-1">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-16" />
					</div>
				</div>
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-24" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-5 w-20 rounded-full" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-16" />
			</td>
			<td className="px-4 py-3">
				<div className="flex items-center gap-2">
					<Skeleton className="w-5 h-5 rounded-full" />
					<Skeleton className="h-3 w-16" />
				</div>
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-3 w-14" />
			</td>
			<td className="px-4 py-3" />
		</tr>
	);
}

// ============================================
// Main Component
// ============================================

export interface WorkflowRunsListProps {
	pollInterval?: number;
	showHeader?: boolean;
	limit?: number;
}

export function WorkflowRunsList({
	pollInterval = 30000,
	showHeader = true,
	limit = 20,
}: WorkflowRunsListProps) {
	const [runs, setRuns] = useState<WorkflowRun[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isActioning, setIsActioning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

	// Check if any runs are in progress for smart polling
	const hasActiveRuns = useMemo(
		() => runs.some((r) => r.status === "in_progress" || r.status === "queued"),
		[runs],
	);

	// Calculate dynamic poll interval (5s when active, otherwise use prop)
	const activePollInterval = hasActiveRuns ? 5000 : pollInterval;

	const fetchRuns = useCallback(
		async (initial = false) => {
			if (initial) setIsLoading(true);
			try {
				const github = getEngramGitHubClient();
				const { runs: data } = await github.listWorkflowRuns({ perPage: limit });
				setRuns(data);
				setError(null);
				setLastUpdate(new Date());
			} catch (err) {
				console.error("Failed to fetch workflow runs:", err);
				setError(err instanceof Error ? err.message : "Failed to connect to GitHub");
			} finally {
				setIsLoading(false);
			}
		},
		[limit],
	);

	useEffect(() => {
		fetchRuns(true);
	}, [fetchRuns]);

	useEffect(() => {
		if (activePollInterval <= 0) return;
		const interval = setInterval(() => fetchRuns(false), activePollInterval);
		return () => clearInterval(interval);
	}, [fetchRuns, activePollInterval]);

	const handleRerun = async (id: number) => {
		setIsActioning(true);
		try {
			const github = getEngramGitHubClient();
			await github.rerunWorkflow(id);
			// Wait a bit for GitHub to process, then refresh
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await fetchRuns(false);
		} finally {
			setIsActioning(false);
		}
	};

	const handleCancel = async (id: number) => {
		setIsActioning(true);
		try {
			const github = getEngramGitHubClient();
			await github.cancelWorkflowRun(id);
			await fetchRuns(false);
		} finally {
			setIsActioning(false);
		}
	};

	const successCount = runs.filter((r) => r.conclusion === "success").length;
	const failedCount = runs.filter((r) => r.conclusion === "failure").length;
	const activeCount = runs.filter(
		(r) => r.status === "in_progress" || r.status === "queued",
	).length;

	if (error && isLoading) {
		return (
			<Card>
				{showHeader && (
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Workflow className="w-5 h-5 text-primary" />
							Workflow Runs
						</CardTitle>
					</CardHeader>
				)}
				<CardContent>
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<AlertCircle className="h-12 w-12 text-destructive mb-4" />
						<p className="text-sm text-muted-foreground mb-4">{error}</p>
						<Button variant="outline" size="sm" onClick={() => fetchRuns(true)}>
							Retry
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="overflow-hidden">
			{showHeader && (
				<CardHeader className="border-b border-primary/5">
					<div className="flex items-center justify-between">
						<CardTitle className="flex items-center gap-2">
							<Workflow className="w-5 h-5 text-primary" />
							Workflow Runs
						</CardTitle>
						<div className="flex items-center gap-3">
							{lastUpdate && (
								<span className="text-[10px] text-muted-foreground font-mono">
									{lastUpdate.toLocaleTimeString()}
								</span>
							)}
							{activeCount > 0 && (
								<Badge
									variant="outline"
									className="font-mono bg-blue-500/10 text-blue-500 border-blue-500/30"
								>
									<Loader2 className="w-3 h-3 mr-1 animate-spin" />
									{activeCount} running
								</Badge>
							)}
							<div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50">
								<div className="flex items-center gap-1">
									<CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
									<span className="font-mono text-xs text-green-500">{successCount}</span>
								</div>
								<div className="w-px h-3 bg-primary/20" />
								<div className="flex items-center gap-1">
									<XCircle className="w-3.5 h-3.5 text-destructive" />
									<span className="font-mono text-xs text-destructive">{failedCount}</span>
								</div>
							</div>
						</div>
					</div>
				</CardHeader>
			)}
			<CardContent className="p-0">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="bg-muted/30 border-b border-primary/10">
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Workflow
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Branch
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Duration
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Actor
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Triggered
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{isLoading ? (
								Array.from({ length: 5 }).map((_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
									<WorkflowRunRowSkeleton key={`skeleton-${i}`} />
								))
							) : runs.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center">
										<div className="flex flex-col items-center gap-3 text-muted-foreground">
											<Workflow className="w-12 h-12 opacity-30" />
											<span className="font-mono text-sm">No workflow runs found</span>
											<span className="text-xs">
												Push a commit or trigger a workflow to see runs here
											</span>
										</div>
									</td>
								</tr>
							) : (
								runs.map((run) => (
									<WorkflowRunRow
										key={run.id}
										run={run}
										onRerun={handleRerun}
										onCancel={handleCancel}
										isActioning={isActioning}
									/>
								))
							)}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}
