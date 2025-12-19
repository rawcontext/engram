/**
 * GCE Infrastructure Tests
 *
 * Tests for GPU-enabled GCE resources:
 * - Benchmark VM with NVIDIA L4 GPU
 * - Service Account with IAM bindings
 * - Firewall rules and networking
 */

import { describe, expect, it } from "vitest";
import * as gce from "./gce";
import { getOutputValue, getResource, getResourcesByType } from "./testing";

describe("GCE Infrastructure", () => {
	describe("Benchmark VM Configuration", () => {
		it("should export benchmark VM config", () => {
			expect(gce.benchmarkVmConfig).toBeDefined();
			expect(gce.benchmarkVmConfig.machineType).toBe("g2-standard-8");
			expect(gce.benchmarkVmConfig.zone).toBe("us-central1-a");
			expect(gce.benchmarkVmConfig.gpuType).toBe("nvidia-l4");
			expect(gce.benchmarkVmConfig.gpuCount).toBe(1);
		});

		it("should default to disabled", () => {
			expect(gce.benchmarkVmConfig.enabled).toBe(false);
		});
	});

	describe("When VM is disabled", () => {
		it("should not create VM when disabled", () => {
			// When benchmarkVmEnabled is false (default), VM resources should be undefined
			if (!gce.benchmarkVmConfig.enabled) {
				expect(gce.benchmarkVm).toBeUndefined();
				expect(gce.benchmarkVmServiceAccount).toBeUndefined();
				expect(gce.benchmarkVmAddress).toBeUndefined();
				expect(gce.benchmarkVmFirewall).toBeUndefined();
			}
		});

		it("should export helpful message when disabled", async () => {
			if (!gce.benchmarkVmConfig.enabled) {
				const sshCmd = await getOutputValue(gce.benchmarkVmSshCommand);
				expect(sshCmd).toContain("not enabled");
			}
		});
	});

	// These tests only run when the VM is enabled
	// Run with: pulumi config set benchmarkVmEnabled true
	describe("When VM is enabled", () => {
		const skipIfDisabled = gce.benchmarkVmConfig.enabled ? it : it.skip;

		skipIfDisabled("should create a GCE Instance", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			expect(vm).toBeDefined();
		});

		skipIfDisabled("should use G2 machine type for L4 GPU", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			expect(vm?.inputs.machineType).toBe("g2-standard-8");
		});

		skipIfDisabled("should configure L4 GPU accelerator", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			const accelerators = vm?.inputs.guestAccelerators as Array<{
				type: string;
				count: number;
			}>;
			expect(accelerators?.[0]?.type).toContain("nvidia-l4");
			expect(accelerators?.[0]?.count).toBe(1);
		});

		skipIfDisabled("should use Deep Learning VM image with CUDA", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			const bootDisk = vm?.inputs.bootDisk as { initializeParams: { image: string } };
			expect(bootDisk?.initializeParams?.image).toContain("deeplearning-platform");
			expect(bootDisk?.initializeParams?.image).toContain("cu121");
		});

		skipIfDisabled("should set onHostMaintenance to TERMINATE for GPU", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			const scheduling = vm?.inputs.scheduling as { onHostMaintenance: string };
			expect(scheduling?.onHostMaintenance).toBe("TERMINATE");
		});

		skipIfDisabled("should have startup script", () => {
			const vm = getResource("gcp:compute/instance:Instance", "benchmark-vm");
			expect(vm?.inputs.metadataStartupScript).toBeDefined();
		});

		skipIfDisabled("should create service account", () => {
			const sa = getResource("gcp:serviceaccount/account:Account", "benchmark-vm-sa");
			expect(sa).toBeDefined();
			expect(sa?.inputs.accountId).toBe("benchmark-vm");
		});

		skipIfDisabled("should create firewall rule for SSH", () => {
			const firewall = getResource("gcp:compute/firewall:Firewall", "benchmark-vm-ssh");
			expect(firewall).toBeDefined();
			const allows = firewall?.inputs.allows as Array<{ protocol: string; ports: string[] }>;
			expect(allows?.[0]?.protocol).toBe("tcp");
			expect(allows?.[0]?.ports).toContain("22");
		});

		skipIfDisabled("should create static IP address", () => {
			const address = getResource("gcp:compute/address:Address", "benchmark-vm-ip");
			expect(address).toBeDefined();
			expect(address?.inputs.addressType).toBe("EXTERNAL");
		});
	});

	describe("Exports", () => {
		it("should export SSH command", () => {
			expect(gce.benchmarkVmSshCommand).toBeDefined();
		});

		it("should export run command", () => {
			expect(gce.benchmarkVmRunCommand).toBeDefined();
		});

		it("should export status command", () => {
			expect(gce.benchmarkVmStatusCommand).toBeDefined();
		});
	});
});
