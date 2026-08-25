import { randomBytes } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpiryDate(hoursFromNow = 24): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}
