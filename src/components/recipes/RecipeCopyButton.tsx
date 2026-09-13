"use client";

import { useState } from "react";
import { Alert, Button } from "react-bootstrap";
import RecipeBulkConfirm, { type BulkRequest } from "@/components/recipes/RecipeBulkConfirm";

/**
 * "Copy to…" on a single recipe's own page.
 *
 * Not a separate copy path: it opens the same confirmation the recipe list
 * uses, with a selection of one, so a single copy and a bulk copy are checked
 * and described by exactly the same server code.
 */
export default function RecipeCopyButton({
  recipeId,
  target,
}: {
  recipeId: string;
  target: "private" | "shared";
}) {
  const [request, setRequest] = useState<BulkRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const label = target === "private" ? "Copy to my Secret Stash" : "Copy to the House Jar";

  return (
    <>
      {notice && (
        <Alert variant="success" dismissible onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={() => {
          setNotice(null);
          setRequest({ action: "copy", ids: [recipeId], target });
        }}
      >
        {label}
      </Button>
      <RecipeBulkConfirm
        request={request}
        onClose={() => setRequest(null)}
        onDone={(summary) => {
          setRequest(null);
          setNotice(
            summary.ok > 0
              ? `Copied to ${target === "private" ? "your Secret Stash" : "the House Jar"}. This page is still the original.`
              : summary.rows[0]?.reason ?? "Nothing was copied."
          );
        }}
      />
    </>
  );
}
