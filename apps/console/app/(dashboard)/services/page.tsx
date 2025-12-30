"use client";

import {
	ArrowRight,
	CheckCircle2,
	Database,
	Gauge,
	Layers,
	Network,
	Radio,
	RefreshCw,
	Search,
	Server,
	Workflow,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

function ServiceCard({
	config,
	health,
	isLoading,
}: {
	config: ServiceConfig;
	health?: ServiceHealth;
	isLoading: boolean;
}) {
	const Icon = config.icon;
	const status = health?.status || "offline";

	return (
		<Link href={`/services/${config.name.toLowerCase()}`}>
			<Card className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5">
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div
							className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
							style={{
								background: `color-mix(in oklch, var(${config.colorVar}) 10%, transparent)`,
							}}
						>
							<Icon className="w-5 h-5" style={{ color: `rgb(var(${config.colorVar}))` }} />
						</div>
						<div className="flex items-center gap-2">
							{isLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
							<StatusBadge status={status} />
						</div>
					</div>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="flex items-start justify-between">
						<div>
							<CardTitle className="text-base mb-1">{config.name}</CardTitle>
							<p className="text-xs text-muted-foreground">{config.description}</p>
						</div>
						<ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
					</div>
					<div className="mt-4 flex items-center justify-between text-xs font-mono">
						<span className="text-muted-foreground">:{config.port}</span>
						{health?.latency !== undefined ? (
							<span
								className={
									health.latency < 50
										? "text-green-500"
										: health.latency < 200
											? "text-amber-500"
											: "text-destructive"
								}
							>
								{health.latency}ms
							</span>
						) : (
							<span className="text-muted-foreground">—</span>
						)}
					</div>
					{config.dependencies.length > 0 && (
						<div className="mt-3 pt-3 border-t">
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground">
								Depends on
							</span>
							<div className="flex flex-wrap gap-1 mt-1">
								{config.dependencies.map((dep) => (
									<span
										key={dep}
										className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
									>
										{dep}
									</span>
								))}
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</Link>
	);
}

function ServiceCardSkeleton() {
	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<Skeleton className="h-10 w-10 rounded-lg" />
					<Skeleton className="h-5 w-16" />
				</div>
			</CardHeader>
			<CardContent className="pt-0">
				<Skeleton className="h-5 w-24 mb-1" />
				<Skeleton className="h-3 w-32" />
				<div className="mt-4 flex items-center justify-between">
					<Skeleton className="h-3 w-12" />
					<Skeleton className="h-3 w-10" />
				</div>
			</CardContent>
		</Card>
	);
}

export default function ServicesPage() {
	const apiClient = useApiClient();
	const [healthMap, setHealthMap] = useState<Record<string, ServiceHealth>>({});
	const [isLoading, setIsLoading] = useState(true);
	const [mounted, setMounted] = useState(false);

	const fetchHealth = useCallback(
		async (initial = false) => {
			if (initial) setIsLoading(true);
			try {
				const [apps, infra] = await Promise.all([
					apiClient.getAllServicesHealth(),
					apiClient.getInfraHealth(),
				]);
				const map: Record<string, ServiceHealth> = {};
				for (const s of [...apps, ...infra]) {
					map[s.name.toLowerCase()] = s;
				}
				setHealthMap(map);
			} catch (err) {
				console.error("Failed to fetch service health:", err);
			} finally {
				setIsLoading(false);
			}
		},
		[apiClient],
	);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (mounted) {
			fetchHealth(true);
		}
	}, [mounted, fetchHealth]);

	useEffect(() => {
		if (!mounted) return;
		const interval = setInterval(() => fetchHealth(false), 5000);
		return () => clearInterval(interval);
	}, [mounted, fetchHealth]);

	if (!mounted) {
		return null;
	}

	const appServices = Object.values(SERVICE_CONFIG).filter((s) => s.type === "app");
	const infraServices = Object.values(SERVICE_CONFIG).filter((s) => s.type === "infra");
	const allServices = Object.values(SERVICE_CONFIG);
	const onlineCount = allServices.filter(
		(s) => healthMap[s.name.toLowerCase()]?.status === "online",
	).length;

	return (
		<div className="space-y-6 animate-fade-in">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Services</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Monitor and manage all Engram services
					</p>
				</div>
				<div className="flex items-center gap-3">
					{isLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
					<Badge
						variant={onlineCount === allServices.length ? "default" : "secondary"}
						className={`font-mono ${
							onlineCount === allServices.length
								? "bg-green-500/10 text-green-500"
								: onlineCount > 0
									? "bg-amber-500/10 text-amber-500"
									: "bg-destructive/10 text-destructive"
						}`}
					>
						{onlineCount === allServices.length ? (
							<>
								<CheckCircle2 className="h-3 w-3 mr-1" />
								All Services Online
							</>
						) : (
							<>
								<XCircle className="h-3 w-3 mr-1" />
								{onlineCount}/{allServices.length} Online
							</>
						)}
					</Badge>
				</div>
			</div>

			{/* Applications Section */}
			<div>
				<div className="flex items-center gap-2 mb-4">
					<Server className="h-4 w-4 text-primary" />
					<span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
						Applications
					</span>
					<div className="flex-1 h-px bg-border" />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{isLoading && !Object.keys(healthMap).length
						? appServices.map((s) => <ServiceCardSkeleton key={s.name} />)
						: appServices.map((config) => (
								<ServiceCard
									key={config.name}
									config={config}
									health={healthMap[config.name.toLowerCase()]}
									isLoading={isLoading}
								/>
							))}
				</div>
			</div>

			{/* Infrastructure Section */}
			<div>
				<div className="flex items-center gap-2 mb-4">
					<Database className="h-4 w-4 text-purple-500" />
					<span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
						Infrastructure
					</span>
					<div className="flex-1 h-px bg-border" />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					{isLoading && !Object.keys(healthMap).length
						? infraServices.map((s) => <ServiceCardSkeleton key={s.name} />)
						: infraServices.map((config) => (
								<ServiceCard
									key={config.name}
									config={config}
									health={healthMap[config.name.toLowerCase()]}
									isLoading={isLoading}
								/>
							))}
				</div>
			</div>
		</div>
	);
}
