"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
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
import Link from "next/link";

function errorMessageFor(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "EmailNotVerified":
      return "EMAIL_NOT_VERIFIED";
    case "InvalidCredentials":
      return "Invalid email or password.";
    case "CredentialsSignin":
      return "Invalid email or password.";
    case "invalid_token":
      return "That verification link is invalid.";
    case "expired_token":
      return "That verification link has expired. Please request a new one.";
    case "missing_token":
      return "Missing verification token.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const verified = searchParams.get("verified");
  const invited = searchParams.get("invited");
  const emailChanged = searchParams.get("email_changed");
  const errorCode = errorMessageFor(searchParams.get("error"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorCode);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setShowResend(false);
    setResendStatus(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (result.code === "EmailNotVerified") {
        setError(
          "Your email address has not been verified yet. Please check your inbox."
        );
        setShowResend(true);
      } else if (result.code === "AccountDeactivated") {
        setError(
          "This account has been deactivated. Contact an administrator."
        );
      } else {
        setError("Invalid email or password.");
      }
      return;
    }

    router.push("/plan");
    router.refresh();
  }

  async function handleResend() {
    setResendStatus("Sending...");
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      setResendStatus("Verification email sent (if the account exists).");
    } else {
      setResendStatus("Could not resend right now. Try again later.");
    }
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
              {verified && (
                <Alert variant="success">
                  Your email has been verified. You can log in now.
                </Alert>
              )}
              {emailChanged && (
                <Alert variant="success">
                  Your email address has been updated. Please log in with your new
                  address.
                </Alert>
              )}
              {invited && (
                <Alert variant="success">
                  Your account is ready. You can log in now.
                </Alert>
              )}
              {error && (
                <Alert variant="danger">
                  {error}
                  {showResend && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={handleResend}
                      >
                        Resend verification email
                      </Button>
                      {resendStatus && (
                        <div className="small mt-2">{resendStatus}</div>
                      )}
                    </div>
                  )}
                </Alert>
              )}
              <Form onSubmit={handleSubmit}>
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Form.Group>
                <div className="d-grid">
                  <Button type="submit" disabled={loading}>
                    {loading ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      "Log In"
                    )}
                  </Button>
                </div>
              </Form>
              <div className="text-center mt-3 small">
                <Link href="/signup">Need an account? Sign up</Link>
                <br />
                <Link
                  href="#"
                  className="text-muted"
                  onClick={(e) => e.preventDefault()}
                  title="Not implemented in this release"
                >
                  Forgot password?
                </Link>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
