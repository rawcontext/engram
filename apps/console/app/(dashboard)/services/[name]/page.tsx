"use client";

import { Badge, Title } from "@tremor/react";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Cpu,
	Database,
	Gauge,
	Layers,
	Network,
	Radio,
	Search,
	Server,
	Terminal,
	Workflow,
	XCircle,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";

interface ServiceConfig {
	name: string;
	icon: typeof Server;
	colorVar: string;
	description: string;
	port: number;
	type: "app" | "infra";
	dependencies: string[];
}

const SERVICE_CONFIG: Record<string, ServiceConfig> = {
	api: {
		name: "API",
		icon: Server,
		colorVar: "--console-cyan",
		description: "REST API Gateway",
		port: 6174,
		type: "app",
		dependencies: ["FalkorDB", "Qdrant", "NATS", "PostgreSQL"],
	},
	ingestion: {
		name: "Ingestion",
		icon: Workflow,
		colorVar: "--console-green",
		description: "Event Parsing Pipeline",
		port: 6175,
		type: "app",
		dependencies: ["NATS"],
	},
	search: {
		name: "Search",
		icon: Search,
		colorVar: "--console-purple",
		description: "Vector Search Service",
		port: 6176,
		type: "app",
		dependencies: ["Qdrant"],
	},
	tuner: {
		name: "Tuner",
		icon: Gauge,
		colorVar: "--console-amber",
		description: "Hyperparameter Optimization",
		port: 6177,
		type: "app",
		dependencies: ["PostgreSQL"],
	},
	observatory: {
		name: "Observatory",
		icon: Radio,
		colorVar: "--console-blue",
		description: "Real-time Visualization",
		port: 6178,
		type: "app",
		dependencies: ["API", "NATS"],
	},
	falkordb: {
		name: "FalkorDB",
		icon: Network,
		colorVar: "--console-cyan",
		description: "Graph Database",
		port: 6179,
		type: "infra",
		dependencies: [],
	},
	qdrant: {
		name: "Qdrant",
		icon: Layers,
		colorVar: "--console-purple",
		description: "Vector Database",
		port: 6180,
		type: "infra",
		dependencies: [],
	},
	nats: {
		name: "NATS",
		icon: Radio,
		colorVar: "--console-green",
		description: "Message Queue",
		port: 6181,
		type: "infra",
		dependencies: [],
	},
	postgresql: {
		name: "PostgreSQL",
		icon: Database,
		colorVar: "--console-blue",
		description: "Relational Database",
		port: 6183,
		type: "infra",
		dependencies: [],
	},
};

interface SimulatedMetrics {
	cpu: number;
	memory: number;
	disk: number;
	requestsPerMin: number;
	errorRate: number;
	avgResponseTime: number;
}

interface LogEntry {
	timestamp: Date;
	level: "info" | "warn" | "error" | "debug";
	message: string;
}

function generateMetrics(isOnline: boolean): SimulatedMetrics {
	if (!isOnline) {
		return { cpu: 0, memory: 0, disk: 0, requestsPerMin: 0, errorRate: 0, avgResponseTime: 0 };
	}
	return {
		cpu: Math.floor(Math.random() * 40) + 20,
		memory: Math.floor(Math.random() * 30) + 40,
		disk: Math.floor(Math.random() * 20) + 30,
		requestsPerMin: Math.floor(Math.random() * 500) + 100,
		errorRate: Math.random() * 0.5,
		avgResponseTime: Math.floor(Math.random() * 50) + 10,
	};
}

function generateLogs(serviceName: string): LogEntry[] {
	const messages = [
		{ level: "info" as const, msg: `${serviceName} health check passed` },
		{ level: "info" as const, msg: "Connection pool refreshed" },
		{ level: "debug" as const, msg: "Processing batch of 50 events" },
		{ level: "info" as const, msg: "Metrics exported successfully" },
		{ level: "warn" as const, msg: "Slow query detected (>100ms)" },
		{ level: "info" as const, msg: "Cache invalidation completed" },
		{ level: "debug" as const, msg: "Heartbeat sent to cluster" },
		{ level: "info" as const, msg: "New client connection established" },
	];

	const now = Date.now();
	return messages.slice(0, 6).map((m, i) => ({
		timestamp: new Date(now - i * 5000 - Math.random() * 10000),
		level: m.level,
		message: m.msg,
	}));
}

function StatusBadge({ status }: { status: string }) {
	switch (status) {
		case "online":
			return (
				<Badge color="emerald" size="lg" className="font-mono">
					<span className="flex items-center gap-1.5">
						<span className="relative flex h-2 w-2">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
							<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
						</span>
						ONLINE
					</span>
				</Badge>
			);
		case "warning":
			return (
				<Badge color="amber" size="lg" className="font-mono">
					DEGRADED
				</Badge>
			);
		default:
			return (
				<Badge color="red" size="lg" className="font-mono">
					OFFLINE
				</Badge>
			);
	}
}

function GaugeBar({ value, label, colorVar }: { value: number; label: string; colorVar: string }) {
	const getColor = (val: number) => {
		if (val > 80) return "--console-red";
		if (val > 60) return "--console-amber";
		return colorVar;
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs uppercase tracking-wider text-[rgb(var(--text-dim))]">
					{label}
				</span>
				<span className="font-mono text-sm text-[rgb(var(--text-primary))]">{value}%</span>
			</div>
			<div className="h-2 rounded-full bg-[rgb(var(--console-surface))] overflow-hidden">
				<div
					className="h-full rounded-full transition-all duration-500"
					style={{
						width: `${value}%`,
						background: `linear-gradient(90deg, rgb(var(${getColor(value)})), rgb(var(${colorVar})))`,
					}}
				/>
			</div>
		</div>
	);
}

function LogLine({ entry }: { entry: LogEntry }) {
	const levelColors = {
		info: "text-[rgb(var(--console-cyan))]",
		warn: "text-[rgb(var(--console-amber))]",
		error: "text-[rgb(var(--console-red))]",
		debug: "text-[rgb(var(--text-dim))]",
	};

	return (
		<div className="flex items-start gap-3 py-1.5 font-mono text-xs border-b border-[rgb(var(--console-surface))] last:border-0">
			<span className="text-[rgb(var(--text-dim))] shrink-0 tabular-nums">
				{entry.timestamp.toLocaleTimeString()}
			</span>
			<span className={`shrink-0 uppercase w-12 ${levelColors[entry.level]}`}>{entry.level}</span>
			<span className="text-[rgb(var(--text-secondary))]">{entry.message}</span>
		</div>
	);
}

function DependencyChip({ name, status }: { name: string; status: string }) {
	const config = SERVICE_CONFIG[name.toLowerCase()];
	const Icon = config?.icon || Server;

	return (
		<Link
			href={`/services/${name.toLowerCase()}`}
			className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[rgb(var(--console-surface))] hover:bg-[rgba(var(--console-cyan),0.1)] transition-colors group"
		>
			<Icon className="w-3.5 h-3.5 text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--console-cyan))]" />
			<span className="text-xs font-medium text-[rgb(var(--text-secondary))] group-hover:text-[rgb(var(--text-primary))]">
				{name}
			</span>
			<span
				className={`w-1.5 h-1.5 rounded-full ${
					status === "online" ? "bg-[rgb(var(--console-green))]" : "bg-[rgb(var(--console-red))]"
				}`}
			/>
		</Link>
	);
}

function SkeletonPage() {
	return (
		<div className="space-y-6 animate-pulse">
			<div className="flex items-center gap-4">
				<div className="w-8 h-8 rounded bg-[rgb(var(--console-surface))]" />
				<div className="h-8 w-32 rounded bg-[rgb(var(--console-surface))]" />
			</div>
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="panel p-6 h-48" />
				<div className="panel p-6 h-48" />
				<div className="panel p-6 h-48" />
			</div>
			<div className="panel p-6 h-64" />
		</div>
	);
}

export default function ServiceDetailPage() {
	const params = useParams();
	const serviceName = (params.name as string)?.toLowerCase();
	const config = SERVICE_CONFIG[serviceName];

	const apiClient = useApiClient();
	const [health, setHealth] = useState<ServiceHealth | null>(null);
	const [metrics, setMetrics] = useState<SimulatedMetrics | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [depHealth, setDepHealth] = useState<Record<string, string>>({});
	const [isLoading, setIsLoading] = useState(true);

	const fetchData = useCallback(
		async (isInitial = false) => {
			if (!config) return;

			if (isInitial) setIsLoading(true);

			try {
				// Fetch health based on service type
				let healthData: ServiceHealth | undefined;

				if (config.type === "app") {
					const allHealth = await apiClient.getAllServicesHealth();
					healthData = allHealth.find((h) => h.name.toLowerCase() === serviceName);
				} else {
					const infraHealth = await apiClient.getInfraHealth();
					healthData = infraHealth.find((h) => h.name.toLowerCase() === serviceName);
				}

				if (healthData) {
					setHealth(healthData);
					setMetrics(generateMetrics(healthData.status === "online"));
				}

				// Fetch dependency health
				if (config.dependencies.length > 0) {
					const [apps, infra] = await Promise.all([
						apiClient.getAllServicesHealth(),
						apiClient.getInfraHealth(),
					]);
					const allServices = [...apps, ...infra];
					const depStatuses: Record<string, string> = {};
					for (const dep of config.dependencies) {
						const service = allServices.find((s) => s.name.toLowerCase() === dep.toLowerCase());
						depStatuses[dep] = service?.status || "offline";
					}
					setDepHealth(depStatuses);
				}

				if (isInitial) {
					setLogs(generateLogs(config.name));
				}
			} catch (err) {
				console.error("Failed to fetch service data:", err);
			} finally {
				setIsLoading(false);
			}
		},
		[apiClient, config, serviceName],
	);

	useEffect(() => {
		fetchData(true);
	}, [fetchData]);

	useEffect(() => {
		const interval = setInterval(() => fetchData(false), 5000);
		return () => clearInterval(interval);
	}, [fetchData]);

	if (!config) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] text-center">
				<XCircle className="w-16 h-16 text-[rgb(var(--console-red))] mb-4" />
				<Title className="!text-[rgb(var(--text-primary))] !font-display mb-2">
					Service Not Found
				</Title>
				<p className="text-[rgb(var(--text-muted))] mb-6">
					The service "{params.name}" does not exist.
				</p>
				<Link
					href="/"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[rgb(var(--console-surface))] hover:bg-[rgba(var(--console-cyan),0.1)] transition-colors"
				>
					<ArrowLeft className="w-4 h-4" />
					<span>Back to Dashboard</span>
				</Link>
			</div>
		);
	}

	if (isLoading) {
		return <SkeletonPage />;
	}

	const Icon = config.icon;
	const isOnline = health?.status === "online";

	return (
		<div className="space-y-6 animate-fade-in">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Link
						href="/"
						className="w-10 h-10 rounded-lg bg-[rgb(var(--console-surface))] flex items-center justify-center hover:bg-[rgba(var(--console-cyan),0.1)] transition-colors"
					>
						<ArrowLeft className="w-5 h-5 text-[rgb(var(--text-muted))]" />
					</Link>
					<div
						className="w-12 h-12 rounded-lg flex items-center justify-center"
						style={{ background: `rgba(var(${config.colorVar}), 0.1)` }}
					>
						<Icon className="w-6 h-6" style={{ color: `rgb(var(${config.colorVar}))` }} />
					</div>
					<div>
						<div className="flex items-center gap-3">
							<h1 className="font-display text-2xl text-[rgb(var(--text-primary))]">
								{config.name}
							</h1>
							<StatusBadge status={health?.status || "offline"} />
						</div>
						<p className="text-sm text-[rgb(var(--text-muted))] mt-0.5">
							{config.description} • Port {config.port}
						</p>
					</div>
				</div>
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<div className="panel p-5 hover-lift">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-[rgba(var(--console-cyan),0.1)] flex items-center justify-center">
							<Clock className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
						</div>
						<span className="text-xs uppercase tracking-wider text-[rgb(var(--text-dim))]">
							Latency
						</span>
					</div>
					<div className="metric-value">{health?.latency ?? "—"}ms</div>
				</div>

				<div className="panel p-5 hover-lift">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-[rgba(var(--console-green),0.1)] flex items-center justify-center">
							<Zap className="w-4 h-4 text-[rgb(var(--console-green))]" />
						</div>
						<span className="text-xs uppercase tracking-wider text-[rgb(var(--text-dim))]">
							Requests/min
						</span>
					</div>
					<div className="metric-value">{metrics?.requestsPerMin.toLocaleString() ?? "—"}</div>
				</div>

				<div className="panel p-5 hover-lift">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-[rgba(var(--console-amber),0.1)] flex items-center justify-center">
							<AlertCircle className="w-4 h-4 text-[rgb(var(--console-amber))]" />
						</div>
						<span className="text-xs uppercase tracking-wider text-[rgb(var(--text-dim))]">
							Error Rate
						</span>
					</div>
					<div className="metric-value">{metrics?.errorRate.toFixed(2) ?? "—"}%</div>
				</div>

				<div className="panel p-5 hover-lift">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-[rgba(var(--console-purple),0.1)] flex items-center justify-center">
							<Clock className="w-4 h-4 text-[rgb(var(--console-purple))]" />
						</div>
						<span className="text-xs uppercase tracking-wider text-[rgb(var(--text-dim))]">
							Avg Response
						</span>
					</div>
					<div className="metric-value">{metrics?.avgResponseTime ?? "—"}ms</div>
				</div>
			</div>

			{/* Main Content Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Resource Usage */}
				<div className="panel p-5">
					<div className="flex items-center gap-2 mb-5">
						<Cpu className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
						<Title className="!text-[rgb(var(--text-primary))] !font-display !text-base">
							Resource Usage
						</Title>
					</div>
					<div className="space-y-5">
						<GaugeBar value={metrics?.cpu ?? 0} label="CPU" colorVar={config.colorVar} />
						<GaugeBar value={metrics?.memory ?? 0} label="Memory" colorVar={config.colorVar} />
						<GaugeBar value={metrics?.disk ?? 0} label="Disk" colorVar={config.colorVar} />
					</div>
				</div>

				{/* Dependencies */}
				<div className="panel p-5">
					<div className="flex items-center gap-2 mb-5">
						<Network className="w-4 h-4 text-[rgb(var(--console-purple))]" />
						<Title className="!text-[rgb(var(--text-primary))] !font-display !text-base">
							Dependencies
						</Title>
					</div>
					{config.dependencies.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{config.dependencies.map((dep) => (
								<DependencyChip key={dep} name={dep} status={depHealth[dep] || "offline"} />
							))}
						</div>
					) : (
						<p className="text-sm text-[rgb(var(--text-muted))]">No dependencies</p>
					)}
				</div>

				{/* Health Status */}
				<div className="panel p-5 relative overflow-hidden">
					<div
						className="absolute inset-0 opacity-10"
						style={{
							background: isOnline
								? `radial-gradient(ellipse at center, rgb(var(--console-green)), transparent 70%)`
								: `radial-gradient(ellipse at center, rgb(var(--console-red)), transparent 70%)`,
						}}
					/>
					<div className="relative flex flex-col items-center justify-center h-full py-4">
						{isOnline ? (
							<CheckCircle2 className="w-16 h-16 text-[rgb(var(--console-green))] mb-3" />
						) : (
							<XCircle className="w-16 h-16 text-[rgb(var(--console-red))] mb-3" />
						)}
						<span className="font-display text-xl text-[rgb(var(--text-primary))]">
							{isOnline ? "Healthy" : "Unreachable"}
						</span>
						<span className="text-xs text-[rgb(var(--text-muted))] mt-1">
							Last check: {new Date().toLocaleTimeString()}
						</span>
					</div>
				</div>
			</div>

			{/* Logs */}
			<div className="panel p-5">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<Terminal className="w-4 h-4 text-[rgb(var(--console-green))]" />
						<Title className="!text-[rgb(var(--text-primary))] !font-display !text-base">
							Recent Logs
						</Title>
					</div>
					<Badge color="blue" className="font-mono">
						Live
					</Badge>
				</div>
				<div className="bg-[rgb(var(--console-surface))] rounded-lg p-3">
					{logs.map((entry, idx) => (
						<LogLine key={`${entry.timestamp.getTime()}-${idx}`} entry={entry} />
					))}
				</div>
			</div>
		</div>
	);
}
