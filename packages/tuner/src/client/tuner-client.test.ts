import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TunerClient, TunerClientError } from "./tuner-client";

describe("TunerClient", () => {
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	function mockFetch(response: Response | (() => Promise<Response>)) {
		const fetchMock = typeof response === "function" ? mock(response) : mock(async () => response);
		global.fetch = fetchMock as unknown as typeof fetch;
		return fetchMock;
	}

	describe("constructor", () => {
		it("should use default baseUrl", () => {
			const client = new TunerClient();
			expect(client).toBeDefined();
		});

		it("should accept custom baseUrl", () => {
			const client = new TunerClient({ baseUrl: "http://custom:8080/api" });
			expect(client).toBeDefined();
		});

		it("should accept custom timeout", () => {
			const client = new TunerClient({ timeout: 5000 });
			expect(client).toBeDefined();
		});
	});

	describe("health", () => {
		it("should return health response", async () => {
			const mockResponse = {
				status: "healthy" as const,
				version: "1.0.0",
				storage_connected: true,
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.health();

			expect(result).toEqual(mockResponse);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/health",
				expect.objectContaining({
					headers: { "Content-Type": "application/json" },
				}),
			);
		});
	});

	describe("ready", () => {
		it("should return ready status", async () => {
			const mockResponse = { status: "ready" };
			mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.ready();

			expect(result).toEqual(mockResponse);
		});
	});

	describe("study endpoints", () => {
		it("should create study", async () => {
			const mockResponse = {
				study_id: 1,
				study_name: "test-study",
				direction: "maximize",
				n_trials: 0,
				best_value: null,
				best_params: null,
				datetime_start: null,
				user_attrs: {},
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.createStudy({
				name: "test-study",
				direction: "maximize",
				search_space: [],
			});

			expect(result.study_name).toBe("test-study");
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies",
				expect.objectContaining({
					method: "POST",
					body: expect.any(String),
				}),
			);
		});

		it("should list studies", async () => {
			const mockResponse = [
				{ study_name: "study-1", n_trials: 10 },
				{ study_name: "study-2", n_trials: 5 },
			];
			mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.listStudies();

			expect(result).toHaveLength(2);
			expect(result[0].study_name).toBe("study-1");
		});

		it("should get study by name", async () => {
			const mockResponse = {
				study_id: 1,
				study_name: "my-study",
				direction: "maximize",
				n_trials: 15,
				best_value: 0.9,
				best_params: { depth: 50 },
				datetime_start: "2024-01-01T00:00:00Z",
				user_attrs: {},
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.getStudy("my-study");

			expect(result.study_name).toBe("my-study");
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/my-study",
				expect.any(Object),
			);
		});

		it("should URL-encode study name", async () => {
			const mockResponse = {
				study_id: 1,
				study_name: "my study",
				direction: "maximize",
				n_trials: 0,
				best_value: null,
				best_params: null,
				datetime_start: null,
				user_attrs: {},
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			await client.getStudy("my study");

			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/my%20study",
				expect.any(Object),
			);
		});

		it("should delete study", async () => {
			const fetchMock = mockFetch(new Response(null, { status: 204 }));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			await client.deleteStudy("old-study");

			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/old-study",
				expect.objectContaining({ method: "DELETE" }),
			);
		});
	});

	describe("trial endpoints", () => {
		it("should suggest trial", async () => {
			const mockResponse = { trial_id: 1, params: { depth: 50 }, study_name: "test-study" };
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.suggestTrial("test-study");

			expect(result.trial_id).toBe(1);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/trials/suggest",
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("should complete trial", async () => {
			const mockResponse = {
				trial_id: 1,
				study_name: "test-study",
				state: "COMPLETE",
				values: [0.85],
				params: {},
				datetime_start: null,
				datetime_complete: null,
				duration_seconds: null,
				user_attrs: {},
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.completeTrial("test-study", 1, {
				values: 0.85,
			});

			expect(result.state).toBe("COMPLETE");
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/trials/1/complete",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ values: 0.85 }),
				}),
			);
		});

		it("should prune trial", async () => {
			const mockResponse = {
				trial_id: 1,
				study_name: "test-study",
				state: "PRUNED",
				values: null,
				params: {},
				datetime_start: null,
				datetime_complete: null,
				duration_seconds: null,
				user_attrs: {},
			};
			mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.pruneTrial("test-study", 1);

			expect(result.state).toBe("PRUNED");
		});

		it("should list trials with no options", async () => {
			const mockResponse = [{ trial_id: 1 }, { trial_id: 2 }];
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.listTrials("test-study");

			expect(result).toHaveLength(2);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/trials",
				expect.any(Object),
			);
		});

		it("should list trials with filters", async () => {
			const fetchMock = mockFetch(Response.json([]));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			await client.listTrials("test-study", {
				state: "COMPLETE",
				limit: 10,
				offset: 5,
			});

			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/trials?state=COMPLETE&limit=10&offset=5",
				expect.any(Object),
			);
		});
	});

	describe("analysis endpoints", () => {
		it("should get best params", async () => {
			const mockResponse = { trial_id: 5, params: { depth: 40 }, value: 0.92 };
			mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.getBestParams("test-study");

			expect(result.value).toBe(0.92);
			expect(result.params.depth).toBe(40);
		});

		it("should get pareto front", async () => {
			const mockResponse = [
				{ trial_id: 1, values: [0.9, -100], params: {} },
				{ trial_id: 2, values: [0.8, -50], params: {} },
			];
			mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.getParetoFront("test-study");

			expect(result).toHaveLength(2);
		});

		it("should get param importance with default target", async () => {
			const mockResponse = {
				importances: { depth: 0.4, tier: 0.3, minScore: 0.2 },
				method: "fanova",
			};
			const fetchMock = mockFetch(Response.json(mockResponse));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			const result = await client.getParamImportance("test-study");

			expect(result.importances.depth).toBe(0.4);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/importance?target_idx=0",
				expect.any(Object),
			);
		});

		it("should get param importance with custom target", async () => {
			const fetchMock = mockFetch(Response.json({ importances: {}, method: "fanova" }));

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });
			await client.getParamImportance("test-study", 1);

			expect(fetchMock).toHaveBeenCalledWith(
				"http://test:6177/v1/tuner/studies/test-study/importance?target_idx=1",
				expect.any(Object),
			);
		});
	});

	describe("error handling", () => {
		it("should throw TunerClientError on non-ok response", async () => {
			mockFetch(
				new Response(JSON.stringify({ detail: "Not found" }), {
					status: 404,
					statusText: "Not Found",
				}),
			);

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });

			await expect(client.getStudy("missing")).rejects.toThrow(TunerClientError);
		});

		it("should include status and detail in error", async () => {
			mockFetch(
				new Response(JSON.stringify({ detail: "Study not found" }), {
					status: 404,
					statusText: "Not Found",
				}),
			);

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });

			try {
				await client.getStudy("missing");
				throw new Error("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(TunerClientError);
				expect((error as TunerClientError).status).toBe(404);
				expect((error as TunerClientError).detail).toBe("Study not found");
			}
		});

		it("should handle non-JSON error response", async () => {
			mockFetch(
				new Response("Internal Server Error", {
					status: 500,
					statusText: "Internal Server Error",
				}),
			);

			const client = new TunerClient({ baseUrl: "http://test:6177/v1/tuner" });

			await expect(client.health()).rejects.toThrow(TunerClientError);
		});
	});

	describe("TunerClientError", () => {
		it("should have correct properties", () => {
			const error = new TunerClientError("Test error", 400, "Bad request");

			expect(error.message).toBe("Test error");
			expect(error.status).toBe(400);
			expect(error.detail).toBe("Bad request");
			expect(error.name).toBe("TunerClientError");
		});

		it("should work without detail", () => {
			const error = new TunerClientError("Test error", 500);

			expect(error.detail).toBeUndefined();
		});
	});
});
