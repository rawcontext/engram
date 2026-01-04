/**
 * GitHub Actions API Integration
 *
 * Provides workflow runs, deployments, and workflow dispatch functionality.
 * Requires GITHUB_TOKEN or GH_TOKEN environment variable.
 *
 * @see https://docs.github.com/en/rest/actions
 */

const GITHUB_API_BASE = "https://api.github.com";

export interface WorkflowRun {
	id: number;
	name: string;
	headBranch: string;
	headSha: string;
	status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
	conclusion:
		| "success"
		| "failure"
		| "neutral"
		| "cancelled"
		| "skipped"
		| "timed_out"
		| "action_required"
		| null;
	workflowId: number;
	event: string;
	createdAt: string;
	updatedAt: string;
	runAttempt: number;
	runNumber: number;
	runStartedAt: string;
	htmlUrl: string;
	actor: {
		login: string;
		avatarUrl: string;
	};
	triggeredBy: {
		login: string;
		avatarUrl: string;
	} | null;
}

export interface Workflow {
	id: number;
	name: string;
	path: string;
	state: "active" | "deleted" | "disabled_fork" | "disabled_inactivity" | "disabled_manually";
	createdAt: string;
	updatedAt: string;
	htmlUrl: string;
	badgeUrl: string;
}

export interface Deployment {
	id: number;
	sha: string;
	ref: string;
	task: string;
	environment: string;
	description: string | null;
	creator: {
		login: string;
		avatarUrl: string;
	};
	createdAt: string;
	updatedAt: string;
	statusesUrl: string;
	repositoryUrl: string;
	transientEnvironment: boolean;
	productionEnvironment: boolean;
}

export interface DeploymentStatus {
	id: number;
	state: "error" | "failure" | "inactive" | "pending" | "success" | "queued" | "in_progress";
	description: string | null;
	environment: string;
	targetUrl: string | null;
	logUrl: string | null;
	createdAt: string;
	updatedAt: string;
	creator: {
		login: string;
		avatarUrl: string;
	};
}

export interface DeploymentWithStatus extends Deployment {
	latestStatus: DeploymentStatus | null;
}

export interface DispatchResult {
	success: boolean;
	message?: string;
}

class GitHubClient {
	private token: string;
	private owner: string;
	private repo: string;

	constructor(token: string, owner: string, repo: string) {
		this.token = token;
		this.owner = owner;
		this.repo = repo;
	}

	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`${GITHUB_API_BASE}${path}`, {
			...options,
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw new Error(error.message || `GitHub API error: ${response.status}`);
		}

		// Handle 204 No Content
		if (response.status === 204) {
			return {} as T;
		}

		return response.json();
	}

	/**
	 * List workflow runs for the repository
	 */
	async listWorkflowRuns(
		options: {
			branch?: string;
			event?: string;
			status?: WorkflowRun["status"];
			perPage?: number;
			page?: number;
		} = {},
	): Promise<{ totalCount: number; runs: WorkflowRun[] }> {
		const params = new URLSearchParams();
		if (options.branch) params.set("branch", options.branch);
		if (options.event) params.set("event", options.event);
		if (options.status) params.set("status", options.status);
		params.set("per_page", String(options.perPage ?? 30));
		params.set("page", String(options.page ?? 1));

		const data = await this.fetch<{
			total_count: number;
			workflow_runs: RawWorkflowRun[];
		}>(`/repos/${this.owner}/${this.repo}/actions/runs?${params}`);

		return {
			totalCount: data.total_count,
			runs: data.workflow_runs.map(mapWorkflowRun),
		};
	}

	/**
	 * Get a single workflow run
	 */
	async getWorkflowRun(runId: number): Promise<WorkflowRun> {
		const data = await this.fetch<RawWorkflowRun>(
			`/repos/${this.owner}/${this.repo}/actions/runs/${runId}`,
		);
		return mapWorkflowRun(data);
	}

	/**
	 * Re-run a workflow
	 */
	async rerunWorkflow(runId: number, enableDebugLogging = false): Promise<void> {
		await this.fetch(`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/rerun`, {
			method: "POST",
			body: JSON.stringify({ enable_debug_logging: enableDebugLogging }),
		});
	}

	/**
	 * Cancel a workflow run
	 */
	async cancelWorkflowRun(runId: number): Promise<void> {
		await this.fetch(`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/cancel`, {
			method: "POST",
		});
	}

	/**
	 * List all workflows in the repository
	 */
	async listWorkflows(): Promise<Workflow[]> {
		const data = await this.fetch<{
			total_count: number;
			workflows: RawWorkflow[];
		}>(`/repos/${this.owner}/${this.repo}/actions/workflows`);

		return data.workflows.map(mapWorkflow);
	}

	/**
	 * Trigger a workflow dispatch event
	 */
	async dispatchWorkflow(
		workflowId: number | string,
		ref: string,
		inputs: Record<string, string> = {},
	): Promise<DispatchResult> {
		try {
			await this.fetch(
				`/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/dispatches`,
				{
					method: "POST",
					body: JSON.stringify({ ref, inputs }),
				},
			);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * List deployments for the repository
	 */
	async listDeployments(
		options: {
			environment?: string;
			sha?: string;
			ref?: string;
			perPage?: number;
			page?: number;
		} = {},
	): Promise<Deployment[]> {
		const params = new URLSearchParams();
		if (options.environment) params.set("environment", options.environment);
		if (options.sha) params.set("sha", options.sha);
		if (options.ref) params.set("ref", options.ref);
		params.set("per_page", String(options.perPage ?? 30));
		params.set("page", String(options.page ?? 1));

		const data = await this.fetch<RawDeployment[]>(
			`/repos/${this.owner}/${this.repo}/deployments?${params}`,
		);
		return data.map(mapDeployment);
	}

	/**
	 * Get deployment statuses
	 */
	async getDeploymentStatuses(deploymentId: number): Promise<DeploymentStatus[]> {
		const data = await this.fetch<RawDeploymentStatus[]>(
			`/repos/${this.owner}/${this.repo}/deployments/${deploymentId}/statuses`,
		);
		return data.map(mapDeploymentStatus);
	}

	/**
	 * List deployments with their latest status
	 */
	async listDeploymentsWithStatus(
		options: { environment?: string; perPage?: number } = {},
	): Promise<DeploymentWithStatus[]> {
		const deployments = await this.listDeployments(options);

		const deploymentsWithStatus = await Promise.all(
			deployments.map(async (deployment) => {
				try {
					const statuses = await this.getDeploymentStatuses(deployment.id);
					return {
						...deployment,
						latestStatus: statuses[0] ?? null,
					};
				} catch {
					return {
						...deployment,
						latestStatus: null,
					};
				}
			}),
		);

		return deploymentsWithStatus;
	}

	/**
	 * Create a deployment status
	 */
	async createDeploymentStatus(
		deploymentId: number,
		state: DeploymentStatus["state"],
		options: {
			description?: string;
			logUrl?: string;
			environment?: string;
			autoInactive?: boolean;
		} = {},
	): Promise<DeploymentStatus> {
		const data = await this.fetch<RawDeploymentStatus>(
			`/repos/${this.owner}/${this.repo}/deployments/${deploymentId}/statuses`,
			{
				method: "POST",
				body: JSON.stringify({
					state,
					description: options.description,
					log_url: options.logUrl,
					environment: options.environment,
					auto_inactive: options.autoInactive,
				}),
			},
		);
		return mapDeploymentStatus(data);
	}

	/**
	 * Approve or reject a deployment pending review
	 */
	async reviewPendingDeployment(
		runId: number,
		environmentIds: number[],
		state: "approved" | "rejected",
		comment?: string,
	): Promise<void> {
		await this.fetch(
			`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/pending_deployments`,
			{
				method: "POST",
				body: JSON.stringify({
					environment_ids: environmentIds,
					state,
					comment,
				}),
			},
		);
	}

	/**
	 * Get pending deployments for a run
	 */
	async getPendingDeployments(runId: number): Promise<
		Array<{
			environment: {
				id: number;
				name: string;
				htmlUrl: string;
			};
			waitTimer: number;
			waitTimerStartedAt: string | null;
			currentUserCanApprove: boolean;
			reviewers: Array<{
				type: "User" | "Team";
				reviewer: { id: number; login: string };
			}>;
		}>
	> {
		const data = await this.fetch<RawPendingDeployment[]>(
			`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/pending_deployments`,
		);

		return data.map((pd) => ({
			environment: {
				id: pd.environment.id,
				name: pd.environment.name,
				htmlUrl: pd.environment.html_url,
			},
			waitTimer: pd.wait_timer,
			waitTimerStartedAt: pd.wait_timer_started_at,
			currentUserCanApprove: pd.current_user_can_approve,
			reviewers: pd.reviewers.map((r) => ({
				type: r.type,
				reviewer: { id: r.reviewer.id, login: r.reviewer.login },
			})),
		}));
	}
}

// Raw API response types
interface RawWorkflowRun {
	id: number;
	name: string;
	head_branch: string;
	head_sha: string;
	status: WorkflowRun["status"];
	conclusion: WorkflowRun["conclusion"];
	workflow_id: number;
	event: string;
	created_at: string;
	updated_at: string;
	run_attempt: number;
	run_number: number;
	run_started_at: string;
	html_url: string;
	actor: {
		login: string;
		avatar_url: string;
	};
	triggering_actor?: {
		login: string;
		avatar_url: string;
	};
}

interface RawWorkflow {
	id: number;
	name: string;
	path: string;
	state: Workflow["state"];
	created_at: string;
	updated_at: string;
	html_url: string;
	badge_url: string;
}

interface RawDeployment {
	id: number;
	sha: string;
	ref: string;
	task: string;
	environment: string;
	description: string | null;
	creator: {
		login: string;
		avatar_url: string;
	};
	created_at: string;
	updated_at: string;
	statuses_url: string;
	repository_url: string;
	transient_environment: boolean;
	production_environment: boolean;
}

interface RawDeploymentStatus {
	id: number;
	state: DeploymentStatus["state"];
	description: string | null;
	environment: string;
	target_url: string | null;
	log_url: string | null;
	created_at: string;
	updated_at: string;
	creator: {
		login: string;
		avatar_url: string;
	};
}

interface RawPendingDeployment {
	environment: {
		id: number;
		name: string;
		html_url: string;
	};
	wait_timer: number;
	wait_timer_started_at: string | null;
	current_user_can_approve: boolean;
	reviewers: Array<{
		type: "User" | "Team";
		reviewer: { id: number; login: string };
	}>;
}

// Mapping functions
function mapWorkflowRun(raw: RawWorkflowRun): WorkflowRun {
	return {
		id: raw.id,
		name: raw.name,
		headBranch: raw.head_branch,
		headSha: raw.head_sha,
		status: raw.status,
		conclusion: raw.conclusion,
		workflowId: raw.workflow_id,
		event: raw.event,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		runAttempt: raw.run_attempt,
		runNumber: raw.run_number,
		runStartedAt: raw.run_started_at,
		htmlUrl: raw.html_url,
		actor: {
			login: raw.actor.login,
			avatarUrl: raw.actor.avatar_url,
		},
		triggeredBy: raw.triggering_actor
			? {
					login: raw.triggering_actor.login,
					avatarUrl: raw.triggering_actor.avatar_url,
				}
			: null,
	};
}

function mapWorkflow(raw: RawWorkflow): Workflow {
	return {
		id: raw.id,
		name: raw.name,
		path: raw.path,
		state: raw.state,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		htmlUrl: raw.html_url,
		badgeUrl: raw.badge_url,
	};
}

function mapDeployment(raw: RawDeployment): Deployment {
	return {
		id: raw.id,
		sha: raw.sha,
		ref: raw.ref,
		task: raw.task,
		environment: raw.environment,
		description: raw.description,
		creator: {
			login: raw.creator.login,
			avatarUrl: raw.creator.avatar_url,
		},
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		statusesUrl: raw.statuses_url,
		repositoryUrl: raw.repository_url,
		transientEnvironment: raw.transient_environment,
		productionEnvironment: raw.production_environment,
	};
}

function mapDeploymentStatus(raw: RawDeploymentStatus): DeploymentStatus {
	return {
		id: raw.id,
		state: raw.state,
		description: raw.description,
		environment: raw.environment,
		targetUrl: raw.target_url,
		logUrl: raw.log_url,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		creator: {
			login: raw.creator.login,
			avatarUrl: raw.creator.avatar_url,
		},
	};
}

/**
 * Create a GitHub client instance
 * Uses GITHUB_TOKEN or GH_TOKEN environment variable
 */
export function createGitHubClient(owner: string, repo: string): GitHubClient | null {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (!token) {
		return null;
	}
	return new GitHubClient(token, owner, repo);
}

/**
 * Get GitHub client, throwing if not configured
 */
export function getGitHubClient(owner: string, repo: string): GitHubClient {
	const client = createGitHubClient(owner, repo);
	if (!client) {
		throw new Error("GITHUB_TOKEN or GH_TOKEN environment variable is not set");
	}
	return client;
}

/**
 * Default client for the Engram repository
 */
export function getEngramGitHubClient(): GitHubClient {
	const owner = process.env.GITHUB_OWNER ?? "rawcontext";
	const repo = process.env.GITHUB_REPO ?? "engram";
	return getGitHubClient(owner, repo);
}
