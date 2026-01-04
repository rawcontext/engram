"use client";

import { ContainerList } from "@/components/dashboard/container-list";
import { DatabaseStatusPanels } from "@/components/dashboard/database-status-panels";
import { VersionMatrix } from "../../components/VersionMatrix";

export default function InfrastructurePage() {
	return (
		<div className="space-y-6 animate-fade-in">
			{/* Page Header */}
			<div>
				<h1 className="font-display text-2xl text-foreground">Infrastructure</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Database health, containers, and service versions
				</p>
			</div>

			{/* Database Status Panels */}
			<DatabaseStatusPanels pollInterval={10000} showHeader={true} />

			{/* Container List */}
			<ContainerList pollInterval={5000} showHeader={true} showAll={true} />

			{/* Version Matrix */}
			<VersionMatrix showHeader={true} filterType="all" />
		</div>
	);
}
