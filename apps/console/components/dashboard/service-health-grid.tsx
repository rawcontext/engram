"use client";

import {
	AlertCircle,
	CheckCircle2,
	Database,
	Gauge,
	HardDrive,
	Layers,
	Radio,
	RefreshCw,
	Search,
	Server,
	Workflow,
	XCircle,
} from "lucide-react";
import { useState } from "react";

import { DataFreshness, StreamingDot } from "@/components/streaming";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePollingData } from "@/hooks/useStreamingData";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";
import { useRegisterStreamingSource } from "@/lib/streaming-context";

const SERVICE_ICONS: Record<string, typeof Server> = {
	API: Server,
	Ingestion: Workflow,
	Search: Search,
	Tuner: Gauge,
	Observatory: Radio,
	FalkorDB: Database,
	Qdrant: Layers,
	NATS: Workflow,
	PostgreSQL: HardDrive,
};

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
					Warning
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

function ServiceCard({
	service,
	onClick,
	isLoading,
}: {
	service: ServiceHealth;
	onClick: () => void;
	isLoading: boolean;
}) {
	const Icon = SERVICE_ICONS[service.name] || Server;
	const isHealthy = service.status === "online";

	return (
		<Card
			className="cursor-pointer transition-all hover:shadow-md hover:border-primary/20"
			onClick={onClick}
		>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<div
						className={`flex h-8 w-8 items-center justify-center rounded-md ${
							isHealthy
								? "bg-green-500/10"
								: service.status === "warning"
									? "bg-amber-500/10"
									: "bg-destructive/10"
						}`}
					>
						<Icon
							className={`h-4 w-4 ${
								isHealthy
									? "text-green-500"
									: service.status === "warning"
										? "text-amber-500"
										: "text-destructive"
							}`}
						/>
					</div>
					<div className="flex items-center gap-2">
						{isLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
						<StatusBadge status={service.status} />
					</div>
				</div>
				<CardTitle className="text-sm">{service.name}</CardTitle>
			</CardHeader>
			<CardContent className="pt-0">
				<div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
					{service.port ? <span>:{service.port}</span> : <span />}
					{service.latency !== undefined ? (
						<span
							className={
								service.latency < 50
									? "text-green-500"
									: service.latency < 200
										? "text-amber-500"
										: "text-destructive"
							}
						>
							{service.latency}ms
						</span>
					) : service.message ? (
						<span className="text-destructive truncate max-w-[80px]">{service.message}</span>
					) : (
						<span>—</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function ServiceCardSkeleton() {
	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<Skeleton className="h-8 w-8 rounded-md" />
					<Skeleton className="h-5 w-16" />
				</div>
				<Skeleton className="h-4 w-20 mt-2" />
			</CardHeader>
			<CardContent className="pt-0">
				<div className="flex items-center justify-between">
					<Skeleton className="h-3 w-10" />
					<Skeleton className="h-3 w-12" />
				</div>
			</CardContent>
		</Card>
	);
}

export interface ServiceHealthGridProps {
	pollInterval?: number;
	onServiceClick?: (service: ServiceHealth) => void;
	showSectionHeaders?: boolean;
}

interface HealthData {
	appServices: ServiceHealth[];
	infraServices: ServiceHealth[];
}

export function ServiceHealthGrid({
	pollInterval = 5000,
	onServiceClick,
	showSectionHeaders = true,
}: ServiceHealthGridProps) {
	const apiClient = useApiClient();
	const [error, setError] = useState<string | null>(null);

	// Use streaming data hook for automatic status tracking
	const { data, status, lastUpdate, refresh } = usePollingData<HealthData>(
		async () => {
			setError(null);
			try {
				const [appServices, infraServices] = await Promise.all([
					apiClient.getAllServicesHealth(),
					apiClient.getInfraHealth(),
				]);
				return { appServices, infraServices };
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to fetch health status");
				throw err;
			}
		},
		{ pollInterval, staleThreshold: 15 },
	);

	// Register this component as a streaming source
	useRegisterStreamingSource("service-health", "Service Health", status, lastUpdate);

	const handleServiceClick = (service: ServiceHealth) => {
		if (onServiceClick) {
			onServiceClick(service);
		}
	};

	const appServices = data?.appServices || [];
	const infraServices = data?.infraServices || [];
	const allServices = [...appServices, ...infraServices];
	const onlineCount = allServices.filter((s) => s.status === "online").length;
	const totalCount = allServices.length;
	const isLoading = !data && status === "connecting";
	const isRefreshing = status === "degraded";

	if (error && isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Service Health</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<XCircle className="h-12 w-12 text-destructive mb-4" />
						<CardDescription className="mb-2">Failed to load service health</CardDescription>
						<p className="text-xs text-muted-foreground mb-4">{error}</p>
						<Button variant="outline" size="sm" onClick={() => refresh()}>
							Retry
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>Service Health</CardTitle>
						<div className="flex items-center gap-2">
							<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
							<span className="text-xs text-muted-foreground font-mono">Loading...</span>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
						{Array.from({ length: 9 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
							<ServiceCardSkeleton key={i} />
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<DataFreshness
			status={status}
			lastUpdate={lastUpdate}
			flashColor="green"
			showStaleOverlay={true}
		>
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<CardTitle>Service Health</CardTitle>
							<StreamingDot status={status} size="sm" />
						</div>
						<div className="flex items-center gap-3">
							{isRefreshing && <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />}
							{lastUpdate && (
								<span className="text-[10px] text-muted-foreground font-mono">
									{lastUpdate.toLocaleTimeString()}
								</span>
							)}
							<Badge
								variant={
									onlineCount === totalCount
										? "default"
										: onlineCount > 0
											? "secondary"
											: "destructive"
								}
								className="font-mono"
							>
								{onlineCount}/{totalCount} Online
							</Badge>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Applications Section */}
					{showSectionHeaders && appServices.length > 0 && (
						<div className="flex items-center gap-2">
							<Server className="h-3.5 w-3.5 text-primary" />
							<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Applications
							</span>
							<div className="flex-1 h-px bg-border" />
						</div>
					)}
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
						{appServices.map((service) => (
							<ServiceCard
								key={service.name}
								service={service}
								onClick={() => handleServiceClick(service)}
								isLoading={isRefreshing}
							/>
						))}
					</div>

					{/* Infrastructure Section */}
					{showSectionHeaders && infraServices.length > 0 && (
						<div className="flex items-center gap-2 mt-4">
							<Database className="h-3.5 w-3.5 text-[rgb(var(--console-purple))]" />
							<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Infrastructure
							</span>
							<div className="flex-1 h-px bg-border" />
						</div>
					)}
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						{infraServices.map((service) => (
							<ServiceCard
								key={service.name}
								service={service}
								onClick={() => handleServiceClick(service)}
								isLoading={isRefreshing}
							/>
						))}
					</div>

					{/* Error banner (non-blocking) */}
					{error && !isLoading && (
						<div className="mt-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
							<AlertCircle className="h-4 w-4" />
							<span className="text-sm">{error}</span>
						</div>
					)}
				</CardContent>
			</Card>
		</DataFreshness>
	);
}
