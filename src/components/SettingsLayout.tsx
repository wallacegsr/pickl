"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Col, Nav, Row } from "react-bootstrap";

export interface SettingsSection {
  /** Stable URL-safe key, used as the `?section=` value. */
  key: string;
  label: string;
  element: React.ReactNode;
}

const SECTION_PARAM = "section";

/**
 * Two-column settings shell: a vertical pill nav of sections on the left, the
 * active section's panel on the right. Used by both /admin and /preferences.
 *
 * The active section lives in the URL (`?section=`) rather than in component
 * state so that sections are deep-linkable and the browser Back button steps
 * between them. Both consuming pages already load all their data server-side
 * in one pass, so there is nothing to re-fetch on a section change — the query
 * param is purely a client-side view selector (hence `router.push` with
 * `scroll: false`, which does not re-run the server component).
 *
 * Only the active section's element is rendered. The inactive elements are
 * already-constructed React elements passed in as props, so this is a plain
 * conditional render — no lazy-loading machinery involved.
 */
function SettingsLayoutInner({
  sections,
  ariaLabel = "Settings sections",
}: {
  sections: SettingsSection[];
  ariaLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(SECTION_PARAM);
  // Unknown or missing key falls back to the first section rather than
  // rendering nothing, so a stale/typo'd deep link still shows something.
  const active =
    sections.find((section) => section.key === requested) ?? sections[0];

  function selectSection(key: string) {
    if (key === active?.key) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(SECTION_PARAM, key);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (!active) return null;

  return (
    <Row className="g-4">
      {/* Full width below md so the nav stacks above the panel instead of
          being squashed into an unreadable column on phones. */}
      <Col xs={12} md={3} lg={3}>
        <Nav
          variant="pills"
          className="flex-column"
          activeKey={active.key}
          as="nav"
          aria-label={ariaLabel}
        >
          {sections.map((section) => (
            <Nav.Link
              key={section.key}
              as="button"
              type="button"
              eventKey={section.key}
              active={section.key === active.key}
              aria-current={section.key === active.key ? "page" : undefined}
              onClick={() => selectSection(section.key)}
              className="text-start mb-1"
            >
              {section.label}
            </Nav.Link>
          ))}
        </Nav>
      </Col>
      <Col xs={12} md={9} lg={9}>
        {active.element}
      </Col>
    </Row>
  );
}

export default function SettingsLayout(props: {
  sections: SettingsSection[];
  ariaLabel?: string;
}) {
  // useSearchParams() suspends; the boundary keeps it from opting the whole
  // route out of prerendering during `next build`.
  return (
    <Suspense fallback={null}>
      <SettingsLayoutInner {...props} />
    </Suspense>
  );
}
