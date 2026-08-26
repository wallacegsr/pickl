"use client";

import Link from "next/link";
import { useState } from "react";
import { Container, Offcanvas } from "react-bootstrap";
import SidebarNav from "./SidebarNav";
import UserMenu from "./UserMenu";
import { useSidebarCollapsed } from "./sidebarState";
import { ChevronsLeftIcon, ChevronsRightIcon, MenuIcon } from "./icons";

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
 * content, so the sidebar leaves the flow entirely and becomes an off-canvas
 * drawer opened from a button in the top bar. A drawer rather than a permanent
 * rail because the rail's icons alone are a poor way to navigate on a phone,
 * and the drawer gets focus trapping and Escape-to-close from Offcanvas.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="pickl-shell">
      <header className="pickl-topbar">
        <div className="pickl-topbar-inner">
          <button
            type="button"
            className="pickl-icon-btn pickl-drawer-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="pickl-nav-drawer"
          >
            <MenuIcon size={20} />
          </button>

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
              <span className="pickl-sidebar-label">Collapse</span>
            </button>
          </div>
        </nav>

        <main className="pickl-main">
          <Container fluid="lg" className="py-4 pb-5">
            {children}
          </Container>
        </main>
      </div>

      <Offcanvas
        id="pickl-nav-drawer"
        show={drawerOpen}
        onHide={() => setDrawerOpen(false)}
        placement="start"
        className="pickl-drawer"
        aria-label="Primary navigation"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>🥒 Pickl</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="px-2">
          {/* Always full-width labels in the drawer, whatever the desktop
              rail's collapsed state happens to be. */}
          <div className="pickl-drawer-nav">
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}
