"use client";

import {
	AlertCircle,
	Box,
	CheckCircle2,
	Cpu,
	HardDrive,
	Loader2,
	MemoryStick,
	MoreVertical,
	Pause,
	Play,
	RefreshCw,
	RotateCcw,
	Square,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { type ContainerInfo, createDockerClient } from "@/lib/docker";

// ============================================
// Types & Constants
// ============================================

type ContainerState =
	| "running"
	| "exited"
	| "paused"
	| "restarting"
	| "dead"
	| "created"
	| "removing";

const STATE_CONFIG: Record<
	ContainerState,
	{ color: string; icon: typeof CheckCircle2; label: string }
> = {
	running: { color: "green-500", icon: CheckCircle2, label: "Running" },
	exited: { color: "amber-500", icon: Square, label: "Exited" },
	paused: { color: "blue-500", icon: Pause, label: "Paused" },
	restarting: { color: "primary", icon: RefreshCw, label: "Restarting" },
	dead: { color: "destructive", icon: XCircle, label: "Dead" },
	created: { color: "muted-foreground", icon: Box, label: "Created" },
	removing: { color: "amber-500", icon: Loader2, label: "Removing" },
};

// ============================================
// Helper Functions
// ============================================

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(created: number): string {
	const now = Date.now() / 1000;
	const diff = now - created;

	if (diff < 60) return `${Math.floor(diff)}s`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
	return `${Math.floor(diff / 86400)}d`;
}

function getRestartCountColor(count: number): string {
	if (count === 0) return "text-muted-foreground";
	if (count < 3) return "text-amber-500";
	return "text-destructive";
}

// ============================================
// Status Badge Component
// ============================================

function ContainerStatusBadge({ state }: { state: ContainerState }) {
	const config = STATE_CONFIG[state] || STATE_CONFIG.created;
	const Icon = config.icon;
	const isAnimated = state === "restarting" || state === "removing";

	return (
		<Badge
			variant="outline"
			className={`bg-${config.color}/10 text-${config.color} border-${config.color}/30 hover:bg-${config.color}/20`}
		>
			<Icon className={`mr-1 h-3 w-3 ${isAnimated ? "animate-spin" : ""}`} />
			{config.label}
		</Badge>
	);
}

// ============================================
// Resource Progress Bar
// ============================================

function ResourceBar({
	value,
	icon: Icon,
	label,
	color = "primary",
}: {
	value: number;
	icon: typeof Cpu;
	label: string;
	color?: "primary" | "green-500" | "amber-500" | "destructive";
}) {
	const getColor = () => {
		if (value > 90) return "destructive";
		if (value > 70) return "amber-500";
		return color;
	};

	const actualColor = getColor();

	return (
		<div className="flex items-center gap-2 min-w-[100px]">
			<Icon className={`h-3.5 w-3.5 text-${actualColor}`} />
			<div className="flex-1">
				<div className="flex items-center justify-between mb-0.5">
					<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
						{label}
					</span>
					<span className={`font-mono text-xs text-${actualColor}`}>{value.toFixed(1)}%</span>
				</div>
				<Progress value={value} className={`h-1 [&>div]:bg-${actualColor}`} />
			</div>
		</div>
	);
}

// ============================================
// Container Row Component
// ============================================

function ContainerRow({
	container,
	onStart,
	onStop,
	onRestart,
	onPause,
	onUnpause,
	isActioning,
}: {
	container: ContainerInfo;
	onStart: (id: string) => Promise<void>;
	onStop: (id: string) => Promise<void>;
	onRestart: (id: string) => Promise<void>;
	onPause: (id: string) => Promise<void>;
	onUnpause: (id: string) => Promise<void>;
	isActioning: boolean;
}) {
	const [showMenu, setShowMenu] = useState(false);
	const [actionInProgress, setActionInProgress] = useState<string | null>(null);
	const name = container.names[0] || container.id.slice(0, 12);
	const isRunning = container.state === "running";
	const isPaused = container.state === "paused";

	// Extract restart count from status string (e.g., "Exited (0) 2 hours ago")
	const restartMatch = container.status.match(/Restarting \((\d+)\)/);
	const restartCount = restartMatch ? Number.parseInt(restartMatch[1], 10) : 0;

	const handleAction = async (action: string, fn: (id: string) => Promise<void>) => {
		setActionInProgress(action);
		try {
			await fn(container.id);
		} finally {
			setActionInProgress(null);
			setShowMenu(false);
		}
	};

	return (
		<tr className="group hover:bg-primary/[0.02] transition-colors border-b border-primary/5 last:border-0">
			{/* Name & ID */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-3">
					<div
						className={`w-8 h-8 rounded-lg flex items-center justify-center ${
							isRunning ? "bg-green-500/10" : "bg-muted"
						}`}
					>
						<Box className={`w-4 h-4 ${isRunning ? "text-green-500" : "text-muted-foreground"}`} />
					</div>
					<div>
						<div className="font-mono text-sm font-medium text-foreground">{name}</div>
						<div className="font-mono text-[10px] text-muted-foreground">
							{container.id.slice(0, 12)}
						</div>
					</div>
				</div>
			</td>

			{/* Image */}
			<td className="px-4 py-3">
				<span className="font-mono text-xs text-secondary-foreground truncate max-w-[200px] block">
					{container.image.split(":")[0]}
				</span>
				<span className="font-mono text-[10px] text-muted-foreground">
					:{container.image.split(":")[1] || "latest"}
				</span>
			</td>

			{/* Status */}
			<td className="px-4 py-3">
				<ContainerStatusBadge state={container.state} />
				<div className="text-[10px] text-muted-foreground mt-0.5">
					{isRunning && `Up ${formatUptime(container.created)}`}
					{!isRunning && container.status.replace(/^(Up|Exited)[^)]*\)\s*/, "")}
				</div>
			</td>

			{/* CPU % */}
			<td className="px-4 py-3">
				{container.stats ? (
					<ResourceBar
						value={container.stats.cpu.percentage}
						icon={Cpu}
						label="CPU"
						color="primary"
					/>
				) : (
					<span className="text-xs text-muted-foreground font-mono">—</span>
				)}
			</td>

			{/* Memory % */}
			<td className="px-4 py-3">
				{container.stats ? (
					<div className="space-y-1">
						<ResourceBar
							value={container.stats.memory.percentage}
							icon={MemoryStick}
							label="MEM"
							color="green-500"
						/>
						<div className="text-[10px] font-mono text-muted-foreground pl-5">
							{formatBytes(container.stats.memory.usage)} /{" "}
							{formatBytes(container.stats.memory.limit)}
						</div>
					</div>
				) : (
					<span className="text-xs text-muted-foreground font-mono">—</span>
				)}
			</td>

			{/* Restart Count */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5">
					<RotateCcw className={`w-3.5 h-3.5 ${getRestartCountColor(restartCount)}`} />
					<span className={`font-mono text-sm ${getRestartCountColor(restartCount)}`}>
						{restartCount}
					</span>
				</div>
			</td>

			{/* Actions */}
			<td className="px-4 py-3">
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					{isRunning && (
						<>
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
								onClick={() => handleAction("stop", onStop)}
								disabled={isActioning || actionInProgress !== null}
							>
								{actionInProgress === "stop" ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Square className="h-3.5 w-3.5" />
								)}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
								onClick={() => handleAction("restart", onRestart)}
								disabled={isActioning || actionInProgress !== null}
							>
								{actionInProgress === "restart" ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<RefreshCw className="h-3.5 w-3.5" />
								)}
							</Button>
						</>
					)}
					{!isRunning && container.state !== "removing" && (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10"
							onClick={() => handleAction("start", onStart)}
							disabled={isActioning || actionInProgress !== null}
						>
							{actionInProgress === "start" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Play className="h-3.5 w-3.5" />
							)}
						</Button>
					)}
					{isPaused && (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
							onClick={() => handleAction("unpause", onUnpause)}
							disabled={isActioning || actionInProgress !== null}
						>
							{actionInProgress === "unpause" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Play className="h-3.5 w-3.5" />
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
								<div className="absolute right-0 top-full mt-1 z-20 w-36 py-1 rounded-lg bg-card border border-primary/20 shadow-xl">
									{isRunning && (
										<button
											type="button"
											className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
											onClick={() => handleAction("pause", onPause)}
										>
											<Pause className="w-3.5 h-3.5" />
											Pause
										</button>
									)}
									<button
										type="button"
										className="w-full px-3 py-2 text-left text-sm text-secondary-foreground hover:bg-secondary transition-colors flex items-center gap-2"
									>
										<HardDrive className="w-3.5 h-3.5" />
										View Logs
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
// Skeleton Row Component
// ============================================

function ContainerRowSkeleton() {
	return (
		<tr className="border-b border-primary/5">
			<td className="px-4 py-3">
				<div className="flex items-center gap-3">
					<Skeleton className="w-8 h-8 rounded-lg" />
					<div className="space-y-1">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-3 w-16" />
					</div>
				</div>
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-32" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-5 w-20 rounded-full" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-24" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-28" />
			</td>
			<td className="px-4 py-3">
				<Skeleton className="h-4 w-8" />
			</td>
			<td className="px-4 py-3" />
		</tr>
	);
}

// ============================================
// Main Component
// ============================================

export interface ContainerListProps {
	pollInterval?: number;
	showHeader?: boolean;
	showAll?: boolean;
}

export function ContainerList({
	pollInterval = 5000,
	showHeader = true,
	showAll = true,
}: ContainerListProps) {
	const [containers, setContainers] = useState<ContainerInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isActioning, setIsActioning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

	const fetchContainers = useCallback(
		async (initial = false) => {
			if (initial) setIsLoading(true);
			try {
				const docker = createDockerClient();
				const data = await docker.getContainersWithStats(showAll);
				setContainers(data);
				setError(null);
				setLastUpdate(new Date());
			} catch (err) {
				console.error("Failed to fetch containers:", err);
				setError(err instanceof Error ? err.message : "Failed to connect to Docker");
			} finally {
				setIsLoading(false);
			}
		},
		[showAll],
	);

	useEffect(() => {
		fetchContainers(true);
	}, [fetchContainers]);

	useEffect(() => {
		if (pollInterval <= 0) return;
		const interval = setInterval(() => fetchContainers(false), pollInterval);
		return () => clearInterval(interval);
	}, [fetchContainers, pollInterval]);

	const handleStart = async (id: string) => {
		setIsActioning(true);
		try {
			const docker = createDockerClient();
			await docker.startContainer(id);
			await fetchContainers(false);
		} finally {
			setIsActioning(false);
		}
	};

	const handleStop = async (id: string) => {
		setIsActioning(true);
		try {
			const docker = createDockerClient();
			await docker.stopContainer(id);
			await fetchContainers(false);
		} finally {
			setIsActioning(false);
		}
	};

	const handleRestart = async (id: string) => {
		setIsActioning(true);
		try {
			const docker = createDockerClient();
			await docker.restartContainer(id);
			await fetchContainers(false);
		} finally {
			setIsActioning(false);
		}
	};

	const handlePause = async (id: string) => {
		setIsActioning(true);
		try {
			const docker = createDockerClient();
			await docker.pauseContainer(id);
			await fetchContainers(false);
		} finally {
			setIsActioning(false);
		}
	};

	const handleUnpause = async (id: string) => {
		setIsActioning(true);
		try {
			const docker = createDockerClient();
			await docker.unpauseContainer(id);
			await fetchContainers(false);
		} finally {
			setIsActioning(false);
		}
	};

	const runningCount = containers.filter((c) => c.state === "running").length;

	if (error && isLoading) {
		return (
			<Card>
				{showHeader && (
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Box className="w-5 h-5 text-primary" />
							Containers
						</CardTitle>
					</CardHeader>
				)}
				<CardContent>
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<AlertCircle className="h-12 w-12 text-destructive mb-4" />
						<p className="text-sm text-muted-foreground mb-4">{error}</p>
						<Button variant="outline" size="sm" onClick={() => fetchContainers(true)}>
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
							<Box className="w-5 h-5 text-primary" />
							Containers
						</CardTitle>
						<div className="flex items-center gap-3">
							{lastUpdate && (
								<span className="text-[10px] text-muted-foreground font-mono">
									{lastUpdate.toLocaleTimeString()}
								</span>
							)}
							<Badge variant="outline" className="font-mono">
								<span className="text-green-500">{runningCount}</span>
								<span className="mx-1 text-muted-foreground">/</span>
								<span>{containers.length}</span>
							</Badge>
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
									Container
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Image
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Status
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									CPU
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Memory
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Restarts
								</th>
								<th className="px-4 py-2.5 text-left text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{isLoading ? (
								Array.from({ length: 4 }).map((_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
									<ContainerRowSkeleton key={`skeleton-${i}`} />
								))
							) : containers.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center">
										<div className="flex flex-col items-center gap-3 text-muted-foreground">
											<Box className="w-12 h-12 opacity-30" />
											<span className="font-mono text-sm">No containers found</span>
											<span className="text-xs">Start a container to see it here</span>
										</div>
									</td>
								</tr>
							) : (
								containers.map((container) => (
									<ContainerRow
										key={container.id}
										container={container}
										onStart={handleStart}
										onStop={handleStop}
										onRestart={handleRestart}
										onPause={handlePause}
										onUnpause={handleUnpause}
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
