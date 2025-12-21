/**
 * Delete command - Delete a study
 */

import { TunerClient } from "../../client/tuner-client.js";

interface DeleteOptions {
	serviceUrl: string;
	force?: boolean;
}

export async function deleteCommand(studyName: string, options: DeleteOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	// Confirm deletion unless --force is used
	if (!options.force) {
		console.log(
			`\n⚠️  Warning: This will permanently delete study '${studyName}' and all its trials.\n`,
		);
		console.log("Use --force to skip this confirmation.\n");
		process.exit(0);
	}

	try {
		await client.deleteStudy(studyName);
		console.log(`\n✓ Deleted study: ${studyName}\n`);
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
