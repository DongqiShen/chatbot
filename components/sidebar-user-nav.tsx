"use client";

import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut, useSession } from "@/lib/client";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

export function SidebarUserNav({
  user,
}: {
  user: { email?: string | null; isAnonymous?: boolean | null };
}) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { data, isPending } = useSession();
  const { setTheme, resolvedTheme } = useTheme();

  const isGuest = data?.user?.isAnonymous ?? user.isAnonymous ?? false;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isPending ? (
              <SidebarMenuButton
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                size="lg"
              >
                <div className="size-8 animate-pulse rounded-full bg-neutral-500/30" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="animate-pulse rounded-md bg-neutral-500/30 text-transparent">
                    Loading
                  </span>
                </div>
                <div className="ml-auto animate-spin text-neutral-500">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                data-testid="user-nav-button"
                size="lg"
              >
                <Image
                  alt={user.email ?? "User Avatar"}
                  className="size-8 rounded-full"
                  height={32}
                  src={`https://avatar.vercel.sh/${user.email}`}
                  width={32}
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span
                    className="truncate font-medium"
                    data-testid="user-email"
                  >
                    {isGuest ? "Guest" : user?.email}
                  </span>
                </div>
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            data-testid="user-nav-menu"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuItem
              className="cursor-pointer"
              data-testid="user-nav-item-theme"
              onSelect={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              {resolvedTheme === "light" ? <Moon /> : <Sun />}
              {`Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="w-full cursor-pointer"
                onClick={() => {
                  if (isPending) {
                    toast({
                      type: "error",
                      description:
                        "Checking authentication status, please try again!",
                    });

                    return;
                  }

                  if (isGuest) {
                    router.push("/login");
                  } else {
                    signOut({
                      fetchOptions: {
                        onSuccess: () => {
                          router.push("/");
                          router.refresh();
                        },
                      },
                    });
                  }
                }}
                type="button"
              >
                {isGuest ? <LogIn /> : <LogOut />}
                {isGuest ? "Login to your account" : "Sign out"}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
