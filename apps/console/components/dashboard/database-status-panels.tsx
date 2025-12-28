"use client";

import { AlertCircle, CheckCircle2, Database, Layers, Network, Radio, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";

interface DatabaseConfig {
	name: string;
	icon: typeof Database;
	description: string;
}

const DATABASE_CONFIG: Record<string, DatabaseConfig> = {
	FalkorDB: {
		name: "FalkorDB",
		icon: Network,
		description: "Graph Database",
	},
	Qdrant: {
		name: "Qdrant",
		icon: Layers,
		description: "Vector Search",
	},
	NATS: {
		name: "NATS",
		icon: Radio,
		description: "Message Queue",
	},
	PostgreSQL: {
		name: "PostgreSQL",
		icon: Database,
		description: "Relational DB",
	},
};

interface SimulatedMetrics {
	connections: number;
	memoryUsage: number;
	opsPerSec: number;
	uptime: string;
}

function getDefaultMetrics(status: string): SimulatedMetrics {
	const isHealthy = status === "online";
	return {
		connections: isHealthy ? 1 : 0,
		memoryUsage: isHealthy ? 50 : 0,
		opsPerSec: isHealthy ? 100 : 0,
		uptime: isHealthy ? "N/A" : "0%",
	};
}

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "online":
			return (
				<Badge variant="default" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
					<CheckCircle2 className="mr-1 h-3 w-3" />
					Online
				</Badge>
			);
		case "warning":
			return (
				<Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">
					<AlertCircle className="mr-1 h-3 w-3" />
					Degraded
				</Badge>
			);
		case "error":
		case "offline":
			return (
				<Badge variant="destructive">
					<XCircle className="mr-1 h-3 w-3" />
					Offline
				</Badge>
			);
		default:
			return (
				<Badge variant="outline">
					<span className="mr-1 h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
					Unknown
				</Badge>
			);
	}
}

interface HealthHistory {
	status: string;
	timestamp: number;
}

function HealthHistoryBar({ history, status }: { history: HealthHistory[]; status: string }) {
	const getStatusColor = (entryStatus: string) => {
		switch (entryStatus) {
			case "online":
				return "bg-green-500";
			case "warning":
				return "bg-amber-500";
			default:
				return "bg-destructive";
		}
	};

	return (
		<div className="flex items-center gap-0.5">
			{history.map((entry, idx) => (
				<div
					key={entry.timestamp}
					className={`w-2 h-4 rounded-sm transition-all duration-300 ${getStatusColor(entry.status)}`}
					style={{
						opacity: 0.3 + (idx / history.length) * 0.7,
					}}
					title={`${new Date(entry.timestamp).toLocaleTimeString()} - ${entry.status}`}
				/>
			))}
		</div>
	);
}

interface DatabaseCardProps {
	health: ServiceHealth;
	config: DatabaseConfig;
	metrics: SimulatedMetrics;
	history: HealthHistory[];
}

function DatabaseCard({ health, config, metrics, history }: DatabaseCardProps) {
	const Icon = config.icon;
	const isOnline = health.status === "online";

	return (
		<Card className="relative overflow-hidden transition-all hover:shadow-lg hover:shadow-primary/5 group">
			{/* Top border accent */}
			<div
				className={`absolute top-0 left-0 right-0 h-0.5 ${
					isOnline
						? "bg-gradient-to-r from-green-500/80 to-green-500/20"
						: health.status === "warning"
							? "bg-amber-500"
							: "bg-destructive"
				}`}
			/>

			<CardHeader className="pb-2">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div
							className={`flex h-10 w-10 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${
								isOnline
									? "bg-green-500/10"
									: health.status === "warning"
										? "bg-amber-500/10"
										: "bg-destructive/10"
							}`}
						>
							<Icon
								className={`h-5 w-5 ${
									isOnline
										? "text-green-500"
										: health.status === "warning"
											? "text-amber-500"
											: "text-destructive"
								}`}
							/>
						</div>
						<div>
							<CardTitle className="text-sm font-medium group-hover:text-primary transition-colors">
								{config.name}
							</CardTitle>
							<p className="text-xs text-muted-foreground">{config.description}</p>
						</div>
					</div>
					<StatusBadge status={health.status} />
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				{/* Metrics Grid */}
				<div className="grid grid-cols-2 gap-3">
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground">
							Connections
						</div>
						<div className="font-mono text-sm">{metrics.connections}</div>
					</div>
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground">Memory</div>
						<div className="font-mono text-sm">{metrics.memoryUsage}%</div>
					</div>
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground">
							Ops/sec
						</div>
						<div className="font-mono text-sm">{metrics.opsPerSec.toLocaleString()}</div>
					</div>
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground">Uptime</div>
						<div className="font-mono text-sm text-green-500">{metrics.uptime}</div>
					</div>
				</div>

				{/* Memory Usage Progress */}
				<div className="space-y-1.5">
					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">Memory Usage</span>
						<span className="font-mono">{metrics.memoryUsage}%</span>
					</div>
					<Progress
						value={metrics.memoryUsage}
						className={`h-1.5 ${
							metrics.memoryUsage > 90
								? "[&>div]:bg-destructive"
								: metrics.memoryUsage > 70
									? "[&>div]:bg-amber-500"
									: "[&>div]:bg-green-500"
						}`}
					/>
				</div>

				{/* Footer: Port + Latency + Health History */}
				<div className="flex items-center justify-between pt-2 border-t">
					<div className="flex items-center gap-3">
						{health.port && (
							<span className="font-mono text-[10px] text-muted-foreground">:{health.port}</span>
						)}
						{health.latency !== undefined && (
							<span
								className={`font-mono text-[10px] ${
									health.latency < 10
										? "text-green-500"
										: health.latency < 50
											? "text-amber-500"
											: "text-destructive"
								}`}
							>
								{health.latency}ms
							</span>
						)}
					</div>
					<HealthHistoryBar history={history} status={health.status} />
				</div>
			</CardContent>
		</Card>
	);
}

function DatabaseCardSkeleton() {
	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<Skeleton className="h-10 w-10 rounded-lg" />
						<div className="space-y-2">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-3 w-16" />
						</div>
					</div>
					<Skeleton className="h-5 w-16" />
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="grid grid-cols-2 gap-3">
					{Array.from({ length: 4 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<div key={i} className="space-y-1">
							<Skeleton className="h-2 w-12" />
							<Skeleton className="h-4 w-8" />
						</div>
					))}
				</div>
				<Skeleton className="h-1.5 w-full" />
				<div className="pt-2 border-t">
					<div className="flex items-center justify-between">
						<Skeleton className="h-3 w-16" />
						<div className="flex gap-0.5">
							{Array.from({ length: 5 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
								<Skeleton key={i} className="w-2 h-4 rounded-sm" />
							))}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export interface DatabaseStatusPanelsProps {
	pollInterval?: number;
	showHeader?: boolean;
}

export function DatabaseStatusPanels({
	pollInterval = 10000,
	showHeader = true,
}: DatabaseStatusPanelsProps) {
	const apiClient = useApiClient();
	const [healthData, setHealthData] = useState<ServiceHealth[]>([]);
	const [metricsData, setMetricsData] = useState<Record<string, SimulatedMetrics>>({});
	const [historyData, setHistoryData] = useState<Record<string, HealthHistory[]>>({});
	const [isLoading, setIsLoading] = useState(true);
	const historyRef = useRef<Record<string, HealthHistory[]>>({});

	const fetchHealth = useCallback(
		async (isInitial = false) => {
			if (isInitial) {
				setIsLoading(true);
			}

			try {
				const data = await apiClient.getInfraHealth();
				setHealthData(data);

				const newMetrics: Record<string, SimulatedMetrics> = {};
				for (const service of data) {
					newMetrics[service.name] = getDefaultMetrics(service.status);
				}
				setMetricsData(newMetrics);

				const now = Date.now();
				const updatedHistory = { ...historyRef.current };
				for (const service of data) {
					const existing = updatedHistory[service.name] || [];
					updatedHistory[service.name] = [
						...existing,
						{ status: service.status, timestamp: now },
					].slice(-5);
				}
				historyRef.current = updatedHistory;
				setHistoryData(updatedHistory);
			} catch (err) {
				console.error("Failed to fetch infrastructure health:", err);
			} finally {
				setIsLoading(false);
			}
		},
		[apiClient],
	);

	useEffect(() => {
		fetchHealth(true);
	}, [fetchHealth]);

	useEffect(() => {
		if (pollInterval <= 0) return;
		const interval = setInterval(() => fetchHealth(false), pollInterval);
		return () => clearInterval(interval);
	}, [fetchHealth, pollInterval]);

	const onlineCount = healthData.filter((h) => h.status === "online").length;

	if (isLoading) {
		return (
			<div className="space-y-4">
				{showHeader && (
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-semibold">Infrastructure</h3>
					</div>
				)}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<DatabaseCardSkeleton key={i} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{showHeader && (
				<div className="flex items-center justify-between">
					<h3 className="text-lg font-semibold">Infrastructure</h3>
					<Badge
						variant={
							onlineCount === healthData.length
								? "default"
								: onlineCount > 0
									? "secondary"
									: "destructive"
						}
						className="font-mono"
					>
						{onlineCount}/{healthData.length} Online
					</Badge>
				</div>
			)}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				{healthData.map((health) => {
					const config = DATABASE_CONFIG[health.name];
					if (!config) return null;

					return (
						<DatabaseCard
							key={health.name}
							health={health}
							config={config}
							metrics={metricsData[health.name] || getDefaultMetrics(health.status)}
							history={historyData[health.name] || []}
						/>
					);
				})}
			</div>
		</div>
	);
}
