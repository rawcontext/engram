import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorSessionRepository } from "./falkor-session.repository";
import type { Session } from "./types";

describe("FalkorSessionRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorSessionRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorSessionRepository(mockClient);
	});

	describe("findById", () => {
		it("should return session when found", async () => {
			const sessionId = "session-123";
			const sessionProps = {
				id: sessionId,
				user_id: "user-1",
				started_at: mockNow - 1000,
				agent_type: "claude",
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findById(sessionId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(sessionId);
			expect(result?.userId).toBe("user-1");
			expect(result?.agentType).toBe("claude");
		});

		it("should return null when session not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should filter by tt_end = MAX_DATE", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("session-123");

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(1);
			const [query] = calls[0];
			expect(query).toContain(`WHERE s.tt_end = ${MAX_DATE}`);
		});
	});

	describe("findByExternalId", () => {
		it("should find session by external ID", async () => {
			const externalId = "ext-123";
			const sessionProps = {
				id: "session-123",
				external_id: externalId,
				user_id: "user-1",
				started_at: mockNow,
				agent_type: "claude",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByExternalId(externalId);

			expect(result?.externalId).toBe(externalId);
			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{external_id: $externalId}");
			expect(params.externalId).toBe(externalId);
		});

		it("should return null when external ID not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByExternalId("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("findActive", () => {
		it("should return all active sessions ordered by started_at DESC", async () => {
			const sessions = [
				{
					id: "session-2",
					user_id: "user-1",
					started_at: mockNow,
					agent_type: "claude",
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "session-1",
					user_id: "user-1",
					started_at: mockNow - 1000,
					agent_type: "claude",
					vt_start: mockNow - 1000,
					vt_end: MAX_DATE,
					tt_start: mockNow - 1000,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				sessions.map((s) => ({ s: { properties: s } as FalkorNode })),
			);

			const result = await repository.findActive();

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("session-2");
			expect(result[1].id).toBe("session-1");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY s.started_at DESC");
		});

		it("should return empty array when no active sessions", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findActive();

			expect(result).toEqual([]);
		});
	});

	describe("findByProvider", () => {
		it("should find sessions by agent type", async () => {
			const provider = "claude";
			const sessionProps = {
				id: "session-123",
				user_id: "user-1",
				started_at: mockNow,
				agent_type: provider,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByProvider(provider);

			expect(result).toHaveLength(1);
			expect(result[0].agentType).toBe(provider);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{agent_type: $provider}");
			expect(params.provider).toBe(provider);
		});
	});

	describe("findByUser", () => {
		it("should find sessions by user ID", async () => {
			const userId = "user-123";
			const sessionProps = {
				id: "session-123",
				user_id: userId,
				started_at: mockNow,
				agent_type: "claude",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByUser(userId);

			expect(result).toHaveLength(1);
			expect(result[0].userId).toBe(userId);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{user_id: $userId}");
			expect(params.userId).toBe(userId);
		});
	});

	describe("findByWorkingDir", () => {
		it("should find sessions by working directory", async () => {
			const workingDir = "/home/user/project";
			const sessionProps = {
				id: "session-123",
				user_id: "user-1",
				started_at: mockNow,
				agent_type: "claude",
				working_dir: workingDir,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByWorkingDir(workingDir);

			expect(result).toHaveLength(1);
			expect(result[0].workingDir).toBe(workingDir);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{working_dir: $workingDir}");
			expect(params.workingDir).toBe(workingDir);
		});
	});

	describe("create", () => {
		it("should create session with required fields", async () => {
			const input = {
				userId: "user-123",
				agentType: "claude",
			};

			const createdProps = {
				id: "generated-id",
				user_id: input.userId,
				started_at: mockNow,
				agent_type: input.agentType,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.userId).toBe(input.userId);
			expect(result.agentType).toBe(input.agentType);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (s:Session");
		});

		it("should create session with optional fields", async () => {
			const input = {
				userId: "user-123",
				agentType: "claude",
				externalId: "ext-456",
				title: "Test Session",
				provider: "anthropic",
				workingDir: "/home/user",
				gitRemote: "https://github.com/user/repo",
				metadata: { key: "value" },
			};

			const createdProps = {
				id: "generated-id",
				user_id: input.userId,
				external_id: input.externalId,
				title: input.title,
				provider: input.provider,
				started_at: mockNow,
				agent_type: input.agentType,
				working_dir: input.workingDir,
				git_remote: input.gitRemote,
				metadata: JSON.stringify(input.metadata),
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.externalId).toBe(input.externalId);
			expect(result.title).toBe(input.title);
			expect(result.provider).toBe(input.provider);
			expect(result.workingDir).toBe(input.workingDir);
			expect(result.gitRemote).toBe(input.gitRemote);
			expect(result.metadata).toEqual(input.metadata);
		});
	});

	describe("update", () => {
		it("should update session with bitemporal versioning", async () => {
			const existingSession: Session = {
				id: "session-123",
				userId: "user-1",
				startedAt: new Date(mockNow - 1000),
				agentType: "claude",
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			const updates = {
				title: "Updated Title",
				summary: "Session summary",
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: existingSession.id,
								user_id: existingSession.userId,
								started_at: existingSession.startedAt.getTime(),
								agent_type: existingSession.agentType,
								vt_start: existingSession.vtStart,
								vt_end: existingSession.vtEnd,
								tt_start: existingSession.ttStart,
								tt_end: existingSession.ttEnd,
							},
						} as FalkorNode,
					},
				])
				// close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// create new version
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "new-session-id",
								user_id: existingSession.userId,
								started_at: existingSession.startedAt.getTime(),
								agent_type: existingSession.agentType,
								title: updates.title,
								summary: updates.summary,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// link REPLACES edge
				.mockResolvedValueOnce([]);

			const result = await repository.update(existingSession.id, updates);

			expect(result.title).toBe(updates.title);
			expect(result.summary).toBe(updates.summary);
			expect(result.userId).toBe(existingSession.userId);
		});

		it("should throw error if session not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.update("nonexistent", { title: "New" })).rejects.toThrow(
				"Session not found: nonexistent",
			);
		});

		it("should retry on concurrent modification", async () => {
			const existingSession = {
				id: "session-123",
				user_id: "user-1",
				started_at: mockNow - 1000,
				agent_type: "claude",
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			const updates = { title: "Updated" };

			spyOn(mockClient, "query")
				// First attempt - findById
				.mockResolvedValueOnce([{ s: { properties: existingSession } as FalkorNode }])
				// First attempt - close fails (concurrent modification)
				.mockResolvedValueOnce([{ count: 0 }])
				// Second attempt - findById
				.mockResolvedValueOnce([{ s: { properties: existingSession } as FalkorNode }])
				// Second attempt - close succeeds
				.mockResolvedValueOnce([{ count: 1 }])
				// Second attempt - create new version
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								...existingSession,
								title: updates.title,
								id: "new-id",
							},
						} as FalkorNode,
					},
				])
				// Second attempt - link REPLACES edge
				.mockResolvedValueOnce([]);

			const result = await repository.update("session-123", updates);

			expect(result.title).toBe("Updated");
			// Should have retried
			const calls = (mockClient.query as any).mock.calls;
			expect(calls.length).toBeGreaterThan(2);
		});

		it("should fail after max retries", async () => {
			const existingSession = {
				id: "session-123",
				user_id: "user-1",
				started_at: mockNow - 1000,
				agent_type: "claude",
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// All 3 attempts fail with concurrent modification
				.mockResolvedValueOnce([{ s: { properties: existingSession } as FalkorNode }])
				.mockResolvedValueOnce([{ count: 0 }])
				.mockResolvedValueOnce([{ s: { properties: existingSession } as FalkorNode }])
				.mockResolvedValueOnce([{ count: 0 }])
				.mockResolvedValueOnce([{ s: { properties: existingSession } as FalkorNode }])
				.mockResolvedValueOnce([{ count: 0 }]);

			await expect(repository.update("session-123", { title: "Updated" })).rejects.toThrow(
				/Failed to update session .* after 3 attempts/,
			);
		});
	});

	describe("delete", () => {
		it("should soft delete existing session", async () => {
			const sessionId = "session-123";
			const sessionProps = {
				id: sessionId,
				user_id: "user-1",
				started_at: mockNow,
				agent_type: "claude",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([{ s: { properties: sessionProps } as FalkorNode }])
				// softDelete
				.mockResolvedValueOnce([]);

			await repository.delete(sessionId);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);
			const [deleteQuery] = calls[1];
			expect(deleteQuery).toContain("SET n.tt_end = $t");
		});

		it("should throw error if session not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.delete("nonexistent")).rejects.toThrow(
				"Session not found: nonexistent",
			);
		});
	});

	describe("findByIdAt (time-travel)", () => {
		it("should find session at specific valid time", async () => {
			const sessionId = "session-123";
			const vtPoint = mockNow - 500;

			const sessionProps = {
				id: sessionId,
				user_id: "user-1",
				started_at: mockNow - 1000,
				agent_type: "claude",
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByIdAt(sessionId, { vt: vtPoint });

			expect(result).not.toBeNull();
			expect(result?.id).toBe(sessionId);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			// Query builder uses suffixed params like $vt_0
			expect(query).toContain("s.vt_start <=");
			expect(query).toContain("s.vt_end >");
			expect(params.id).toBe(sessionId);
		});

		it("should find session at specific transaction time", async () => {
			const sessionId = "session-123";
			const ttPoint = mockNow - 500;

			const sessionProps = {
				id: sessionId,
				user_id: "user-1",
				started_at: mockNow - 1000,
				agent_type: "claude",
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findByIdAt(sessionId, { tt: ttPoint });

			expect(result).not.toBeNull();

			const [query] = (mockClient.query as any).mock.calls[0];
			// Query builder uses suffixed params like $tt_0
			expect(query).toContain("s.tt_start <=");
			expect(query).toContain("s.tt_end >");
		});

		it("should return null when session did not exist at specified time", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByIdAt("session-123", { vt: mockNow - 10000 });

			expect(result).toBeNull();
		});
	});

	describe("findByUserAt (time-travel)", () => {
		it("should find all user sessions at specific time", async () => {
			const userId = "user-123";
			const vtPoint = mockNow - 500;

			const sessions = [
				{
					id: "session-1",
					user_id: userId,
					started_at: mockNow - 1000,
					agent_type: "claude",
					vt_start: mockNow - 1000,
					vt_end: MAX_DATE,
					tt_start: mockNow - 1000,
					tt_end: MAX_DATE,
				},
				{
					id: "session-2",
					user_id: userId,
					started_at: mockNow - 800,
					agent_type: "gpt",
					vt_start: mockNow - 800,
					vt_end: MAX_DATE,
					tt_start: mockNow - 800,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				sessions.map((s) => ({ s: { properties: s } as FalkorNode })),
			);

			const result = await repository.findByUserAt(userId, { vt: vtPoint });

			expect(result).toHaveLength(2);
			expect(result[0].userId).toBe(userId);
			expect(result[1].userId).toBe(userId);
		});
	});

	describe("mapToSession", () => {
		it("should correctly map all optional fields", async () => {
			const sessionProps = {
				id: "session-123",
				external_id: "ext-456",
				title: "Test Session",
				user_id: "user-1",
				provider: "anthropic",
				started_at: mockNow,
				working_dir: "/home/user",
				git_remote: "https://github.com/user/repo",
				agent_type: "claude",
				summary: "Session summary",
				embedding: [0.1, 0.2, 0.3],
				metadata: JSON.stringify({ key: "value" }),
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findById("session-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("session-123");
			expect(result?.externalId).toBe("ext-456");
			expect(result?.title).toBe("Test Session");
			expect(result?.userId).toBe("user-1");
			expect(result?.provider).toBe("anthropic");
			expect(result?.startedAt).toBeInstanceOf(Date);
			expect(result?.startedAt.getTime()).toBe(mockNow);
			expect(result?.workingDir).toBe("/home/user");
			expect(result?.gitRemote).toBe("https://github.com/user/repo");
			expect(result?.agentType).toBe("claude");
			expect(result?.summary).toBe("Session summary");
			expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
			expect(result?.metadata).toEqual({ key: "value" });
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
			expect(result?.ttStart).toBe(mockNow);
			expect(result?.ttEnd).toBe(MAX_DATE);
		});

		it("should handle malformed metadata JSON gracefully", async () => {
			const sessionProps = {
				id: "session-123",
				user_id: "user-1",
				started_at: mockNow,
				agent_type: "claude",
				metadata: "not-valid-json",
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ s: { properties: sessionProps } as FalkorNode },
			]);

			const result = await repository.findById("session-123");

			// Should not throw, metadata should be undefined due to parse failure
			expect(result).not.toBeNull();
			expect(result?.metadata).toBeUndefined();
		});
	});
});
