import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./auth";

describe("signUpSchema", () => {
  const valid = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    password: "Password123",
    confirmPassword: "Password123",
    acceptTerms: true as const,
  };

  it("accepts a well-formed sign-up", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = signUpSchema.safeParse({ ...valid, confirmPassword: "Different123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("confirmPassword"))).toBe(
        true,
      );
    }
  });

  it("rejects a password without a number", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      password: "NoNumbersHere",
      confirmPassword: "NoNumbersHere",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when terms are not accepted", () => {
    const result = signUpSchema.safeParse({ ...valid, acceptTerms: false });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires an email and a non-empty password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching, sufficiently strong passwords", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "Password123",
        confirmPassword: "Password123",
      }).success,
    ).toBe(true);

    expect(
      resetPasswordSchema.safeParse({
        password: "Password123",
        confirmPassword: "Mismatch123",
      }).success,
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        password: "short1A",
        confirmPassword: "short1A",
      }).success,
    ).toBe(false);
  });
});
