import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<Sidebar />
			<Header />
			<main className="ml-[var(--sidebar-width)] pt-[var(--header-height)] min-h-screen relative z-10">
				<div className="p-6">{children}</div>
			</main>
		</>
	);
}
