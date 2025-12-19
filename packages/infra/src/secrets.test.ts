/**
 * Secret Management Tests
 *
 * Tests for Secret Manager secrets configuration.
 */

import { describe, expect, it } from "vitest";
// Import the infrastructure modules - mocks are already set up in vitest.setup.ts
import * as infra from "./secrets";
import { getResource, getResourcesByType } from "./testing";

/** Type for secret labels in GCP Secret Manager */
interface SecretLabels {
	project?: string;
	environment?: string;
	managedBy?: string;
}

describe("Secret Management", () => {
	describe("OpenAI API Key Secret", () => {
		it("should create an OpenAI API key secret", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "openai-api-key");
			expect(secretResource).toBeDefined();
		});

		it("should have the correct secret ID", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "openai-api-key");
			expect(secretResource?.inputs.secretId).toBe("openai-api-key");
		});

		it("should use automatic replication", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "openai-api-key");
			expect(secretResource?.inputs.replication).toEqual({ auto: {} });
		});

		it("should have common labels", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "openai-api-key");
			const labels = secretResource?.inputs.labels as SecretLabels;
			expect(labels).toBeDefined();
			expect(labels.project).toBe("engram");
			expect(labels.managedBy).toBe("pulumi");
		});
	});

	describe("Anthropic API Key Secret", () => {
		it("should create an Anthropic API key secret", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "anthropic-api-key");
			expect(secretResource).toBeDefined();
		});

		it("should have the correct secret ID", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "anthropic-api-key");
			expect(secretResource?.inputs.secretId).toBe("anthropic-api-key");
		});

		it("should use automatic replication", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "anthropic-api-key");
			expect(secretResource?.inputs.replication).toEqual({ auto: {} });
		});

		it("should have common labels", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "anthropic-api-key");
			const labels = secretResource?.inputs.labels as SecretLabels;
			expect(labels).toBeDefined();
			expect(labels.project).toBe("engram");
		});
	});

	describe("xAI API Key Secret", () => {
		it("should create an xAI API key secret", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "xai-api-key");
			expect(secretResource).toBeDefined();
		});

		it("should have the correct secret ID", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "xai-api-key");
			expect(secretResource?.inputs.secretId).toBe("xai-api-key");
		});

		it("should use automatic replication", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "xai-api-key");
			expect(secretResource?.inputs.replication).toEqual({ auto: {} });
		});

		it("should have common labels", () => {
			const secretResource = getResource("gcp:secretmanager/secret:Secret", "xai-api-key");
			const labels = secretResource?.inputs.labels as SecretLabels;
			expect(labels).toBeDefined();
			expect(labels.project).toBe("engram");
		});
	});

	describe("Resource Count", () => {
		it("should create exactly 3 secrets", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");
			expect(secrets).toHaveLength(3);
		});

		it("should create secrets for all required API keys", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");
			const secretIds = secrets.map((s) => s.inputs.secretId);

			expect(secretIds).toContain("openai-api-key");
			expect(secretIds).toContain("anthropic-api-key");
			expect(secretIds).toContain("xai-api-key");
		});
	});

	describe("Labeling Consistency", () => {
		it("should apply consistent labels to all secrets", () => {
			const secrets = getResourcesByType("gcp:secretmanager/secret:Secret");

			for (const secret of secrets) {
				const labels = secret.inputs.labels as SecretLabels;
				expect(labels).toBeDefined();
				expect(labels.project).toBe("engram");
				expect(labels.environment).toBe("test"); // Test stack
				expect(labels.managedBy).toBe("pulumi");
			}
		});
	});

	describe("Exports", () => {
		it("should export openaiApiKeySecret", () => {
			expect(infra.openaiApiKeySecret).toBeDefined();
		});

		it("should export anthropicApiKeySecret", () => {
			expect(infra.anthropicApiKeySecret).toBeDefined();
		});

		it("should export xaiApiKeySecret", () => {
			expect(infra.xaiApiKeySecret).toBeDefined();
		});
	});
});
