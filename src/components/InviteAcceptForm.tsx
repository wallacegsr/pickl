"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from "react-bootstrap";

export default function InviteAcceptForm({
  token,
  email,
  name,
  initialError,
}: {
  token: string | null;
  email: string | null;
  name: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, confirmPassword }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    router.push("/login?invited=1");
  }

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Row className="w-100 justify-content-center">
        <Col xs={12} sm={8} md={6} lg={4}>
          <Card className="shadow-sm">
            <Card.Body className="p-4">
              <h3 className="mb-3 text-center">🥒 You&apos;re invited!</h3>
              {initialError ? (
                <>
                  <Alert variant="danger">{initialError}</Alert>
                  <div className="text-center small">
                    <Link href="/login">Return to login</Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-center text-muted">
                    Set a password for <strong>{name}</strong> ({email}) to
                    finish setting up your account.
                  </p>
                  {error && <Alert variant="danger">{error}</Alert>}
                  <Form onSubmit={handleSubmit}>
                    <Form.Group className="mb-3" controlId="password">
                      <Form.Label>Password</Form.Label>
                      <Form.Control
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Form.Group>
                    <Form.Group className="mb-3" controlId="confirmPassword">
                      <Form.Label>Confirm Password</Form.Label>
                      <Form.Control
                        type="password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </Form.Group>
                    <div className="d-grid">
                      <Button type="submit" disabled={loading}>
                        {loading ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          "Set Password & Continue"
                        )}
                      </Button>
                    </div>
                  </Form>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
