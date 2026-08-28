"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIDEBAR_ITEMS, isItemActive } from "./navItems";

/**
 * Phone navigation: the primary destinations as a fixed bar along the bottom.
 *
 * Replaces the off-canvas drawer below 768px. The drawer cost two taps to
 * reach anywhere (open, then choose) and hid where you currently were; a
 * bottom bar shows all four destinations and the active one at all times, and
 * sits within thumb reach rather than at the top corner of the screen.
 *
 * Renders from SIDEBAR_ITEMS, the same array the desktop sidebar uses, so the
 * two can never list different destinations.
 */
export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="pickl-bottomnav" aria-label="Primary">
      {SIDEBAR_ITEMS.map((item) => {
        const active = isItemActive(item, pathname);
        const { Icon } = item;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`pickl-bottomnav-item${active ? " active" : ""}`}
            // The bar is the only nav on a phone, so the current page needs to
            // be announced, not just coloured.
            aria-current={active ? "page" : undefined}
          >
            <Icon size={22} />
            <span className="pickl-bottomnav-label">
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
