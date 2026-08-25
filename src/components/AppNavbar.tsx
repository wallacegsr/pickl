"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Container, Nav, Navbar, Button } from "react-bootstrap";
import ThemeToggle from "@/components/ThemeToggle";

export default function AppNavbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  return (
    <Navbar bg="dark" variant="dark" expand="md" className="mb-4 shadow-sm">
      <Container>
        <Navbar.Brand as={Link} href="/plan">
          🥒 Pickl
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="main-navbar" />
        <Navbar.Collapse id="main-navbar">
          <Nav className="me-auto">
            <Nav.Link as={Link} href="/plan" active={pathname === "/plan"}>
              Plan
            </Nav.Link>
            <Nav.Link
              as={Link}
              href="/recipes"
              active={pathname?.startsWith("/recipes")}
            >
              Recipes
            </Nav.Link>
            <Nav.Link
              as={Link}
              href="/reports"
              active={pathname?.startsWith("/reports")}
              title="Meal history, how often each recipe gets planned, and the full change log."
            >
              Past Preserves
            </Nav.Link>
            <Nav.Link
              as={Link}
              href="/preferences"
              active={pathname?.startsWith("/preferences")}
            >
              Preferences
            </Nav.Link>
            {isAdmin && (
              <Nav.Link
                as={Link}
                href="/admin"
                active={pathname?.startsWith("/admin")}
                title="User accounts, SMTP email settings, and the Google Calendar integration."
              >
                Back of House
              </Nav.Link>
            )}
          </Nav>
          <div className="d-flex align-items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline-light"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Logout
            </Button>
          </div>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
