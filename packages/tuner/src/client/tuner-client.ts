/**
 * HTTP client for the Tuner service API
 */

import type {
	BestParamsResponse,
	CreateStudyRequest,
	HealthResponse,
	ParamImportance,
	ParetoTrialResponse,
	StudyResponse,
	StudySummary,
	TrialCompleteRequest,
	TrialResponse,
	TrialState,
	TrialSuggestion,
} from "./types.js";

export interface TunerClientOptions {
	baseUrl?: string;
	timeout?: number;
}

export class TunerClientError extends Error {
	constructor(
		message: string,
		public status: number,
		public detail?: string,
	) {
		super(message);
		this.name = "TunerClientError";
	}
}

export class TunerClient {
	private readonly baseUrl: string;
	private readonly timeout: number;

	constructor(options: TunerClientOptions = {}) {
		this.baseUrl = options.baseUrl ?? "http://localhost:8000/v1";
		this.timeout = options.timeout ?? 30000;
	}

	/**
	 * Make HTTP request with proper handling of empty responses
	 */
	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(`${this.baseUrl}${path}`, {
				...options,
				headers: {
					"Content-Type": "application/json",
					...options.headers,
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorBody = await response.json().catch(() => ({}));
				throw new TunerClientError(
					`Request failed: ${response.statusText}`,
					response.status,
					errorBody.detail,
				);
			}

			// Handle 204 No Content - safe for void return types
			if (response.status === 204) {
				// This is safe when T is void, which is the only valid use case for 204
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
				return undefined as any;
			}

			return response.json();
		} finally {
			clearTimeout(timeoutId);
		}
	}

	// Health endpoints
	async health(): Promise<HealthResponse> {
		return this.request<HealthResponse>("/health");
	}

	async ready(): Promise<{ status: string; reason?: string }> {
		return this.request("/ready");
	}

	// Study endpoints
	async createStudy(request: CreateStudyRequest): Promise<StudyResponse> {
		return this.request<StudyResponse>("/studies", {
			method: "POST",
			body: JSON.stringify(request),
		});
	}

	async listStudies(): Promise<StudySummary[]> {
		return this.request<StudySummary[]>("/studies");
	}

	async getStudy(studyName: string): Promise<StudyResponse> {
		return this.request<StudyResponse>(`/studies/${encodeURIComponent(studyName)}`);
	}

	async deleteStudy(studyName: string): Promise<void> {
		await this.request<void>(`/studies/${encodeURIComponent(studyName)}`, {
			method: "DELETE",
		});
	}

	// Trial endpoints
	async suggestTrial(studyName: string): Promise<TrialSuggestion> {
		return this.request<TrialSuggestion>(
			`/studies/${encodeURIComponent(studyName)}/trials/suggest`,
			{ method: "POST" },
		);
	}

	async completeTrial(
		studyName: string,
		trialId: number,
		request: TrialCompleteRequest,
	): Promise<TrialResponse> {
		return this.request<TrialResponse>(
			`/studies/${encodeURIComponent(studyName)}/trials/${trialId}/complete`,
			{
				method: "POST",
				body: JSON.stringify(request),
			},
		);
	}

	async pruneTrial(studyName: string, trialId: number): Promise<TrialResponse> {
		return this.request<TrialResponse>(
			`/studies/${encodeURIComponent(studyName)}/trials/${trialId}/prune`,
			{ method: "POST" },
		);
	}

	async listTrials(
		studyName: string,
		options?: { state?: TrialState; limit?: number; offset?: number },
	): Promise<TrialResponse[]> {
		const params = new URLSearchParams();
		if (options?.state) params.set("state", options.state);
		if (options?.limit) params.set("limit", options.limit.toString());
		if (options?.offset) params.set("offset", options.offset.toString());

		const query = params.toString() ? `?${params.toString()}` : "";
		return this.request<TrialResponse[]>(
			`/studies/${encodeURIComponent(studyName)}/trials${query}`,
		);
	}

	// Analysis endpoints
	async getBestParams(studyName: string): Promise<BestParamsResponse> {
		return this.request<BestParamsResponse>(`/studies/${encodeURIComponent(studyName)}/best`);
	}

	async getParetoFront(studyName: string): Promise<ParetoTrialResponse[]> {
		return this.request<ParetoTrialResponse[]>(`/studies/${encodeURIComponent(studyName)}/pareto`);
	}

	async getParamImportance(studyName: string, targetIdx = 0): Promise<ParamImportance> {
		return this.request<ParamImportance>(
			`/studies/${encodeURIComponent(studyName)}/importance?target_idx=${targetIdx}`,
		);
	}
}
