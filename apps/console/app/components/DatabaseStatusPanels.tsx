"use client";

import { Text, Title } from "@tremor/react";
import { AlertCircle, CheckCircle2, Database, Layers, Network, Radio, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";

interface DatabaseConfig {
	name: string;
	icon: typeof Database;
	colorVar: string;
	description: string;
}

const DATABASE_CONFIG: Record<string, DatabaseConfig> = {
	FalkorDB: {
		name: "FalkorDB",
		icon: Network,
		colorVar: "--console-cyan",
		description: "Graph Database",
	},
	Qdrant: {
		name: "Qdrant",
		icon: Layers,
		colorVar: "--console-purple",
		description: "Vector Search",
	},
	NATS: {
		name: "NATS",
		icon: Radio,
		colorVar: "--console-green",
		description: "Message Queue",
	},
	PostgreSQL: {
		name: "PostgreSQL",
		icon: Database,
		colorVar: "--console-blue",
		description: "Relational DB",
	},
};

interface SimulatedMetrics {
	connections: number;
	memoryUsage: number;
	opsPerSec: number;
	uptime: string;
}

// Default metrics shown when we don't have detailed data
function getDefaultMetrics(status: string): SimulatedMetrics {
	const isHealthy = status === "online";
	return {
		connections: isHealthy ? 1 : 0,
		memoryUsage: isHealthy ? 50 : 0,
		opsPerSec: isHealthy ? 100 : 0,
		uptime: isHealthy ? "N/A" : "0%",
	};
}

function StatusIndicator({ status }: { status: string }) {
	switch (status) {
		case "online":
			return (
				<div className="relative flex items-center gap-1.5">
					<div className="relative">
						<CheckCircle2 className="w-4 h-4 text-[rgb(var(--console-green))]" />
						<div className="absolute inset-0 animate-ping opacity-30">
							<CheckCircle2 className="w-4 h-4 text-[rgb(var(--console-green))]" />
						</div>
					</div>
					<span className="text-xs font-mono text-[rgb(var(--console-green))]">ONLINE</span>
				</div>
			);
		case "warning":
			return (
				<div className="flex items-center gap-1.5">
					<AlertCircle className="w-4 h-4 text-[rgb(var(--console-amber))]" />
					<span className="text-xs font-mono text-[rgb(var(--console-amber))]">DEGRADED</span>
				</div>
			);
		default:
			return (
				<div className="flex items-center gap-1.5">
					<XCircle className="w-4 h-4 text-[rgb(var(--console-red))]" />
					<span className="text-xs font-mono text-[rgb(var(--console-red))]">OFFLINE</span>
				</div>
			);
	}
}

interface HealthHistory {
	status: string;
	timestamp: number;
}

function HealthHistoryBar({ history, colorVar }: { history: HealthHistory[]; colorVar: string }) {
	return (
		<div className="flex items-center gap-0.5">
			{history.map((entry, idx) => (
				<div
					key={entry.timestamp}
					className="w-2 h-4 rounded-sm transition-all duration-300"
					style={{
						backgroundColor:
							entry.status === "online"
								? `rgb(var(${colorVar}))`
								: entry.status === "warning"
									? "rgb(var(--console-amber))"
									: "rgb(var(--console-red))",
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
		<div className="panel p-5 hover-lift group relative overflow-hidden">
			{/* Background accent gradient */}
			<div
				className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
				style={{
					background: `radial-gradient(ellipse at top left, rgba(var(${config.colorVar}), 0.08) 0%, transparent 50%)`,
				}}
			/>

			{/* Top border accent */}
			<div
				className="absolute top-0 left-0 right-0 h-0.5"
				style={{
					background: isOnline
						? `linear-gradient(90deg, rgba(var(${config.colorVar}), 0.8), rgba(var(${config.colorVar}), 0.2))`
						: "rgb(var(--console-red))",
				}}
			/>

			{/* Header */}
			<div className="flex items-start justify-between mb-4 relative">
				<div className="flex items-center gap-3">
					<div
						className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
						style={{ background: `rgba(var(${config.colorVar}), 0.1)` }}
					>
						<Icon className="w-5 h-5" style={{ color: `rgb(var(${config.colorVar}))` }} />
					</div>
					<div>
						<div className="font-medium text-[rgb(var(--text-primary))] group-hover:text-[rgb(var(--console-cyan))] transition-colors">
							{config.name}
						</div>
						<div className="text-xs text-[rgb(var(--text-dim))]">{config.description}</div>
					</div>
				</div>
				<StatusIndicator status={health.status} />
			</div>

			{/* Metrics Grid */}
			<div className="grid grid-cols-2 gap-3 mb-4">
				<div className="space-y-0.5">
					<div className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
						Connections
					</div>
					<div className="font-mono text-sm text-[rgb(var(--text-primary))]">
						{metrics.connections}
					</div>
				</div>
				<div className="space-y-0.5">
					<div className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
						Memory
					</div>
					<div className="font-mono text-sm text-[rgb(var(--text-primary))]">
						{metrics.memoryUsage}%
					</div>
				</div>
				<div className="space-y-0.5">
					<div className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
						Ops/sec
					</div>
					<div className="font-mono text-sm text-[rgb(var(--text-primary))]">
						{metrics.opsPerSec.toLocaleString()}
					</div>
				</div>
				<div className="space-y-0.5">
					<div className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
						Uptime
					</div>
					<div className="font-mono text-sm text-[rgb(var(--console-green))]">{metrics.uptime}</div>
				</div>
			</div>

			{/* Footer: Port + Latency + Health History */}
			<div className="flex items-center justify-between pt-3 border-t border-[rgb(var(--console-surface))]">
				<div className="flex items-center gap-3">
					{health.port && (
						<span className="font-mono text-[10px] text-[rgb(var(--text-dim))]">
							:{health.port}
						</span>
					)}
					{health.latency !== undefined && (
						<span
							className={`font-mono text-[10px] ${
								health.latency < 10
									? "text-[rgb(var(--console-green))]"
									: health.latency < 50
										? "text-[rgb(var(--console-amber))]"
										: "text-[rgb(var(--console-red))]"
							}`}
						>
							{health.latency}ms
						</span>
					)}
				</div>
				<HealthHistoryBar history={history} colorVar={config.colorVar} />
			</div>
		</div>
	);
}

function SkeletonCard() {
	return (
		<div className="panel p-5 animate-pulse">
			<div className="flex items-start justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-[rgb(var(--console-surface))]" />
					<div className="space-y-2">
						<div className="h-4 w-20 rounded bg-[rgb(var(--console-surface))]" />
						<div className="h-3 w-16 rounded bg-[rgb(var(--console-surface))]" />
					</div>
				</div>
				<div className="h-4 w-16 rounded bg-[rgb(var(--console-surface))]" />
			</div>
			<div className="grid grid-cols-2 gap-3 mb-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="space-y-1">
						<div className="h-2 w-12 rounded bg-[rgb(var(--console-surface))]" />
						<div className="h-4 w-8 rounded bg-[rgb(var(--console-surface))]" />
					</div>
				))}
			</div>
			<div className="pt-3 border-t border-[rgb(var(--console-surface))]">
				<div className="flex items-center justify-between">
					<div className="h-3 w-16 rounded bg-[rgb(var(--console-surface))]" />
					<div className="flex gap-0.5">
						{Array.from({ length: 5 }).map((_, i) => (
							<div key={i} className="w-2 h-4 rounded-sm bg-[rgb(var(--console-surface))]" />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export interface DatabaseStatusPanelsProps {
	/** Polling interval in milliseconds. Default: 10000 */
	pollInterval?: number;
	/** Show title header */
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

				// Use default metrics for each service (real metrics would come from a dedicated endpoint)
				const newMetrics: Record<string, SimulatedMetrics> = {};
				for (const service of data) {
					newMetrics[service.name] = getDefaultMetrics(service.status);
				}
				setMetricsData(newMetrics);

				// Update health history (keep last 5)
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

	// Initial fetch
	useEffect(() => {
		fetchHealth(true);
	}, [fetchHealth]);

	// Polling
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
						<Title className="!text-[rgb(var(--text-primary))] !font-display">Infrastructure</Title>
					</div>
				)}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<SkeletonCard key={i} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{showHeader && (
				<div className="flex items-center justify-between">
					<Title className="!text-[rgb(var(--text-primary))] !font-display">Infrastructure</Title>
					<Text
						className={`!font-mono !text-xs ${
							onlineCount === healthData.length
								? "!text-[rgb(var(--console-green))]"
								: onlineCount > 0
									? "!text-[rgb(var(--console-amber))]"
									: "!text-[rgb(var(--console-red))]"
						}`}
					>
						{onlineCount}/{healthData.length} Online
					</Text>
				</div>
			)}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
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
