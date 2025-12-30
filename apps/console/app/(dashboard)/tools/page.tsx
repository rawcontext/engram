// biome-ignore-all lint/a11y/noLabelWithoutControl: using custom Select components
"use client";

import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	Clock,
	Database,
	Loader2,
	Play,
	RefreshCw,
	Search,
	Server,
	Sparkles,
	Trash2,
	Wrench,
	XCircle,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

interface QueryResult {
	results: Array<Record<string, unknown>>;
	executionTime: number;
	nodeCount: number;
	relationshipCount: number;
}

interface SearchResult {
	results: Array<{
		id: string;
		content: string;
		score: number;
		type?: string;
		metadata?: Record<string, unknown>;
	}>;
	latency: number;
	strategy: string;
}

interface CacheAction {
	type: "embedding" | "query" | "consumer";
	lastExecuted?: number;
	isLoading: boolean;
	result?: { success: boolean; message: string };
}

interface Stream {
	name: string;
	messages: number;
	consumers: number;
}

// ============================================
// Example Queries
// ============================================

const EXAMPLE_QUERIES = [
	{
		name: "Recent Memories",
		query: `MATCH (m:Memory)
WHERE m.vt_end > $now
RETURN m.content, m.type, m.vt_start
ORDER BY m.vt_start DESC
LIMIT 10`,
	},
	{
		name: "Session Graph",
		query: `MATCH (s:Session)-[:HAS_TURN]->(t:Turn)
RETURN s.id, count(t) as turns
ORDER BY turns DESC
LIMIT 5`,
	},
	{
		name: "Node Count",
		query: `MATCH (n)
RETURN labels(n)[0] as label, count(n) as count
ORDER BY count DESC`,
	},
	{
		name: "File Activity",
		query: `MATCH (f:FileTouch)
RETURN f.file_path, f.action, count(*) as touches
ORDER BY touches DESC
LIMIT 10`,
	},
];

// ============================================
// Syntax Highlighting (simple approach)
// ============================================

function highlightCypher(code: string): string {
	const keywords =
		/\b(MATCH|WHERE|RETURN|ORDER BY|LIMIT|CREATE|DELETE|SET|WITH|AS|AND|OR|NOT|IN|DESC|ASC|COUNT|DISTINCT|OPTIONAL|MERGE|UNWIND|CASE|WHEN|THEN|ELSE|END)\b/gi;
	const functions =
		/\b(count|sum|avg|min|max|collect|labels|type|id|properties|keys|nodes|relationships)\b/gi;
	const variables = /(\$\w+)/g;
	const strings = /("[^"]*"|'[^']*')/g;
	const numbers = /\b(\d+(?:\.\d+)?)\b/g;

	return code
		.replace(strings, '<span class="text-green-500">$1</span>')
		.replace(keywords, '<span class="text-purple-500 font-semibold">$1</span>')
		.replace(functions, '<span class="text-primary">$1</span>')
		.replace(variables, '<span class="text-amber-500">$1</span>')
		.replace(numbers, '<span class="text-amber-500">$1</span>');
}

// ============================================
// Custom Dropdown Component
// ============================================

function Dropdown<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: { value: T; label: string; description?: string }[];
	onChange: (value: T) => void;
	label: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const selected = options.find((o) => o.value === value);

	return (
		<div className="relative">
			<label className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-2">
				{label}
			</label>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 hover:border-primary/30 transition-colors font-mono text-sm text-foreground"
			>
				<span>{selected?.label}</span>
				<ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute left-0 right-0 top-full mt-2 z-20 py-1 rounded-lg bg-card border border-primary/20 shadow-xl shadow-black/30">
						{options.map((option) => (
							<button
								type="button"
								key={option.value}
								onClick={() => {
									onChange(option.value);
									setIsOpen(false);
								}}
								className={`w-full px-4 py-2.5 text-left transition-colors ${
									option.value === value
										? "text-primary bg-primary/10"
										: "text-secondary-foreground hover:text-foreground hover:bg-secondary"
								}`}
							>
								<div className="font-mono text-sm">{option.label}</div>
								{option.description && (
									<div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
								)}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Confirmation Dialog
// ============================================

function ConfirmDialog({
	isOpen,
	title,
	message,
	confirmLabel,
	onConfirm,
	onCancel,
	variant = "danger",
}: {
	isOpen: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	variant?: "danger" | "warning";
}) {
	if (!isOpen) return null;

	const variantColor = variant === "danger" ? "--destructive" : "--warning";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop */}
			<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
			<div className="relative bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 animate-in fade-in">
				<div
					className="w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto"
					style={{ background: `color-mix(in oklch, var(${variantColor}) 15%, transparent)` }}
				>
					<AlertTriangle className="w-6 h-6" style={{ color: `var(${variantColor})` }} />
				</div>
				<h3 className="font-display text-lg text-foreground text-center mb-2">{title}</h3>
				<p className="text-sm text-secondary-foreground text-center mb-6">{message}</p>
				<div className="flex gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="flex-1 px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 text-secondary-foreground hover:text-foreground hover:border-primary/30 transition-colors font-mono text-sm"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="flex-1 px-4 py-2.5 rounded-lg font-mono text-sm font-medium transition-all"
						style={{
							background: `var(${variantColor})`,
							color: "var(--background)",
						}}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

// ============================================
// Graph Query Executor Panel
// ============================================

function GraphQueryPanel() {
	const apiClient = useApiClient();
	const [query, setQuery] = useState(EXAMPLE_QUERIES[0].query);
	const [isExecuting, setIsExecuting] = useState(false);
	const [result, setResult] = useState<QueryResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const highlightRef = useRef<HTMLDivElement>(null);

	// Sync scroll between textarea and highlight overlay
	const handleScroll = () => {
		if (textareaRef.current && highlightRef.current) {
			highlightRef.current.scrollTop = textareaRef.current.scrollTop;
			highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
		}
	};

	const executeQuery = useCallback(async () => {
		setIsExecuting(true);
		setError(null);

		try {
			const data = await apiClient.executeGraphQuery(query, { now: Date.now() });
			setResult(data);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Query execution failed";
			setError(message);
		} finally {
			setIsExecuting(false);
		}
	}, [apiClient, query]);

	return (
		<div className="bg-card border border-border rounded-lg p-6 flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
						<Database className="w-5 h-5 text-purple-500" />
					</div>
					<div>
						<h3 className="font-display text-base text-foreground">Graph Query Executor</h3>
						<p className="text-xs text-muted-foreground font-mono">
							Execute Cypher queries on FalkorDB
						</p>
					</div>
				</div>
			</div>

			{/* Example Query Buttons */}
			<div className="flex flex-wrap gap-2 mb-4">
				{EXAMPLE_QUERIES.map((example) => (
					<button
						type="button"
						key={example.name}
						onClick={() => setQuery(example.query)}
						className="px-3 py-1.5 rounded-full text-xs font-mono bg-secondary text-secondary-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-transparent hover:border-primary/20"
					>
						{example.name}
					</button>
				))}
			</div>

			{/* Query Editor */}
			<div className="relative flex-shrink-0 mb-4">
				<div className="absolute top-3 left-3 flex items-center gap-2 text-xs font-mono text-muted-foreground z-10">
					<span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-500">CYPHER</span>
				</div>
				<div className="relative rounded-lg bg-secondary border border-primary/10 overflow-hidden">
					{/* Syntax highlight overlay */}
					<div
						ref={highlightRef}
						className="absolute inset-0 pt-10 px-4 pb-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: syntax highlighting
						dangerouslySetInnerHTML={{ __html: highlightCypher(query) }}
					/>
					{/* Actual textarea */}
					<textarea
						ref={textareaRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onScroll={handleScroll}
						className="w-full h-48 pt-10 px-4 pb-4 bg-transparent font-mono text-sm leading-relaxed resize-none focus:outline-none text-transparent caret-primary"
						spellCheck={false}
					/>
				</div>
			</div>

			{/* Execute Button */}
			<button
				type="button"
				onClick={executeQuery}
				disabled={isExecuting || !query.trim()}
				className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-500 to-primary text-background font-mono text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-500/30 transition-all mb-4"
			>
				{isExecuting ? (
					<>
						<Loader2 className="w-4 h-4 animate-spin" />
						Executing...
					</>
				) : (
					<>
						<Play className="w-4 h-4" />
						Execute Query
					</>
				)}
			</button>

			{/* Error Display */}
			{error && (
				<div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 mb-4">
					<XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
					<div className="text-sm text-destructive font-mono">{error}</div>
				</div>
			)}

			{/* Results */}
			{result && (
				<div className="flex-1 min-h-0 flex flex-col">
					{/* Stats bar */}
					<div className="flex items-center gap-4 mb-3 text-xs font-mono text-muted-foreground">
						<div className="flex items-center gap-1.5">
							<Clock className="w-3.5 h-3.5 text-green-500" />
							<span>{result.executionTime.toFixed(1)}ms</span>
						</div>
						<div className="flex items-center gap-1.5">
							<Database className="w-3.5 h-3.5 text-primary" />
							<span>{result.results.length} rows</span>
						</div>
					</div>

					{/* Results table */}
					<div className="flex-1 overflow-auto rounded-lg bg-secondary border border-primary/10">
						{result.results.length > 0 && (
							<table className="w-full text-sm font-mono">
								<thead>
									<tr className="border-b border-primary/10">
										{Object.keys(result.results[0]).map((key) => (
											<th
												key={key}
												className="px-4 py-3 text-left text-xs font-semibold text-primary uppercase tracking-wider"
											>
												{key}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{result.results.map((row, i) => (
										<tr
											key={`row-${Object.values(row).join("-")}-${i}`}
											className="border-b border-primary/5 hover:bg-primary/[0.03]"
										>
											{Object.values(row).map((value, j) => (
												<td
													key={`cell-${Object.keys(row)[j]}`}
													className="px-4 py-3 text-secondary-foreground"
												>
													{typeof value === "object" ? JSON.stringify(value) : String(value)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================
// Vector Search Tester Panel
// ============================================

const STRATEGIES = [
	{ value: "hybrid" as const, label: "Hybrid", description: "RRF fusion of dense + sparse" },
	{ value: "dense" as const, label: "Dense", description: "Vector similarity search" },
	{ value: "sparse" as const, label: "Sparse", description: "BM25 keyword matching" },
];

const RERANKERS = [
	{ value: "fast" as const, label: "Fast", description: "FlashRank ~10ms" },
	{ value: "accurate" as const, label: "Accurate", description: "BGE cross-encoder ~50ms" },
	{ value: "code" as const, label: "Code", description: "Jina code-optimized ~50ms" },
	{ value: "llm" as const, label: "LLM", description: "Gemini Flash ~500ms" },
];

function VectorSearchPanel() {
	const apiClient = useApiClient();
	const [searchQuery, setSearchQuery] = useState("");
	const [strategy, setStrategy] = useState<"dense" | "sparse" | "hybrid">("hybrid");
	const [reranker, setReranker] = useState<"fast" | "accurate" | "code" | "llm">("fast");
	const [limit, setLimit] = useState(10);
	const [isSearching, setIsSearching] = useState(false);
	const [result, setResult] = useState<SearchResult | null>(null);
	const [elapsedTime, setElapsedTime] = useState(0);
	const timerRef = useRef<NodeJS.Timeout | null>(null);

	const executeSearch = useCallback(async () => {
		if (!searchQuery.trim()) return;

		setIsSearching(true);
		setElapsedTime(0);
		setResult(null);

		// Start timer
		const startTime = Date.now();
		timerRef.current = setInterval(() => {
			setElapsedTime(Date.now() - startTime);
		}, 10);

		try {
			const data = await apiClient.vectorSearch(searchQuery, {
				strategy,
				rerank: true,
				rerank_tier: reranker,
				limit,
			});
			setResult(data);
		} catch (err) {
			console.error("Vector search failed:", err);
			// Keep empty result - no mock data
		} finally {
			if (timerRef.current) {
				clearInterval(timerRef.current);
			}
			setIsSearching(false);
		}
	}, [apiClient, searchQuery, strategy, reranker, limit]);

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current);
			}
		};
	}, []);

	const getScoreColor = (score: number) => {
		if (score >= 0.9) return "--success";
		if (score >= 0.7) return "--primary";
		if (score >= 0.5) return "--warning";
		return "--destructive";
	};

	const getTypeColor = (type?: string) => {
		switch (type) {
			case "preference":
				return "--violet";
			case "decision":
				return "--primary";
			case "insight":
				return "--warning";
			case "fact":
				return "--success";
			default:
				return "--muted-foreground";
		}
	};

	return (
		<div className="bg-card border border-border rounded-lg p-6 flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
						<Search className="w-5 h-5 text-primary" />
					</div>
					<div>
						<h3 className="font-display text-base text-foreground">Vector Search Tester</h3>
						<p className="text-xs text-muted-foreground font-mono">
							Test hybrid retrieval & reranking
						</p>
					</div>
				</div>
				{/* Live timer */}
				{(isSearching || elapsedTime > 0) && (
					<div
						className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-xs ${
							isSearching ? "bg-primary/10 text-primary" : "bg-green-500/10 text-green-500"
						}`}
					>
						<Zap className="w-3.5 h-3.5" />
						{elapsedTime.toFixed(0)}ms
					</div>
				)}
			</div>

			{/* Search Input */}
			<div className="relative mb-4">
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && executeSearch()}
					placeholder="Enter search query..."
					className="w-full px-4 py-3 pl-11 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground transition-colors"
				/>
				<Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
			</div>

			{/* Options Grid */}
			<div className="grid grid-cols-2 gap-4 mb-4">
				<Dropdown value={strategy} options={STRATEGIES} onChange={setStrategy} label="Strategy" />
				<Dropdown value={reranker} options={RERANKERS} onChange={setReranker} label="Reranker" />
			</div>

			{/* Limit Slider */}
			<div className="mb-4">
				<div className="flex items-center justify-between mb-2">
					<label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
						Result Limit
					</label>
					<span className="font-mono text-sm text-primary">{limit}</span>
				</div>
				<input
					type="range"
					min={5}
					max={50}
					step={5}
					value={limit}
					onChange={(e) => setLimit(Number(e.target.value))}
					className="w-full h-2 rounded-full appearance-none bg-secondary cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-primary/30"
				/>
				<div className="flex justify-between text-xs font-mono text-muted-foreground mt-1">
					<span>5</span>
					<span>50</span>
				</div>
			</div>

			{/* Execute Button */}
			<button
				type="button"
				onClick={executeSearch}
				disabled={isSearching || !searchQuery.trim()}
				className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-primary to-primary text-background font-mono text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-primary/30 transition-all mb-4"
			>
				{isSearching ? (
					<>
						<Loader2 className="w-4 h-4 animate-spin" />
						Searching...
					</>
				) : (
					<>
						<Sparkles className="w-4 h-4" />
						Execute Search
					</>
				)}
			</button>

			{/* Results */}
			{result && (
				<div className="flex-1 min-h-0 overflow-auto space-y-3">
					{result.results.map((item, idx) => (
						<div
							key={item.id}
							className="p-4 rounded-lg bg-secondary border border-primary/[0.08] hover:border-primary/20 transition-colors group"
							style={{ animationDelay: `${idx * 50}ms` }}
						>
							<div className="flex items-start justify-between gap-3 mb-2">
								{/* Score badge */}
								<div
									className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono font-semibold"
									style={{
										background: `color-mix(in oklch, var(${getScoreColor(item.score)}) 15%, transparent)`,
										color: `var(${getScoreColor(item.score)})`,
									}}
								>
									<span>{(item.score * 100).toFixed(0)}%</span>
								</div>

								{/* Type badge */}
								{item.type && (
									<div
										className="px-2 py-1 rounded text-xs font-mono uppercase"
										style={{
											background: `color-mix(in oklch, var(${getTypeColor(item.type)}) 10%, transparent)`,
											color: `var(${getTypeColor(item.type)})`,
										}}
									>
										{item.type}
									</div>
								)}
							</div>

							{/* Content */}
							<p className="text-sm text-secondary-foreground leading-relaxed line-clamp-3">
								{item.content}
							</p>

							{/* ID */}
							<div className="mt-2 text-xs font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
								{item.id}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================
// Cache Controls Panel
// ============================================

function CacheControlsPanel() {
	const apiClient = useApiClient();
	const [actions, setActions] = useState<Record<string, CacheAction>>({
		embedding: { type: "embedding", isLoading: false },
		query: { type: "query", isLoading: false },
		consumer: { type: "consumer", isLoading: false },
	});
	const [streams, setStreams] = useState<Stream[]>([]);
	const [selectedStream, setSelectedStream] = useState("");
	const [confirmDialog, setConfirmDialog] = useState<{
		isOpen: boolean;
		action: string;
		title: string;
		message: string;
	}>({ isOpen: false, action: "", title: "", message: "" });

	// Fetch streams on mount
	useEffect(() => {
		async function fetchStreams() {
			try {
				const data = await apiClient.getStreams();
				setStreams(data.streams);
				if (data.streams.length > 0) {
					setSelectedStream(data.streams[0].name);
				}
			} catch (err) {
				console.error("Failed to fetch streams:", err);
				// Keep empty state - no mock data
			}
		}
		fetchStreams();
	}, [apiClient]);

	const executeAction = useCallback(
		async (actionType: "embedding" | "query" | "consumer") => {
			setActions((prev) => ({
				...prev,
				[actionType]: { ...prev[actionType], isLoading: true, result: undefined },
			}));

			try {
				if (actionType === "consumer") {
					await apiClient.resetConsumer(selectedStream);
				} else {
					await apiClient.clearCache(actionType);
				}

				setActions((prev) => ({
					...prev,
					[actionType]: {
						...prev[actionType],
						isLoading: false,
						lastExecuted: Date.now(),
						result: { success: true, message: "Operation completed successfully" },
					},
				}));
			} catch (err) {
				console.error("Cache action failed:", err);
				setActions((prev) => ({
					...prev,
					[actionType]: {
						...prev[actionType],
						isLoading: false,
						result: { success: false, message: "Operation failed" },
					},
				}));
			}

			setConfirmDialog({ isOpen: false, action: "", title: "", message: "" });
		},
		[apiClient, selectedStream],
	);

	const openConfirmDialog = (actionType: string, title: string, message: string) => {
		setConfirmDialog({ isOpen: true, action: actionType, title, message });
	};

	const formatLastExecuted = (timestamp?: number) => {
		if (!timestamp) return "Never";
		const diff = Date.now() - timestamp;
		if (diff < 60000) return "Just now";
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		return `${Math.floor(diff / 3600000)}h ago`;
	};

	return (
		<div className="bg-card border border-border rounded-lg p-6 flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center gap-3 mb-6">
				<div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
					<Wrench className="w-5 h-5 text-amber-500" />
				</div>
				<div>
					<h3 className="font-display text-base text-foreground">Cache Controls</h3>
					<p className="text-xs text-muted-foreground font-mono">Administrative cache operations</p>
				</div>
			</div>

			{/* Action Cards */}
			<div className="space-y-4 flex-1">
				{/* Clear Embedding Cache */}
				<div className="p-4 rounded-lg bg-secondary border border-primary/[0.08]">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
								<Sparkles className="w-4 h-4 text-purple-500" />
							</div>
							<div>
								<div className="font-mono text-sm text-foreground">Embedding Cache</div>
								<div className="text-xs text-muted-foreground">Clear cached vector embeddings</div>
							</div>
						</div>
						<button
							type="button"
							onClick={() =>
								openConfirmDialog(
									"embedding",
									"Clear Embedding Cache",
									"This will clear all cached embeddings. New queries will need to regenerate embeddings, which may temporarily increase latency.",
								)
							}
							disabled={actions.embedding.isLoading}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-mono text-xs font-medium disabled:opacity-50"
						>
							{actions.embedding.isLoading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Trash2 className="w-3.5 h-3.5" />
							)}
							Clear
						</button>
					</div>
					{/* Status */}
					<div className="flex items-center gap-2 text-xs font-mono">
						{actions.embedding.result?.success ? (
							<CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
						) : (
							<Clock className="w-3.5 h-3.5 text-muted-foreground" />
						)}
						<span className="text-muted-foreground">
							Last cleared: {formatLastExecuted(actions.embedding.lastExecuted)}
						</span>
					</div>
				</div>

				{/* Clear Query Cache */}
				<div className="p-4 rounded-lg bg-secondary border border-primary/[0.08]">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
								<Database className="w-4 h-4 text-primary" />
							</div>
							<div>
								<div className="font-mono text-sm text-foreground">Query Cache</div>
								<div className="text-xs text-muted-foreground">Clear cached Cypher results</div>
							</div>
						</div>
						<button
							type="button"
							onClick={() =>
								openConfirmDialog(
									"query",
									"Clear Query Cache",
									"This will clear all cached query results. Graph queries will need to re-execute against FalkorDB.",
								)
							}
							disabled={actions.query.isLoading}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-mono text-xs font-medium disabled:opacity-50"
						>
							{actions.query.isLoading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Trash2 className="w-3.5 h-3.5" />
							)}
							Clear
						</button>
					</div>
					{/* Status */}
					<div className="flex items-center gap-2 text-xs font-mono">
						{actions.query.result?.success ? (
							<CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
						) : (
							<Clock className="w-3.5 h-3.5 text-muted-foreground" />
						)}
						<span className="text-muted-foreground">
							Last cleared: {formatLastExecuted(actions.query.lastExecuted)}
						</span>
					</div>
				</div>

				{/* Consumer Reset */}
				<div className="p-4 rounded-lg bg-secondary border border-primary/[0.08]">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
								<Server className="w-4 h-4 text-amber-500" />
							</div>
							<div>
								<div className="font-mono text-sm text-foreground">NATS Consumer</div>
								<div className="text-xs text-muted-foreground">Reset stream consumer position</div>
							</div>
						</div>
						<button
							type="button"
							onClick={() =>
								openConfirmDialog(
									"consumer",
									"Reset Consumer",
									`This will reset the consumer for stream "${selectedStream}". The consumer will restart from the beginning of the stream.`,
								)
							}
							disabled={actions.consumer.isLoading || !selectedStream}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors font-mono text-xs font-medium disabled:opacity-50"
						>
							{actions.consumer.isLoading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<RefreshCw className="w-3.5 h-3.5" />
							)}
							Reset
						</button>
					</div>

					{/* Stream Selector */}
					<div className="mb-3">
						<label className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-2">
							Target Stream
						</label>
						<select
							value={selectedStream}
							onChange={(e) => setSelectedStream(e.target.value)}
							className="w-full px-3 py-2 rounded-lg bg-card border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground appearance-none cursor-pointer"
						>
							{streams.map((stream) => (
								<option key={stream.name} value={stream.name}>
									{stream.name} ({stream.messages.toLocaleString()} msgs)
								</option>
							))}
						</select>
					</div>

					{/* Status */}
					<div className="flex items-center gap-2 text-xs font-mono">
						{actions.consumer.result?.success ? (
							<CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
						) : (
							<Clock className="w-3.5 h-3.5 text-muted-foreground" />
						)}
						<span className="text-muted-foreground">
							Last reset: {formatLastExecuted(actions.consumer.lastExecuted)}
						</span>
					</div>
				</div>
			</div>

			{/* Stream Stats */}
			{streams.length > 0 && (
				<div className="mt-4 pt-4 border-t border-primary/10">
					<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
						Stream Overview
					</div>
					<div className="grid grid-cols-3 gap-3">
						{streams.map((stream) => (
							<div
								key={stream.name}
								className={`p-3 rounded-lg text-center transition-colors ${
									stream.name === selectedStream
										? "bg-amber-500/10 border border-amber-500/20"
										: "bg-card"
								}`}
							>
								<div className="font-mono text-lg font-semibold text-foreground">
									{(stream.messages / 1000).toFixed(1)}k
								</div>
								<div className="text-xs text-muted-foreground truncate">
									{stream.name.split(".")[1]}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Confirmation Dialog */}
			<ConfirmDialog
				isOpen={confirmDialog.isOpen}
				title={confirmDialog.title}
				message={confirmDialog.message}
				confirmLabel={confirmDialog.action === "consumer" ? "Reset" : "Clear Cache"}
				variant={confirmDialog.action === "consumer" ? "warning" : "danger"}
				onConfirm={() => executeAction(confirmDialog.action as "embedding" | "query" | "consumer")}
				onCancel={() => setConfirmDialog({ isOpen: false, action: "", title: "", message: "" })}
			/>
		</div>
	);
}

// ============================================
// Main Page Component
// ============================================

export default function ToolsPage() {
	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="font-display text-2xl text-foreground flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-destructive flex items-center justify-center">
						<Wrench className="w-4 h-4 text-background" />
					</div>
					Admin Tools
				</h1>
				<p className="text-sm text-muted-foreground mt-1 ml-11">
					Graph queries, vector search testing, and cache management
				</p>
			</div>

			{/* Tools Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 stagger">
				<div className="lg:col-span-1 min-h-[600px]">
					<GraphQueryPanel />
				</div>
				<div className="lg:col-span-1 min-h-[600px]">
					<VectorSearchPanel />
				</div>
				<div className="lg:col-span-1 min-h-[600px]">
					<CacheControlsPanel />
				</div>
			</div>
		</div>
	);
}
