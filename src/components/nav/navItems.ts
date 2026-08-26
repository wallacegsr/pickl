import type React from "react";
import { BookIcon, CalendarIcon, JarIcon, TagIcon, type IconProps } from "./icons";

/**
 * The primary destinations in the left sidebar.
 *
 * This array is the ONLY place a sidebar destination is declared — the rail,
 * the expanded sidebar and the mobile drawer all render from it, so adding a
 * new one (Tags, say) is a single entry here and nothing else.
 *
 * `matchPrefix` drives active highlighting: /plan is an exact match because it
 * has no children, while /recipes and /reports own their subtrees (e.g.
 * /recipes/new must still light up "Recipes").
 */
export interface SidebarItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** Extra context, shown as the tooltip — the only label when collapsed. */
  description?: string;
  /** Highlight on any descendant route, not just an exact URL match. */
  matchPrefix?: boolean;
}

export const SIDEBAR_ITEMS: SidebarItem[] = [
  {
    href: "/plan",
    label: "Plan",
    Icon: CalendarIcon,
    description: "This week's meals and your dashboard widgets.",
  },
  {
    href: "/recipes",
    label: "Recipes",
    Icon: BookIcon,
    description: "Everything in the jar — shared and private recipes.",
    matchPrefix: true,
  },
  {
    href: "/tags",
    label: "Tags",
    Icon: TagIcon,
    description:
      "Rename, merge, delete or add the words you file recipes under.",
    matchPrefix: true,
  },
  {
    href: "/reports",
    label: "Past Preserves",
    Icon: JarIcon,
    description:
      "Meal history, how often each recipe gets planned, and the full change log.",
    matchPrefix: true,
  },
];

/** Whether `pathname` should highlight `item`. */
export function isItemActive(item: SidebarItem, pathname: string | null) {
  if (!pathname) return false;
  return item.matchPrefix ? pathname.startsWith(item.href) : pathname === item.href;
}
