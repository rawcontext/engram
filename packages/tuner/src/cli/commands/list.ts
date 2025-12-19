/**
 * List command - List all studies
 */

import { TunerClient } from "../../client/tuner-client.js";

interface ListOptions {
	serviceUrl: string;
	format: "table" | "json";
}

export async function listCommand(options: ListOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	try {
		const studies = await client.listStudies();

		if (options.format === "json") {
			console.log(JSON.stringify(studies, null, 2));
			return;
		}

		// Table format
		if (studies.length === 0) {
			console.log("\nNo studies found.\n");
			console.log("Create one with: engram-tuner optimize --dataset <path>");
			return;
		}

		console.log(`\n📚 Studies (${studies.length})\n`);

		// Calculate column widths
		const nameWidth = Math.max("Name".length, ...studies.map((s) => s.study_name.length));

		// Header
		console.log(
			`  ${"Name".padEnd(nameWidth)}  ${"Trials".padStart(7)}  ${"Direction".padEnd(20)}  Best Value`,
		);
		console.log(`  ${"-".repeat(nameWidth)}  ${"-".repeat(7)}  ${"-".repeat(20)}  ----------`);

		// Rows
		for (const study of studies) {
			const direction =
				typeof study.direction === "string" ? study.direction : study.direction.join(", ");

			const bestValue = study.best_value !== null ? JSON.stringify(study.best_value) : "-";

			console.log(
				`  ${study.study_name.padEnd(nameWidth)}  ${String(study.n_trials).padStart(7)}  ${direction.padEnd(20)}  ${bestValue}`,
			);
		}

		console.log();
	} catch (error) {
		console.error("Error listing studies:", error);
		process.exit(1);
	}
}
