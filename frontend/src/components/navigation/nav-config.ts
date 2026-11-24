import {
  BarChart3,
  ChartLine,
  ClipboardList,
  Coins,
  Gift,
  History,
  LayoutDashboard,
  PenLine,
  ScrollText,
  Settings,
  Target,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Match only the exact path (for section roots like /admin). */
  exact?: boolean;
};

export type NavSection = { label?: string; items: NavItem[] };

export type NavVariant = "admin" | "employee";

export const NAVIGATION: Record<NavVariant, NavSection[]> = {
  admin: [
    {
      items: [
        { title: "Overview", href: "/admin", icon: LayoutDashboard, exact: true },
        { title: "Employees", href: "/admin/employees", icon: Users },
      ],
    },
    {
      label: "Performance",
      items: [
        { title: "Submissions", href: "/admin/submissions", icon: ClipboardList },
        { title: "Goals & Scoring", href: "/admin/goals", icon: Target },
        { title: "Leaderboard", href: "/admin/leaderboard", icon: Trophy },
        { title: "Reports", href: "/admin/reports", icon: BarChart3 },
        { title: "Points", href: "/admin/points", icon: Coins },
        { title: "Rewards", href: "/admin/rewards", icon: Gift },
      ],
    },
    // {
    //   label: "System",
    //   items: [
    //     { title: "Audit log", href: "/admin/audit", icon: ScrollText },
    //     { title: "Settings", href: "/admin/settings", icon: Settings },
    //   ],
    // },
  ],
  employee: [
    {
      items: [
        { title: "Dashboard", href: "/employee", icon: LayoutDashboard, exact: true },
        { title: "Daily Entry", href: "/employee/daily-entry", icon: PenLine },
        { title: "My Goals", href: "/employee/goals", icon: Target },
        { title: "My Progress", href: "/employee/progress", icon: ChartLine },
        { title: "Leaderboard", href: "/employee/leaderboard", icon: Trophy },
        { title: "My Points", href: "/employee/points", icon: Coins },
        { title: "Rewards", href: "/employee/rewards", icon: Gift },
        { title: "My History", href: "/employee/history", icon: History },
      ],
    },
    {
      label: "Account",
      items: [{ title: "Profile", href: "/profile", icon: UserRound }],
    },
  ],
};

export function isNavItemActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
