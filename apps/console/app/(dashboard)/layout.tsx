import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamingProvider } from "@/lib/streaming-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<StreamingProvider>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<SiteHeader />
					<main className="flex-1 p-6">{children}</main>
				</SidebarInset>
			</SidebarProvider>
		</StreamingProvider>
	);
}
