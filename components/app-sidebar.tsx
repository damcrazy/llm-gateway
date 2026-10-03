"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ActivityIcon,
  BellIcon,
  BoxesIcon,
  ColumnsIcon,
  ChevronsUpDownIcon,
  CpuIcon,
  GaugeIcon,
  FlaskConicalIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  RouteIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldCheckIcon,
  UsersIcon,
  WaypointsIcon,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { SessionMember } from "@/lib/auth"
import type { MemberRole } from "@/lib/db/types"
import { signOut } from "@/app/login/actions"

type Access = "member" | "admin" | "superadmin"

const NAV: {
  label: string
  items: {
    title: string
    href: string
    icon: typeof ServerIcon
    access: Access
  }[]
}[] = [
  {
    label: "Monitor",
    items: [
      {
        title: "Overview",
        href: "/",
        icon: LayoutDashboardIcon,
        access: "member",
      },
      { title: "Logs", href: "/logs", icon: ScrollTextIcon, access: "member" },
      {
        title: "Latency",
        href: "/latency",
        icon: GaugeIcon,
        access: "member",
      },
      { title: "Alerts", href: "/alerts", icon: BellIcon, access: "member" },
      {
        title: "Audit log",
        href: "/audit",
        icon: HistoryIcon,
        access: "member",
      },
      {
        title: "Playground",
        href: "/playground",
        icon: FlaskConicalIcon,
        access: "member",
      },
      {
        title: "Compare",
        href: "/compare",
        icon: ColumnsIcon,
        access: "member",
      },
    ],
  },
  {
    label: "Configure",
    items: [
      {
        title: "Apps & keys",
        href: "/apps",
        icon: BoxesIcon,
        access: "member",
      },
      { title: "Models", href: "/models", icon: CpuIcon, access: "member" },
      {
        title: "Providers",
        href: "/providers",
        icon: ServerIcon,
        access: "member",
      },
      { title: "Routes", href: "/routes", icon: RouteIcon, access: "admin" },
      {
        title: "Prompts",
        href: "/prompts",
        icon: MessageSquareTextIcon,
        access: "member",
      },
      {
        title: "Tracing",
        href: "/tracing",
        icon: ActivityIcon,
        access: "member",
      },
    ],
  },
  {
    label: "Access",
    items: [
      {
        title: "Members",
        href: "/members",
        icon: UsersIcon,
        access: "superadmin",
      },
    ],
  },
]

const ROLE_LABELS: Record<MemberRole, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  member: "Member",
}

function canSee(role: MemberRole, access: Access) {
  if (access === "member") return true
  if (access === "admin") return role === "admin" || role === "superadmin"
  return role === "superadmin"
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

export function AppSidebar({
  member,
}: {
  member: Pick<SessionMember, "email" | "name" | "avatarUrl" | "role">
}) {
  const pathname = usePathname()
  const router = useRouter()
  const initials = (member.name ?? member.email).slice(0, 2).toUpperCase()
  const nav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(member.role, item.access)),
  })).filter((group) => group.items.length > 0)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <WaypointsIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">LLM Gateway</span>
                  <span className="truncate text-xs text-muted-foreground">
                    One API, every provider
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(pathname, item.href)}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    {member.avatarUrl && (
                      <AvatarImage src={member.avatarUrl} alt="" />
                    )}
                    <AvatarFallback className="rounded-lg">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {member.name ?? member.email}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[member.role]}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {member.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/account")}>
                  <ShieldCheckIcon />
                  Account &amp; security
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOutIcon />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
