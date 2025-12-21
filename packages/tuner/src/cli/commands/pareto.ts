/**
 * Pareto command - Get Pareto front from a multi-objective study
 */

import { TunerClient } from "../../client/tuner-client.js";

interface ParetoOptions {
	serviceUrl: string;
	format: "table" | "json";
}

export async function paretoCommand(studyName: string, options: ParetoOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	try {
		const paretoFront = await client.getParetoFront(studyName);

		if (options.format === "json") {
			console.log(JSON.stringify(paretoFront, null, 2));
			return;
		}

		// Table format
		if (paretoFront.length === 0) {
			console.log("\nNo Pareto-optimal solutions found.\n");
			console.log("This is only applicable for multi-objective (pareto) studies.");
			return;
		}

		console.log(`\n📊 Pareto Front for: ${studyName}\n`);
		console.log(`  ${paretoFront.length} Pareto-optimal solutions\n`);

		// Header
		console.log(`  ${"Trial".padStart(6)}  ${"Values".padEnd(30)}  Parameters`);
		console.log(`  ${"-".repeat(6)}  ${"-".repeat(30)}  ----------`);

		// Rows
		for (const trial of paretoFront) {
			const values = JSON.stringify(trial.values);
			const params = JSON.stringify(trial.params);
			console.log(`  ${String(trial.trial_id).padStart(6)}  ${values.padEnd(30)}  ${params}`);
		}

		console.log();
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes("404")) {
				console.error(`Error: Study '${studyName}' not found`);
			} else {
				console.error("Error:", error.message);
			}
		} else {
			console.error("Error:", error);
		}
		process.exit(1);
	}
}
