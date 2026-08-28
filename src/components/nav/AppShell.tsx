"use client";

import Link from "next/link";
import { Container } from "react-bootstrap";
import BottomNav from "./BottomNav";
import SidebarNav from "./SidebarNav";
import UserMenu from "./UserMenu";
import { useSidebarCollapsed } from "./sidebarState";
import { ChevronsLeftIcon, ChevronsRightIcon } from "./icons";

/**
 * The two-surface app chrome: a slim top bar (wordmark + avatar menu) and a
 * collapsible left sidebar holding the primary destinations.
 *
 * Layout is a sticky top bar over a flex row of [sidebar, main]. The sidebar
 * is `position: sticky` inside that row rather than `position: fixed`, so it
 * occupies a real column and main content simply flows beside it — no
 * margin-left compensation to keep in sync, and nothing that can overlap.
 *
 * Below 768px (the same breakpoint at which the /plan dashboard stops being a
 * grid, DASHBOARD_STACK_BREAKPOINT) the column would leave too little room for
 * content, so the sidebar leaves the flow entirely and the same destinations
 * appear in a fixed bottom bar instead (BottomNav).
 *
 * That bar replaced an off-canvas drawer. The drawer cost two taps to reach
 * anywhere and hid the current location behind a hamburger; a bottom bar keeps
 * all four destinations and the active one permanently visible, within thumb
 * reach rather than in the top corner. It is also what the platform's own apps
 * do, so it needs no explaining.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <div className="pickl-shell">
      <header className="pickl-topbar">
        <div className="pickl-topbar-inner">
          <Link href="/plan" className="pickl-brand">
            🥒 Pickl
          </Link>

          <div className="ms-auto d-flex align-items-center">
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="pickl-shell-body">
        {/* Hidden below md; the drawer below takes over there. */}
        <nav className="pickl-sidebar" id="pickl-sidebar-nav" aria-label="Primary">
          <SidebarNav />
          <div className="pickl-sidebar-foot">
            <button
              type="button"
              className="pickl-icon-btn pickl-sidebar-toggle"
              onClick={toggle}
              // aria-expanded describes the sidebar this button controls.
              aria-expanded={!collapsed}
              aria-controls="pickl-sidebar-nav"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronsRightIcon size={18} />
              ) : (
                <ChevronsLeftIcon size={18} />
              )}
            </button>
          </div>
        </nav>

        <main className="pickl-main">
          <Container fluid="lg" className="py-4 pb-5">
            {children}
          </Container>
        </main>
      </div>

      {/* Hidden above md, where the sidebar is doing this job. */}
      <BottomNav />
    </div>
  );
}
