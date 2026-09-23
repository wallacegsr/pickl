"use client";

import type { ReactNode } from "react";
import { Card, Col, Container, Row } from "react-bootstrap";
import PicklMark from "@/components/brand/PicklMark";

/**
 * The centred card the signed-out pages share — login, forgot password,
 * reset password — so they read as one flow rather than three designs.
 */
export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Row className="w-100 justify-content-center">
        <Col xs={12} sm={8} md={6} lg={4}>
          <Card className="shadow-sm">
            <Card.Body className="p-4">
              <h3 className="mb-3 text-center d-flex align-items-center justify-content-center gap-2">
                <PicklMark size={26} />
                {title}
              </h3>
              {children}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
