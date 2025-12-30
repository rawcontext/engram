"use client";

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

import { Badge } from "@/components/ui/badge";
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
		colorVar: "--primary",
		description: "REST API Gateway",
		port: 6174,
		type: "app",
		dependencies: ["FalkorDB", "Qdrant", "NATS", "PostgreSQL"],
	},
	ingestion: {
		name: "Ingestion",
		icon: Workflow,
		colorVar: "--success",
		description: "Event Parsing Pipeline",
		port: 6175,
		type: "app",
		dependencies: ["NATS"],
	},
	search: {
		name: "Search",
		icon: Search,
		colorVar: "--violet",
		description: "Vector Search Service",
		port: 6176,
		type: "app",
		dependencies: ["Qdrant"],
	},
	tuner: {
		name: "Tuner",
		icon: Gauge,
		colorVar: "--warning",
		description: "Hyperparameter Optimization",
		port: 6177,
		type: "app",
		dependencies: ["PostgreSQL"],
	},
	observatory: {
		name: "Observatory",
		icon: Radio,
		colorVar: "--primary",
		description: "Real-time Visualization",
		port: 6178,
		type: "app",
		dependencies: ["API", "NATS"],
	},
	falkordb: {
		name: "FalkorDB",
		icon: Network,
		colorVar: "--primary",
		description: "Graph Database",
		port: 6179,
		type: "infra",
		dependencies: [],
	},
	qdrant: {
		name: "Qdrant",
		icon: Layers,
		colorVar: "--violet",
		description: "Vector Database",
		port: 6180,
		type: "infra",
		dependencies: [],
	},
	nats: {
		name: "NATS",
		icon: Radio,
		colorVar: "--success",
		description: "Message Queue",
		port: 6181,
		type: "infra",
		dependencies: [],
	},
	postgresql: {
		name: "PostgreSQL",
		icon: Database,
		colorVar: "--primary",
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
				<Badge
					variant="default"
					className="bg-green-500/10 text-green-500 hover:bg-green-500/20 font-mono"
				>
					<span className="relative flex h-2 w-2 mr-1.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
						<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
					</span>
					ONLINE
				</Badge>
			);
		case "warning":
			return (
				<Badge
					variant="secondary"
					className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 font-mono"
				>
					DEGRADED
				</Badge>
			);
		default:
			return (
				<Badge variant="destructive" className="font-mono">
					OFFLINE
				</Badge>
			);
	}
}

function GaugeBar({ value, label, colorVar }: { value: number; label: string; colorVar: string }) {
	const getColor = (val: number) => {
		if (val > 80) return "--destructive";
		if (val > 60) return "--warning";
		return colorVar;
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
				<span className="font-mono text-sm text-foreground">{value}%</span>
			</div>
			<div className="h-2 rounded-full bg-secondary overflow-hidden">
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
		info: "text-primary",
		warn: "text-amber-500",
		error: "text-destructive",
		debug: "text-muted-foreground",
	};

	return (
		<div className="flex items-start gap-3 py-1.5 font-mono text-xs border-b border-secondary last:border-0">
			<span className="text-muted-foreground shrink-0 tabular-nums">
				{entry.timestamp.toLocaleTimeString()}
			</span>
			<span className={`shrink-0 uppercase w-12 ${levelColors[entry.level]}`}>{entry.level}</span>
			<span className="text-secondary-foreground">{entry.message}</span>
		</div>
	);
}

function DependencyChip({ name, status }: { name: string; status: string }) {
	const config = SERVICE_CONFIG[name.toLowerCase()];
	const Icon = config?.icon || Server;

	return (
		<Link
			href={`/services/${name.toLowerCase()}`}
			className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary hover:bg-primary/10 transition-colors group"
		>
			<Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
			<span className="text-xs font-medium text-secondary-foreground group-hover:text-foreground">
				{name}
			</span>
			<span
				className={`w-1.5 h-1.5 rounded-full ${
					status === "online" ? "bg-green-500" : "bg-destructive"
				}`}
			/>
		</Link>
	);
}

function SkeletonPage() {
	return (
		<div className="space-y-6 animate-pulse">
			<div className="flex items-center gap-4">
				<div className="w-8 h-8 rounded bg-secondary" />
				<div className="h-8 w-32 rounded bg-secondary" />
			</div>
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="bg-card border border-border rounded-lg p-6 h-48" />
				<div className="bg-card border border-border rounded-lg p-6 h-48" />
				<div className="bg-card border border-border rounded-lg p-6 h-48" />
			</div>
			<div className="bg-card border border-border rounded-lg p-6 h-64" />
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
				<XCircle className="w-16 h-16 text-destructive mb-4" />
				<h2 className="text-foreground font-display text-xl mb-2">Service Not Found</h2>
				<p className="text-muted-foreground mb-6">The service "{params.name}" does not exist.</p>
				<Link
					href="/"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary hover:bg-primary/10 transition-colors"
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
						className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center hover:bg-primary/10 transition-colors"
					>
						<ArrowLeft className="w-5 h-5 text-muted-foreground" />
					</Link>
					<div
						className="w-12 h-12 rounded-lg flex items-center justify-center"
						style={{ background: `color-mix(in oklch, var(${config.colorVar}) 10%, transparent)` }}
					>
						<Icon className="w-6 h-6" style={{ color: `rgb(var(${config.colorVar}))` }} />
					</div>
					<div>
						<div className="flex items-center gap-3">
							<h1 className="font-display text-2xl text-foreground">{config.name}</h1>
							<StatusBadge status={health?.status || "offline"} />
						</div>
						<p className="text-sm text-muted-foreground mt-0.5">
							{config.description} • Port {config.port}
						</p>
					</div>
				</div>
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<div className="bg-card border border-border rounded-lg p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
							<Clock className="w-4 h-4 text-primary" />
						</div>
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
							Latency
						</span>
					</div>
					<div className="font-mono text-2xl font-semibold">{health?.latency ?? "—"}ms</div>
				</div>

				<div className="bg-card border border-border rounded-lg p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center">
							<Zap className="w-4 h-4 text-green-500" />
						</div>
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
							Requests/min
						</span>
					</div>
					<div className="font-mono text-2xl font-semibold">
						{metrics?.requestsPerMin.toLocaleString() ?? "—"}
					</div>
				</div>

				<div className="bg-card border border-border rounded-lg p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-amber-500/10 flex items-center justify-center">
							<AlertCircle className="w-4 h-4 text-amber-500" />
						</div>
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
							Error Rate
						</span>
					</div>
					<div className="font-mono text-2xl font-semibold">
						{metrics?.errorRate.toFixed(2) ?? "—"}%
					</div>
				</div>

				<div className="bg-card border border-border rounded-lg p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all">
					<div className="flex items-center gap-3 mb-3">
						<div className="w-8 h-8 rounded-md bg-purple-500/10 flex items-center justify-center">
							<Clock className="w-4 h-4 text-purple-500" />
						</div>
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
							Avg Response
						</span>
					</div>
					<div className="font-mono text-2xl font-semibold">
						{metrics?.avgResponseTime ?? "—"}ms
					</div>
				</div>
			</div>

			{/* Main Content Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Resource Usage */}
				<div className="bg-card border border-border rounded-lg p-5">
					<div className="flex items-center gap-2 mb-5">
						<Cpu className="w-4 h-4 text-primary" />
						<h3 className="text-foreground font-display text-base">Resource Usage</h3>
					</div>
					<div className="space-y-5">
						<GaugeBar value={metrics?.cpu ?? 0} label="CPU" colorVar={config.colorVar} />
						<GaugeBar value={metrics?.memory ?? 0} label="Memory" colorVar={config.colorVar} />
						<GaugeBar value={metrics?.disk ?? 0} label="Disk" colorVar={config.colorVar} />
					</div>
				</div>

				{/* Dependencies */}
				<div className="bg-card border border-border rounded-lg p-5">
					<div className="flex items-center gap-2 mb-5">
						<Network className="w-4 h-4 text-purple-500" />
						<h3 className="text-foreground font-display text-base">Dependencies</h3>
					</div>
					{config.dependencies.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{config.dependencies.map((dep) => (
								<DependencyChip key={dep} name={dep} status={depHealth[dep] || "offline"} />
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No dependencies</p>
					)}
				</div>

				{/* Health Status */}
				<div className="bg-card border border-border rounded-lg p-5 relative overflow-hidden">
					<div
						className="absolute inset-0 opacity-10"
						style={{
							background: isOnline
								? `radial-gradient(ellipse at center, rgb(var(--success)), transparent 70%)`
								: `radial-gradient(ellipse at center, rgb(var(--destructive)), transparent 70%)`,
						}}
					/>
					<div className="relative flex flex-col items-center justify-center h-full py-4">
						{isOnline ? (
							<CheckCircle2 className="w-16 h-16 text-green-500 mb-3" />
						) : (
							<XCircle className="w-16 h-16 text-destructive mb-3" />
						)}
						<span className="font-display text-xl text-foreground">
							{isOnline ? "Healthy" : "Unreachable"}
						</span>
						<span className="text-xs text-muted-foreground mt-1">
							Last check: {new Date().toLocaleTimeString()}
						</span>
					</div>
				</div>
			</div>

			{/* Logs */}
			<div className="bg-card border border-border rounded-lg p-5">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<Terminal className="w-4 h-4 text-green-500" />
						<h3 className="text-foreground font-display text-base">Recent Logs</h3>
					</div>
					<Badge
						variant="default"
						className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 font-mono"
					>
						Live
					</Badge>
				</div>
				<div className="bg-secondary rounded-lg p-3">
					{logs.map((entry, idx) => (
						<LogLine key={`${entry.timestamp.getTime()}-${idx}`} entry={entry} />
					))}
				</div>
			</div>
		</div>
	);
}
