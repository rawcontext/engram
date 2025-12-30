"use client";

import {
	AlertTriangle,
	ArrowDown,
	Bug,
	ChevronDown,
	Filter,
	Info,
	Pause,
	Play,
	RefreshCw,
	ScrollText,
	Search,
	Terminal,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
	id: string;
	timestamp: number;
	service: string;
	level: LogLevel;
	message: string;
	metadata?: Record<string, unknown>;
}

interface LogFilters {
	services: string[];
	levels: LogLevel[];
	search: string;
	timeRange: string;
}

// ============================================
// Constants
// ============================================

const SERVICES = ["API", "Ingestion", "Search", "Memory", "Tuner", "Observatory"];
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const TIME_RANGES = [
	{ id: "5m", label: "Last 5 min" },
	{ id: "15m", label: "Last 15 min" },
	{ id: "1h", label: "Last hour" },
	{ id: "6h", label: "Last 6 hours" },
	{ id: "24h", label: "Last 24 hours" },
];

const LEVEL_CONFIG: Record<LogLevel, { color: string; icon: typeof Info; label: string }> = {
	debug: { color: "--violet", icon: Bug, label: "DEBUG" },
	info: { color: "--primary", icon: Info, label: "INFO" },
	warn: { color: "--warning", icon: AlertTriangle, label: "WARN" },
	error: { color: "--destructive", icon: XCircle, label: "ERROR" },
};

// ============================================
// Filter Dropdown Component
// ============================================

function FilterDropdown<T extends string>({
	label,
	options,
	selected,
	onChange,
	renderOption,
}: {
	label: string;
	options: T[];
	selected: T[];
	onChange: (selected: T[]) => void;
	renderOption?: (option: T) => React.ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);

	const toggleOption = (option: T) => {
		if (selected.includes(option)) {
			onChange(selected.filter((s) => s !== option));
		} else {
			onChange([...selected, option]);
		}
	};

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary border border-primary/15 hover:border-primary/30 transition-colors text-sm"
			>
				<Filter className="w-3.5 h-3.5 text-muted-foreground" />
				<span className="text-muted-foreground">{label}</span>
				{selected.length > 0 && (
					<span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-xs font-mono">
						{selected.length}
					</span>
				)}
				<ChevronDown
					className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute left-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-lg bg-card border border-primary/20 shadow-xl shadow-black/30">
						{options.map((option) => (
							<button
								type="button"
								key={option}
								onClick={() => toggleOption(option)}
								className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary transition-colors"
							>
								<div
									className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
										selected.includes(option)
											? "bg-primary border-primary"
											: "border-muted-foreground"
									}`}
								>
									{selected.includes(option) && (
										<svg
											className="w-3 h-3 text-primary-foreground"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={3}
										>
											<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									)}
								</div>
								{renderOption ? renderOption(option) : option}
							</button>
						))}
						{selected.length > 0 && (
							<>
								<div className="h-px bg-primary/10 my-1" />
								<button
									type="button"
									onClick={() => onChange([])}
									className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-destructive transition-colors"
								>
									Clear all
								</button>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Log Entry Component
// ============================================

function LogEntryRow({ entry, isNew }: { entry: LogEntry; isNew?: boolean }) {
	const config = LEVEL_CONFIG[entry.level];
	const Icon = config.icon;
	const timestamp = new Date(entry.timestamp);

	return (
		<div
			className={`group flex items-start gap-3 px-4 py-2 border-b border-primary/5 hover:bg-primary/5 transition-colors ${
				isNew ? "animate-fade-in bg-primary/5" : ""
			}`}
		>
			{/* Timestamp */}
			<div className="flex-shrink-0 w-[140px] font-mono text-xs text-muted-foreground tabular-nums">
				<span className="text-muted-foreground/60">
					{timestamp.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
				</span>{" "}
				{timestamp.toLocaleTimeString("en-US", {
					hour12: false,
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
				})}
				<span className="text-muted-foreground/60">
					.{String(timestamp.getMilliseconds()).padStart(3, "0")}
				</span>
			</div>

			{/* Service Badge */}
			<div className="flex-shrink-0 w-[90px]">
				<span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-secondary text-muted-foreground border border-primary/10">
					{entry.service}
				</span>
			</div>

			{/* Level Badge */}
			<div className="flex-shrink-0 w-[70px]">
				<span
					className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider"
					style={{
						background: `rgba(var(${config.color}), 0.15)`,
						color: `rgb(var(${config.color}))`,
					}}
				>
					<Icon className="w-3 h-3" />
					{config.label}
				</span>
			</div>

			{/* Message */}
			<div className="flex-1 min-w-0">
				<p className="font-mono text-sm text-foreground break-all leading-relaxed">
					{entry.message}
				</p>
				{entry.metadata && Object.keys(entry.metadata).length > 0 && (
					<div className="mt-1 text-xs font-mono text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
						{JSON.stringify(entry.metadata)}
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================
// Main Component
// ============================================

export default function LogsPage() {
	const apiClient = useApiClient();
	const logsContainerRef = useRef<HTMLDivElement>(null);

	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isStreaming, setIsStreaming] = useState(true);
	const [autoScroll, setAutoScroll] = useState(true);
	const [newLogIds, _setNewLogIds] = useState<Set<string>>(new Set());

	const [filters, setFilters] = useState<LogFilters>({
		services: [],
		levels: [],
		search: "",
		timeRange: "1h",
	});

	// Fetch initial logs
	const fetchLogs = useCallback(async () => {
		setIsLoading(true);
		try {
			const data = await apiClient.getLogEntries(filters);
			setLogs(data);
		} catch (err) {
			console.error("Failed to fetch logs:", err);
			// Keep empty state - no mock data
		} finally {
			setIsLoading(false);
		}
	}, [apiClient, filters]);

	// Initial fetch
	useEffect(() => {
		fetchLogs();
	}, [fetchLogs]);

	// Poll for new logs when streaming
	useEffect(() => {
		if (!isStreaming) return;

		const interval = setInterval(() => {
			fetchLogs();
		}, 5000);

		return () => clearInterval(interval);
	}, [isStreaming, fetchLogs]);

	// Auto-scroll to bottom when new logs arrive
	const logsLength = logs.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: logsLength triggers scroll on new logs
	useEffect(() => {
		if (autoScroll && logsContainerRef.current) {
			logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
		}
	}, [logsLength, autoScroll]);

	// Filter logs
	const filteredLogs = logs.filter((log) => {
		if (filters.services.length > 0 && !filters.services.includes(log.service)) {
			return false;
		}
		if (filters.levels.length > 0 && !filters.levels.includes(log.level)) {
			return false;
		}
		if (filters.search && !log.message.toLowerCase().includes(filters.search.toLowerCase())) {
			return false;
		}
		return true;
	});

	// Count by level
	const levelCounts = LOG_LEVELS.reduce(
		(acc, level) => {
			acc[level] = filteredLogs.filter((l) => l.level === level).length;
			return acc;
		},
		{} as Record<LogLevel, number>,
	);

	return (
		<div className="flex flex-col h-[calc(100vh-var(--header-height)-48px)]">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-primary flex items-center justify-center shadow-lg shadow-green-500/20">
						<ScrollText className="w-5 h-5 text-green-50" />
					</div>
					<div>
						<h1 className="font-display text-2xl text-foreground">Logs</h1>
						<p className="text-sm text-muted-foreground">Real-time system event stream</p>
					</div>
				</div>

				{/* Connection Status */}
				<div className="flex items-center gap-4">
					<div
						className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono ${
							isStreaming ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"
						}`}
					>
						<div
							className={`w-2 h-2 rounded-full ${
								isStreaming ? "bg-green-500 animate-pulse" : "bg-amber-500"
							}`}
						/>
						{isStreaming ? "Live" : "Paused"}
					</div>

					<button
						type="button"
						onClick={() => setIsStreaming(!isStreaming)}
						className="p-2 rounded-lg bg-secondary border border-primary/15 hover:border-primary/30 transition-colors"
						title={isStreaming ? "Pause stream" : "Resume stream"}
					>
						{isStreaming ? (
							<Pause className="w-4 h-4 text-muted-foreground" />
						) : (
							<Play className="w-4 h-4 text-green-500" />
						)}
					</button>

					<button
						type="button"
						onClick={fetchLogs}
						className="p-2 rounded-lg bg-secondary border border-primary/15 hover:border-primary/30 transition-colors"
						title="Refresh logs"
					>
						<RefreshCw
							className={`w-4 h-4 text-muted-foreground ${isLoading ? "animate-spin" : ""}`}
						/>
					</button>
				</div>
			</div>

			{/* Filter Bar */}
			<div className="bg-card border border-border rounded-lg p-3 mb-4">
				<div className="flex items-center gap-3 flex-wrap">
					{/* Service Filter */}
					<FilterDropdown
						label="Services"
						options={SERVICES}
						selected={filters.services}
						onChange={(services) => setFilters((prev) => ({ ...prev, services }))}
					/>

					{/* Level Filter */}
					<FilterDropdown
						label="Levels"
						options={LOG_LEVELS}
						selected={filters.levels}
						onChange={(levels) => setFilters((prev) => ({ ...prev, levels }))}
						renderOption={(level) => {
							const config = LEVEL_CONFIG[level];
							return (
								<span
									className="flex items-center gap-1.5"
									style={{ color: `rgb(var(${config.color}))` }}
								>
									<config.icon className="w-3 h-3" />
									{config.label}
								</span>
							);
						}}
					/>

					{/* Time Range */}
					<div className="relative">
						<select
							value={filters.timeRange}
							onChange={(e) =>
								setFilters((prev) => ({
									...prev,
									timeRange: e.target.value,
								}))
							}
							className="appearance-none px-3 py-2 pr-8 rounded-md bg-secondary border border-primary/15 hover:border-primary/30 transition-colors text-sm text-muted-foreground cursor-pointer"
						>
							{TIME_RANGES.map((range) => (
								<option key={range.id} value={range.id}>
									{range.label}
								</option>
							))}
						</select>
						<ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
					</div>

					{/* Search */}
					<div className="flex-1 min-w-[200px] relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
						<input
							type="text"
							value={filters.search}
							onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
							placeholder="Search logs..."
							className="w-full pl-10 pr-8 py-2 rounded-md bg-secondary border border-primary/15 hover:border-primary/30 focus:border-primary focus:outline-none transition-colors text-sm text-foreground placeholder:text-muted-foreground/60"
						/>
						{filters.search && (
							<button
								type="button"
								onClick={() => setFilters((prev) => ({ ...prev, search: "" }))}
								className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-primary/10 transition-colors"
							>
								<X className="w-3 h-3 text-muted-foreground" />
							</button>
						)}
					</div>

					{/* Level Summary */}
					<div className="flex items-center gap-2 ml-auto">
						{LOG_LEVELS.map((level) => {
							const config = LEVEL_CONFIG[level];
							const count = levelCounts[level];
							if (count === 0) return null;
							return (
								<div
									key={level}
									className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono"
									style={{ color: `rgb(var(${config.color}))` }}
								>
									<config.icon className="w-3 h-3" />
									<span>{count}</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{/* Logs Container */}
			<div className="bg-card border border-border rounded-lg flex-1 flex flex-col overflow-hidden">
				{/* Terminal Header */}
				<div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-secondary">
					<Terminal className="w-4 h-4 text-primary" />
					<span className="font-mono text-xs text-muted-foreground">engram.logs</span>
					<span className="font-mono text-xs text-muted-foreground/60">
						— {filteredLogs.length} entries
					</span>
				</div>

				{/* Logs List */}
				<div ref={logsContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
					{isLoading ? (
						<div className="flex items-center justify-center h-full">
							<div className="flex items-center gap-3 text-muted-foreground">
								<RefreshCw className="w-5 h-5 animate-spin" />
								<span className="font-mono text-sm">Loading logs...</span>
							</div>
						</div>
					) : filteredLogs.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
							<ScrollText className="w-12 h-12 opacity-30" />
							<span className="font-mono text-sm">No logs match your filters</span>
						</div>
					) : (
						<div className="divide-y divide-primary/5">
							{filteredLogs.map((entry) => (
								<LogEntryRow key={entry.id} entry={entry} isNew={newLogIds.has(entry.id)} />
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-secondary">
					<div className="flex items-center gap-4">
						<button
							type="button"
							onClick={() => setAutoScroll(!autoScroll)}
							className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono transition-colors ${
								autoScroll
									? "text-primary bg-primary/10"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<ArrowDown className="w-3 h-3" />
							Auto-scroll {autoScroll ? "on" : "off"}
						</button>
					</div>

					<div className="font-mono text-xs text-muted-foreground/60">
						Showing {filteredLogs.length} of {logs.length} entries
					</div>
				</div>
			</div>
		</div>
	);
}
