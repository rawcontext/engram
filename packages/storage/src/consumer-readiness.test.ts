import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Kafka module
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockDescribeGroups = vi.fn();

const mockAdminClient = {
	connect: mockConnect,
	disconnect: mockDisconnect,
	describeGroups: mockDescribeGroups,
};

vi.mock("@confluentinc/kafka-javascript", () => ({
	default: {
		AdminClient: {
			create: vi.fn(() => mockAdminClient),
		},
	},
}));

import {
	ConsumerGroupStates,
	checkConsumerGroups,
	type WaitForConsumersConfig,
	waitForConsumers,
} from "./consumer-readiness";

describe("Consumer Readiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.REDPANDA_BROKERS = "localhost:19092";
	});

	describe("ConsumerGroupStates", () => {
		it("should have correct state constants", () => {
			expect(ConsumerGroupStates.UNKNOWN).toBe(0);
			expect(ConsumerGroupStates.PREPARING_REBALANCE).toBe(1);
			expect(ConsumerGroupStates.COMPLETING_REBALANCE).toBe(2);
			expect(ConsumerGroupStates.STABLE).toBe(3);
			expect(ConsumerGroupStates.DEAD).toBe(4);
			expect(ConsumerGroupStates.EMPTY).toBe(5);
		});
	});

	describe("waitForConsumers", () => {
		it("should return success immediately when no groups specified", async () => {
			const config: WaitForConsumersConfig = {
				groupIds: [],
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(true);
			expect(result.groups).toEqual([]);
			expect(result.elapsedMs).toBe(0);
			expect(mockConnect).not.toHaveBeenCalled();
		});

		it("should return success when all groups are ready", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
					{
						groupId: "group2",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }, { id: "member2" }],
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1", "group2"],
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(true);
			expect(result.groups).toHaveLength(2);
			expect(result.groups[0].groupId).toBe("group1");
			expect(result.groups[0].isReady).toBe(true);
			expect(result.groups[0].stateName).toBe("STABLE");
			expect(result.groups[1].isReady).toBe(true);
			expect(mockConnect).toHaveBeenCalled();
			expect(mockDisconnect).toHaveBeenCalled();
		});

		it("should poll until groups are ready", async () => {
			let callCount = 0;
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callCount++;
				if (callCount === 1) {
					// First call: not ready
					callback(null, [
						{
							groupId: "group1",
							state: ConsumerGroupStates.PREPARING_REBALANCE,
							members: [],
						},
					]);
				} else {
					// Second call: ready
					callback(null, [
						{
							groupId: "group1",
							state: ConsumerGroupStates.STABLE,
							members: [{ id: "member1" }],
						},
					]);
				}
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				pollIntervalMs: 10,
				timeoutMs: 5000,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(true);
			expect(result.groups[0].isReady).toBe(true);
			expect(mockDescribeGroups).toHaveBeenCalledTimes(2);
		});

		it("should timeout when groups are not ready in time", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.EMPTY,
						members: [],
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				pollIntervalMs: 50,
				timeoutMs: 100,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Timeout waiting for consumer groups");
			expect(result.error).toContain("group1");
			expect(result.groups[0].isReady).toBe(false);
			expect(mockDisconnect).toHaveBeenCalled();
		});

		it("should handle describeGroups errors and continue polling", async () => {
			let callCount = 0;
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callCount++;
				if (callCount === 1) {
					// First call: error
					callback(new Error("Network error"), []);
				} else {
					// Second call: success
					callback(null, [
						{
							groupId: "group1",
							state: ConsumerGroupStates.STABLE,
							members: [{ id: "member1" }],
						},
					]);
				}
			});

			const logger = vi.fn();
			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				pollIntervalMs: 10,
				timeoutMs: 5000,
				logger,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(true);
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("Poll error (retrying)"));
		});

		it("should handle fatal errors", async () => {
			mockConnect.mockImplementationOnce(() => {
				throw new Error("Fatal connection error");
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(result.error).toBe("Fatal connection error");
			expect(result.groups).toEqual([]);
		});

		it("should use custom logger when provided", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
				]);
			});

			const logger = vi.fn();
			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				logger,
			};

			await waitForConsumers(config);

			expect(logger).toHaveBeenCalled();
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("Waiting for consumer groups"));
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("All consumer groups ready"));
		});

		it("should use default brokers when not provided", async () => {
			delete process.env.REDPANDA_BROKERS;

			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
			};

			await waitForConsumers(config);

			expect(mockConnect).toHaveBeenCalled();
		});

		it("should respect minMembers requirement", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }], // Only 1 member
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				minMembers: 2, // Require 2 members
				pollIntervalMs: 50,
				timeoutMs: 100,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(result.groups[0].isReady).toBe(false);
			expect(result.groups[0].memberCount).toBe(1);
		});

		it("should handle groups with null members array", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.UNKNOWN,
						members: null as any,
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
			};

			const logger = vi.fn();
			const configWithLogger = { ...config, logger, pollIntervalMs: 50, timeoutMs: 100 };

			const result = await waitForConsumers(configWithLogger);

			expect(result.groups[0].memberCount).toBe(0);
		});

		it("should handle all consumer group states correctly", async () => {
			const states = [
				ConsumerGroupStates.UNKNOWN,
				ConsumerGroupStates.PREPARING_REBALANCE,
				ConsumerGroupStates.COMPLETING_REBALANCE,
				ConsumerGroupStates.STABLE,
				ConsumerGroupStates.DEAD,
				ConsumerGroupStates.EMPTY,
			];

			for (const state of states) {
				mockDescribeGroups.mockImplementationOnce((_groupIds, _options, callback) => {
					callback(null, [
						{
							groupId: "group1",
							state,
							members: state === ConsumerGroupStates.STABLE ? [{ id: "member1" }] : [],
						},
					]);
				});

				const config: WaitForConsumersConfig = {
					groupIds: ["group1"],
					pollIntervalMs: 10,
					timeoutMs: 50,
				};

				const result = await waitForConsumers(config);

				if (state === ConsumerGroupStates.STABLE) {
					expect(result.success).toBe(true);
				} else {
					expect(result.success).toBe(false);
				}
			}
		});

		it("should handle disconnect errors gracefully", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
				]);
			});

			mockDisconnect.mockImplementationOnce(() => {
				throw new Error("Disconnect failed");
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
			};

			// Should not throw
			await expect(waitForConsumers(config)).resolves.toBeDefined();
		});

		it("should attempt disconnect on fatal error", async () => {
			mockDescribeGroups.mockImplementation(() => {
				throw new Error("Fatal error");
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(mockDisconnect).toHaveBeenCalled();
		});
	});

	describe("checkConsumerGroups", () => {
		it("should return empty array when no groups specified", async () => {
			const result = await checkConsumerGroups([]);

			expect(result).toEqual([]);
			expect(mockConnect).not.toHaveBeenCalled();
		});

		it("should return status for all groups", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
					{
						groupId: "group2",
						state: ConsumerGroupStates.EMPTY,
						members: [],
					},
				]);
			});

			const result = await checkConsumerGroups(["group1", "group2"]);

			expect(result).toHaveLength(2);
			expect(result[0].groupId).toBe("group1");
			expect(result[0].state).toBe(ConsumerGroupStates.STABLE);
			expect(result[0].stateName).toBe("STABLE");
			expect(result[0].memberCount).toBe(1);
			expect(result[0].isReady).toBe(true);

			expect(result[1].groupId).toBe("group2");
			expect(result[1].state).toBe(ConsumerGroupStates.EMPTY);
			expect(result[1].stateName).toBe("EMPTY");
			expect(result[1].memberCount).toBe(0);
			expect(result[1].isReady).toBe(false);

			expect(mockConnect).toHaveBeenCalled();
			expect(mockDisconnect).toHaveBeenCalled();
		});

		it("should use custom brokers when provided", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
				]);
			});

			await checkConsumerGroups(["group1"], "custom-broker:9092");

			expect(mockConnect).toHaveBeenCalled();
		});

		it("should disconnect even if describeGroups fails", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(new Error("Failed"), []);
			});

			await expect(checkConsumerGroups(["group1"])).rejects.toThrow("Failed");

			expect(mockDisconnect).toHaveBeenCalled();
		});

		it("should handle groups with unknown state names", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: 999 as any, // Invalid state
						members: [],
					},
				]);
			});

			const result = await checkConsumerGroups(["group1"]);

			expect(result[0].stateName).toBe("UNKNOWN");
		});

		it("should handle non-Error poll errors", async () => {
			let callCount = 0;
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callCount++;
				if (callCount === 1) {
					// First call: string error (not Error instance)
					callback("String error" as any, []);
				} else {
					// Second call: success
					callback(null, [
						{
							groupId: "group1",
							state: ConsumerGroupStates.STABLE,
							members: [{ id: "member1" }],
						},
					]);
				}
			});

			const logger = vi.fn();
			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				pollIntervalMs: 10,
				timeoutMs: 5000,
				logger,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(true);
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("Poll error (retrying)"));
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("String error"));
		});

		it("should handle non-Error fatal errors", async () => {
			mockConnect.mockImplementationOnce(() => {
				throw "String fatal error";
			});

			const logger = vi.fn();
			const config: WaitForConsumersConfig = {
				groupIds: ["group1"],
				logger,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(result.error).toBe("String fatal error");
			expect(result.groups).toEqual([]);
			expect(logger).toHaveBeenCalledWith(expect.stringContaining("Fatal error"));
		});

		it("should handle all non-ready groups in timeout message", async () => {
			mockDescribeGroups.mockImplementation((_groupIds, _options, callback) => {
				callback(null, [
					{
						groupId: "group1",
						state: ConsumerGroupStates.PREPARING_REBALANCE,
						members: [],
					},
					{
						groupId: "group2",
						state: ConsumerGroupStates.EMPTY,
						members: [],
					},
					{
						groupId: "group3",
						state: ConsumerGroupStates.STABLE,
						members: [{ id: "member1" }],
					},
				]);
			});

			const config: WaitForConsumersConfig = {
				groupIds: ["group1", "group2", "group3"],
				pollIntervalMs: 50,
				timeoutMs: 100,
			};

			const result = await waitForConsumers(config);

			expect(result.success).toBe(false);
			expect(result.error).toContain("group1");
			expect(result.error).toContain("group2");
			expect(result.error).not.toContain("group3"); // group3 is ready
		});
	});
});
