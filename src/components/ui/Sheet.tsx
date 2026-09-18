"use client";

import type { ReactNode } from "react";
import { Modal, Spinner } from "react-bootstrap";

/**
 * A dialog that is a bottom sheet on a phone and a centred dialog at a desk.
 *
 * The header is three slots — cancel, title, action — rather than a title bar
 * with buttons banished to a footer. On a phone that puts both decisions
 * within a thumb's reach of the top edge, and it lets the title carry the
 * state ("2 chosen") instead of a labelled row inside the body.
 *
 * The primary action also repeats as a full-width button at the bottom when
 * `footerAction` is set, because a sheet's bottom edge is where a thumb
 * already is.
 *
 * Chrome only: what a sheet contains, and what its buttons do, is the caller's
 * business. See .pickl-sheet in globals.css for the phone treatment.
 */
export default function Sheet({
  show,
  title,
  subtitle,
  onClose,
  onAction,
  actionLabel = "Save",
  /** "danger" for an action that destroys something. */
  actionVariant = "primary",
  /** The bottom button's label, when it can afford more words than the header. */
  footerActionLabel,
  actionDisabled,
  busy,
  footerAction = true,
  footerNote,
  toolbar,
  children,
}: {
  show: boolean;
  title: ReactNode;
  /** The state of what's on screen — "17 Sep · 2 chosen", say. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** Omitted for a sheet that only shows things. */
  onAction?: () => void;
  actionLabel?: string;
  actionVariant?: "primary" | "danger";
  footerActionLabel?: string;
  actionDisabled?: boolean;
  busy?: boolean;
  /** Repeat the action as a full-width button at the bottom. */
  footerAction?: boolean;
  footerNote?: ReactNode;
  /** Pinned under the header: a search box, chips — whatever doesn't scroll. */
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      show={show}
      onHide={busy ? () => undefined : onClose}
      dialogClassName="pickl-sheet"
      contentClassName="pickl-sheet-content"
      scrollable
    >
      <div className="pickl-sheet-head">
        <button type="button" className="pickl-sheet-link" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <div className="pickl-sheet-title">
          <div className="pickl-sheet-title-main">{title}</div>
          {subtitle && <div className="pickl-sheet-title-sub">{subtitle}</div>}
        </div>
        {onAction ? (
          <button
            type="button"
            className={`pickl-sheet-link fw-semibold${actionVariant === "danger" ? " text-danger" : ""}`}
            onClick={onAction}
            disabled={actionDisabled || busy}
          >
            {busy ? <Spinner animation="border" size="sm" /> : actionLabel}
          </button>
        ) : (
          <span />
        )}
      </div>

      {toolbar && <div className="pickl-sheet-toolbar">{toolbar}</div>}

      <Modal.Body className="pickl-sheet-body">{children}</Modal.Body>

      {onAction && footerAction && (
        <div className="pickl-sheet-foot">
          <button
            type="button"
            className={`btn btn-${actionVariant} w-100 pickl-sheet-save`}
            onClick={onAction}
            disabled={actionDisabled || busy}
          >
            {busy ? <Spinner animation="border" size="sm" /> : footerActionLabel ?? actionLabel}
          </button>
          {footerNote && <div className="pickl-sheet-note">{footerNote}</div>}
        </div>
      )}
    </Modal>
  );
}
