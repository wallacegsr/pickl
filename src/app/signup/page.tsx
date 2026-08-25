"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Col,
  Container,
  Form,
  Row,
  Spinner,
} from "react-bootstrap";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, confirmPassword }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setSuccess(
      data.message ||
        "Account created! Please check your email for a verification link."
    );
  }

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Row className="w-100 justify-content-center">
        <Col xs={12} sm={8} md={6} lg={4}>
          <Card className="shadow-sm">
            <Card.Body className="p-4">
              <h3 className="mb-1 text-center">🥒 Pickl</h3>
              <p className="text-center text-muted small mb-3">
                Out of the pickle, onto the plate.
              </p>
              <h5 className="mb-3 text-center">Create an account</h5>
              {error && <Alert variant="danger">{error}</Alert>}
              {success ? (
                <Alert variant="success">
                  {success}
                  <div className="mt-2">
                    <Link href="/login">Return to login</Link>
                  </div>
                </Alert>
              ) : (
                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-3" controlId="name">
                    <Form.Label>Name</Form.Label>
                    <Form.Control
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3" controlId="email">
                    <Form.Label>Email</Form.Label>
                    <Form.Control
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Form.Group>
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
                        "Sign Up"
                      )}
                    </Button>
                  </div>
                </Form>
              )}
              {!success && (
                <div className="text-center mt-3 small">
                  <Link href="/login">Already have an account? Log in</Link>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
