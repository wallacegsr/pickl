"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Form, Nav, Spinner, Table } from "react-bootstrap";
import RecipeForm, { type RecipeFormValues } from "@/components/RecipeForm";
import type { ImportSummary } from "@/lib/recipeImport";

/**
 * The two ways a recipe gets into Pickl from somewhere else.
 *
 * They are deliberately different shapes, because the situations are:
 *
 *   - PASTE is one recipe a person has in front of them, and the parse is
 *     guesswork, so it ends in the ordinary recipe form for them to check. It
 *     saves through POST /api/recipes like anything typed by hand.
 *   - FILE is many recipes from a tool, already in Pickl's shape, so there is
 *     nothing to review one-by-one — it reports per row instead.
 */

type Pane = "paste" | "file";

export default function RecipeImport({
  isAdmin,
  existingTags,
}: {
  isAdmin: boolean;
  existingTags: string[];
}) {
  const [pane, setPane] = useState<Pane>("paste");

  return (
    <div>
      <Nav variant="tabs" activeKey={pane} className="mb-3">
        <Nav.Item>
          <Nav.Link eventKey="paste" onClick={() => setPane("paste")}>
            Paste a recipe
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="file" onClick={() => setPane("file")}>
            Import a file
          </Nav.Link>
        </Nav.Item>
      </Nav>

      {pane === "paste" ? (
        <PastePane isAdmin={isAdmin} existingTags={existingTags} />
      ) : (
        <FilePane isAdmin={isAdmin} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

function PastePane({
  isAdmin,
  existingTags,
}: {
  isAdmin: boolean;
  existingTags: string[];
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Partial<RecipeFormValues> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/recipes/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not read that.");
      return;
    }
    setDraft(await res.json());
  }

  if (draft) {
    return (
      <div>
        <Alert variant="info" className="d-flex justify-content-between align-items-center">
          <span>
            Here is what Pickl made of it. <strong>Check it before saving</strong> —
            splitting a recipe apart is guesswork, and it does not always guess right.
          </span>
          <Button
            variant="outline-secondary"
            size="sm"
            className="ms-3 flex-shrink-0"
            onClick={() => setDraft(null)}
          >
            Start over
          </Button>
        </Alert>
        {/* The ordinary form, saving through the ordinary route. Nothing about
            this recipe is special once it has been read. */}
        <RecipeForm draft={draft} isAdmin={isAdmin} existingTags={existingTags} />
      </div>
    );
  }

  return (
    <Form onSubmit={parse}>
      <p className="text-muted">
        Paste a recipe from anywhere — a note, an email, a web page. Pickl will
        pull out the name, the ingredients and the method, and show you what it
        worked out so you can fix anything it got wrong.
      </p>
      <Form.Group className="mb-3" controlId="paste-recipe">
        <Form.Label className="visually-hidden">Recipe text</Form.Label>
        <Form.Control
          as="textarea"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Grandma's Chili\n\nIngredients\n2 lbs ground beef\n1 onion, diced\n\nInstructions\nBrown the beef, add everything else, simmer.\n\nServes 6"}
          style={{ fontFamily: "var(--bs-font-monospace)", fontSize: "0.9rem" }}
        />
      </Form.Group>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" disabled={busy || !text.trim()}>
        {busy ? "Reading…" : "Read it"}
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

function FilePane({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [json, setJson] = useState("");
  const [visibility, setVisibility] = useState<"shared" | "private">(
    isAdmin ? "shared" : "private"
  );
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function readFile(file: File) {
    setError(null);
    setJson(await file.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSummary(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setBusy(false);
      setError("That is not valid JSON. Check the file opens in a text editor.");
      return;
    }

    // Options ride alongside the recipes. A bare array gets wrapped so the
    // visibility choice here always reaches the server, whatever shape the
    // file was in.
    const body = Array.isArray(parsed)
      ? { recipes: parsed, options: { visibility, allowDuplicates } }
      : { ...(parsed as object), options: { visibility, allowDuplicates } };

    const res = await fetch("/api/recipes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(payload?.error ?? "The import failed.");
      return;
    }
    setSummary(payload as ImportSummary);
    // The recipe list behind this page is now stale.
    router.refresh();
  }

  const problems = summary?.rows.filter((r) => r.status !== "imported") ?? [];

  return (
    <Form onSubmit={submit}>
      <p className="text-muted">
        A list of recipes in Pickl&rsquo;s own shape — what{" "}
        <strong>Export recipes</strong> gives you, and what the recipe scraper
        writes. Recipes already in the jar are skipped by matching their source
        URL.
      </p>

      <Form.Group className="mb-3" controlId="import-file">
        <Form.Label>Choose a file</Form.Label>
        <Form.Control
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void readFile(file);
          }}
        />
      </Form.Group>

      <Form.Group className="mb-3" controlId="import-json">
        <Form.Label>…or paste the JSON</Form.Label>
        <Form.Control
          as="textarea"
          rows={8}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='[{ "name": "Chilli", "ingredients": "…", "mealType": ["dinner"] }]'
          style={{ fontFamily: "var(--bs-font-monospace)", fontSize: "0.85rem" }}
        />
      </Form.Group>

      <fieldset className="mb-3">
        <legend className="fs-6 fw-semibold">Add them as</legend>
        <Form.Check
          type="radio"
          id="import-shared"
          name="import-visibility"
          label={
            <>
              Shared with the household
              {!isAdmin && (
                <span className="d-block text-muted small">
                  Only admins can add shared recipes.
                </span>
              )}
            </>
          }
          checked={visibility === "shared"}
          disabled={!isAdmin}
          onChange={() => setVisibility("shared")}
        />
        <Form.Check
          type="radio"
          id="import-private"
          name="import-visibility"
          label="Private to me"
          checked={visibility === "private"}
          onChange={() => setVisibility("private")}
        />
        <Form.Text>
          This decides for every recipe in the file, whatever the file itself
          says.
        </Form.Text>
      </fieldset>

      <Form.Check
        type="checkbox"
        id="import-duplicates"
        className="mb-3"
        label="Import recipes already in the jar"
        checked={allowDuplicates}
        onChange={(e) => setAllowDuplicates(e.target.checked)}
      />

      {error && <Alert variant="danger">{error}</Alert>}

      {summary && (
        <Card className="mb-3">
          <Card.Body>
            <Card.Title as="h3" className="h6">
              {summary.imported} imported
              {summary.skipped > 0 && `, ${summary.skipped} already here`}
              {summary.failed > 0 && `, ${summary.failed} could not be read`}
            </Card.Title>
            {problems.length > 0 && (
              <div className="table-responsive">
                <Table size="sm" className="mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Recipe</th>
                      <th>What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((r) => (
                      <tr key={r.index}>
                        <td>{r.index + 1}</td>
                        <td>{r.name ?? <em className="text-muted">no name</em>}</td>
                        <td className={r.status === "failed" ? "text-danger" : undefined}>
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      <Button type="submit" disabled={busy || !json.trim()}>
        {busy ? (
          <>
            <Spinner as="span" animation="border" size="sm" className="me-2" />
            Importing…
          </>
        ) : (
          "Import"
        )}
      </Button>
    </Form>
  );
}
