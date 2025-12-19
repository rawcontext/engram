/**
 * Status command - Check optimization study status
 */

import { TunerClient } from "../../client/tuner-client.js";

interface StatusOptions {
	serviceUrl: string;
	format: "table" | "json";
}

export async function statusCommand(studyName: string, options: StatusOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	try {
		const study = await client.getStudy(studyName);

		if (options.format === "json") {
			console.log(JSON.stringify(study, null, 2));
			return;
		}

		// Table format
		console.log(`\n📊 Study: ${study.study_name}\n`);
		console.log(`  ID:         ${study.study_id}`);
		console.log(`  Direction:  ${JSON.stringify(study.direction)}`);
		console.log(`  Trials:     ${study.n_trials}`);

		if (study.best_value !== null) {
			console.log(`  Best Value: ${JSON.stringify(study.best_value)}`);
		}

		if (study.best_params) {
			console.log("\n  Best Parameters:");
			for (const [key, value] of Object.entries(study.best_params)) {
				console.log(`    ${key}: ${value}`);
			}
		}

		if (study.datetime_start) {
			console.log(`\n  Started: ${study.datetime_start}`);
		}

		// Get trial statistics
		const trials = await client.listTrials(studyName);
		const byState = trials.reduce(
			(acc, t) => {
				acc[t.state] = (acc[t.state] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		console.log("\n  Trial States:");
		for (const [state, count] of Object.entries(byState)) {
			console.log(`    ${state}: ${count}`);
		}

		console.log();
	} catch (error) {
		if (error instanceof Error && error.message.includes("404")) {
			console.error(`Error: Study '${studyName}' not found`);
		} else {
			console.error("Error:", error);
		}
		process.exit(1);
	}
}
