"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isItemActive, SIDEBAR_ITEMS } from "./navItems";

/**
 * The list of primary destinations, shared by the fixed desktop sidebar and
 * the mobile drawer. Rendered from SIDEBAR_ITEMS — adding a destination is one
 * entry in that array and nothing here.
 *
 * The label text is always in the DOM, even in the collapsed rail: it is
 * hidden with CSS (`.pickl-sidebar-label`) rather than removed, so the
 * accessible name of every link survives collapsing, and so the server and
 * client render identical markup regardless of the stored collapse state.
 * `title` gives sighted users a tooltip on the icon-only rail.
 */
export default function SidebarNav({
  onNavigate,
}: {
  /** Called after a link is followed — the drawer uses it to close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="pickl-sidebar-list list-unstyled mb-0">
      {SIDEBAR_ITEMS.map((item) => {
        const active = isItemActive(item, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`pickl-sidebar-link${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={item.description ? `${item.label} — ${item.description}` : item.label}
              onClick={onNavigate}
            >
              <item.Icon size={20} className="pickl-sidebar-icon" />
              <span className="pickl-sidebar-label">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
