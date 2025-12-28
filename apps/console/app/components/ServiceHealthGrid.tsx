"use client";

import { Text, Title } from "@tremor/react";
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
import { useCallback, useEffect, useState } from "react";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";

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

function StatusIndicator({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
	const sizeClasses = size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";

	switch (status) {
		case "online":
			return (
				<div className="relative">
					<CheckCircle2 className={`${sizeClasses} text-[rgb(var(--console-green))]`} />
					<div className="absolute inset-0 animate-ping">
						<CheckCircle2
							className={`${sizeClasses} text-[rgb(var(--console-green))] opacity-30`}
						/>
					</div>
				</div>
			);
		case "warning":
			return <AlertCircle className={`${sizeClasses} text-[rgb(var(--console-amber))]`} />;
		case "error":
		case "offline":
			return <XCircle className={`${sizeClasses} text-[rgb(var(--console-red))]`} />;
		default:
			return (
				<div className={`${sizeClasses} rounded-full bg-[rgb(var(--text-muted))] animate-pulse`} />
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
		<button
			type="button"
			onClick={onClick}
			className="panel-elevated p-4 rounded-lg hover-lift cursor-pointer group text-left w-full transition-all duration-200"
		>
			{/* Header row: Icon + Status */}
			<div className="flex items-center justify-between mb-3">
				<div
					className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
						isHealthy
							? "bg-[rgba(var(--console-green),0.1)]"
							: service.status === "warning"
								? "bg-[rgba(var(--console-amber),0.1)]"
								: "bg-[rgba(var(--console-red),0.1)]"
					}`}
				>
					<Icon
						className={`w-4 h-4 transition-colors ${
							isHealthy
								? "text-[rgb(var(--console-green))]"
								: service.status === "warning"
									? "text-[rgb(var(--console-amber))]"
									: "text-[rgb(var(--console-red))]"
						}`}
					/>
				</div>
				<div className="flex items-center gap-2">
					{isLoading && <RefreshCw className="w-3 h-3 text-[rgb(var(--text-dim))] animate-spin" />}
					<StatusIndicator status={service.status} />
				</div>
			</div>

			{/* Service name */}
			<div className="font-medium text-sm text-[rgb(var(--text-primary))] group-hover:text-[rgb(var(--console-cyan))] transition-colors">
				{service.name}
			</div>

			{/* Port + Latency row */}
			<div className="flex items-center justify-between mt-2">
				{service.port ? (
					<span className="font-mono text-[10px] text-[rgb(var(--text-dim))] tabular-nums">
						:{service.port}
					</span>
				) : (
					<span />
				)}
				{service.latency !== undefined ? (
					<span
						className={`font-mono text-[10px] tabular-nums ${
							service.latency < 50
								? "text-[rgb(var(--console-green))]"
								: service.latency < 200
									? "text-[rgb(var(--console-amber))]"
									: "text-[rgb(var(--console-red))]"
						}`}
					>
						{service.latency}ms
					</span>
				) : service.message ? (
					<span className="font-mono text-[10px] text-[rgb(var(--console-red))] truncate max-w-[80px]">
						{service.message}
					</span>
				) : (
					<span className="font-mono text-[10px] text-[rgb(var(--text-dim))]">—</span>
				)}
			</div>
		</button>
	);
}

function SkeletonCard() {
	return (
		<div className="panel-elevated p-4 rounded-lg animate-pulse">
			<div className="flex items-center justify-between mb-3">
				<div className="w-8 h-8 rounded-md bg-[rgb(var(--console-surface))]" />
				<div className="w-3.5 h-3.5 rounded-full bg-[rgb(var(--console-surface))]" />
			</div>
			<div className="h-4 w-16 rounded bg-[rgb(var(--console-surface))] mb-2" />
			<div className="flex items-center justify-between mt-2">
				<div className="h-3 w-8 rounded bg-[rgb(var(--console-surface))]" />
				<div className="h-3 w-10 rounded bg-[rgb(var(--console-surface))]" />
			</div>
		</div>
	);
}

export interface ServiceHealthGridProps {
	/** Polling interval in milliseconds. Default: 5000 */
	pollInterval?: number;
	/** Callback when a service card is clicked */
	onServiceClick?: (service: ServiceHealth) => void;
	/** Show section headers for Apps vs Infrastructure */
	showSectionHeaders?: boolean;
}

export function ServiceHealthGrid({
	pollInterval = 5000,
	onServiceClick,
	showSectionHeaders = true,
}: ServiceHealthGridProps) {
	const apiClient = useApiClient();
	const [appServices, setAppServices] = useState<ServiceHealth[]>([]);
	const [infraServices, setInfraServices] = useState<ServiceHealth[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [error, setError] = useState<string | null>(null);

	const fetchHealth = useCallback(
		async (isInitial = false) => {
			if (isInitial) {
				setIsLoading(true);
			} else {
				setIsRefreshing(true);
			}
			setError(null);

			try {
				const [apps, infra] = await Promise.all([
					apiClient.getAllServicesHealth(),
					apiClient.getInfraHealth(),
				]);

				setAppServices(apps);
				setInfraServices(infra);
				setLastUpdated(new Date());
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to fetch health status");
			} finally {
				setIsLoading(false);
				setIsRefreshing(false);
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

	const handleServiceClick = (service: ServiceHealth) => {
		if (onServiceClick) {
			onServiceClick(service);
		} else {
			console.log("Service clicked:", service);
		}
	};

	const allServices = [...appServices, ...infraServices];
	const onlineCount = allServices.filter((s) => s.status === "online").length;
	const totalCount = allServices.length;

	// Error state
	if (error && isLoading) {
		return (
			<div className="panel p-5">
				<div className="flex items-center justify-between mb-4">
					<Title className="!text-[rgb(var(--text-primary))] !font-display">Service Health</Title>
				</div>
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<XCircle className="w-12 h-12 text-[rgb(var(--console-red))] mb-4" />
					<Text className="!text-[rgb(var(--text-secondary))] mb-2">
						Failed to load service health
					</Text>
					<Text className="!text-[rgb(var(--text-muted))] !text-xs mb-4">{error}</Text>
					<button
						type="button"
						onClick={() => fetchHealth(true)}
						className="px-4 py-2 rounded-md bg-[rgb(var(--console-surface))] text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.1)] transition-colors font-mono text-sm"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// Loading state
	if (isLoading) {
		return (
			<div className="panel p-5">
				<div className="flex items-center justify-between mb-4">
					<Title className="!text-[rgb(var(--text-primary))] !font-display">Service Health</Title>
					<div className="flex items-center gap-2">
						<RefreshCw className="w-4 h-4 text-[rgb(var(--text-muted))] animate-spin" />
						<Text className="!text-[rgb(var(--text-muted))] !font-mono !text-xs">Loading...</Text>
					</div>
				</div>
				<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
					{Array.from({ length: 9 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<SkeletonCard key={i} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="panel p-5">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<Title className="!text-[rgb(var(--text-primary))] !font-display">Service Health</Title>
				<div className="flex items-center gap-3">
					{isRefreshing && (
						<RefreshCw className="w-3.5 h-3.5 text-[rgb(var(--console-cyan))] animate-spin" />
					)}
					{lastUpdated && (
						<Text className="!text-[rgb(var(--text-dim))] !font-mono !text-[10px]">
							{lastUpdated.toLocaleTimeString()}
						</Text>
					)}
					<Text
						className={`!font-mono !text-xs ${
							onlineCount === totalCount
								? "!text-[rgb(var(--console-green))]"
								: onlineCount > 0
									? "!text-[rgb(var(--console-amber))]"
									: "!text-[rgb(var(--console-red))]"
						}`}
					>
						{onlineCount}/{totalCount} Online
					</Text>
				</div>
			</div>

			{/* Applications Section */}
			{showSectionHeaders && appServices.length > 0 && (
				<div className="flex items-center gap-2 mb-3">
					<Server className="w-3.5 h-3.5 text-[rgb(var(--console-cyan))]" />
					<Text className="!text-[rgb(var(--text-muted))] !text-xs !font-medium uppercase tracking-wider">
						Applications
					</Text>
					<div className="flex-1 h-px bg-[rgb(var(--console-surface))]" />
				</div>
			)}
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 stagger">
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
				<div className="flex items-center gap-2 mb-3 mt-5">
					<Database className="w-3.5 h-3.5 text-[rgb(var(--console-purple))]" />
					<Text className="!text-[rgb(var(--text-muted))] !text-xs !font-medium uppercase tracking-wider">
						Infrastructure
					</Text>
					<div className="flex-1 h-px bg-[rgb(var(--console-surface))]" />
				</div>
			)}
			<div
				className={`grid grid-cols-2 md:grid-cols-4 gap-3 stagger ${showSectionHeaders ? "" : "mt-3"}`}
			>
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
				<div className="mt-4 p-3 rounded-md bg-[rgba(var(--console-red),0.1)] border border-[rgba(var(--console-red),0.2)]">
					<div className="flex items-center gap-2">
						<AlertCircle className="w-4 h-4 text-[rgb(var(--console-red))]" />
						<Text className="!text-[rgb(var(--console-red))] !text-sm">{error}</Text>
					</div>
				</div>
			)}
		</div>
	);
}
