"use client";

import { ChevronsUpDown, LogOut, User } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut, useSession } from "@/lib/auth-client";

export function NavUser() {
	const { isMobile } = useSidebar();
	const { data: session, isPending } = useSession();
	const [isHydrated, setIsHydrated] = useState(false);

	// Wait for hydration to avoid server/client mismatch
	useEffect(() => {
		setIsHydrated(true);
	}, []);

	// Show skeleton during SSR and initial hydration
	if (!isHydrated || isPending) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" className="cursor-default">
						<Skeleton className="h-8 w-8 rounded-lg" />
						<div className="grid flex-1 gap-1">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-3 w-28" />
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	const handleSignOut = async () => {
		await signOut({ fetchOptions: { onSuccess: () => window.location.assign("/login") } });
	};

	const user = session?.user;
	const initials = user?.name?.charAt(0).toUpperCase() || "U";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<Avatar className="h-8 w-8 rounded-lg">
								{user?.image ? (
									<Image
										src={user.image}
										alt={user.name || "User"}
										width={32}
										height={32}
										className="rounded-lg"
										unoptimized
									/>
								) : (
									<AvatarFallback className="rounded-lg bg-gradient-to-br from-[rgb(var(--console-blue))] to-[rgb(var(--console-purple))]">
										{user?.name ? (
											<span className="text-xs font-medium text-white">{initials}</span>
										) : (
											<User className="h-4 w-4 text-white" />
										)}
									</AvatarFallback>
								)}
							</Avatar>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user?.name || "User"}</span>
								<span className="truncate text-xs text-muted-foreground">{user?.email || ""}</span>
							</div>
							<ChevronsUpDown className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<Avatar className="h-8 w-8 rounded-lg">
									{user?.image ? (
										<Image
											src={user.image}
											alt={user.name || "User"}
											width={32}
											height={32}
											className="rounded-lg"
											unoptimized
										/>
									) : (
										<AvatarFallback className="rounded-lg bg-gradient-to-br from-[rgb(var(--console-blue))] to-[rgb(var(--console-purple))]">
											{user?.name ? (
												<span className="text-xs font-medium text-white">{initials}</span>
											) : (
												<User className="h-4 w-4 text-white" />
											)}
										</AvatarFallback>
									)}
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user?.name || "User"}</span>
									<span className="truncate text-xs text-muted-foreground">
										{user?.email || ""}
									</span>
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={handleSignOut} className="text-destructive">
							<LogOut className="mr-2 h-4 w-4" />
							Sign out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
