import { describe, expect, it, vi } from "vitest";
import { LENDING_DISABLED, LENDING_DISABLED_MESSAGE, loanRpcErrorMessage } from "./lending-gate";

describe("LENDING_DISABLED", () => {
  it("is on, matching the live 0021 database revoke pending legal review", () => {
    expect(LENDING_DISABLED).toBe(true);
  });
});

describe("loanRpcErrorMessage", () => {
  it("maps a Postgres insufficient_privilege error (42501) to the lending-disabled message", () => {
    expect(loanRpcErrorMessage({ code: "42501", message: "permission denied for function apply_for_loan" })).toBe(
      LENDING_DISABLED_MESSAGE,
    );
  });

  it("never leaks the raw Postgres error text for a permission-denied error", () => {
    const rawMessage = "permission denied for function apply_for_loan";
    const result = loanRpcErrorMessage({ code: "42501", message: rawMessage });
    expect(result).not.toContain(rawMessage);
    expect(result).not.toContain("permission denied");
  });

  it("maps an unexpected error to a generic message, not the raw text, and logs it server-side", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = "duplicate key value violates unique constraint";
    const result = loanRpcErrorMessage({ code: "23505", message: raw });

    expect(result).not.toContain(raw);
    expect(result).not.toBe(LENDING_DISABLED_MESSAGE);
    expect(consoleSpy).toHaveBeenCalledWith("[lending] unexpected loan RPC error", {
      code: "23505",
      message: raw,
    });

    consoleSpy.mockRestore();
  });

  it("maps a null/undefined error to a generic, non-empty message", () => {
    expect(loanRpcErrorMessage(null)).toBeTruthy();
    expect(loanRpcErrorMessage(undefined)).toBeTruthy();
    expect(loanRpcErrorMessage(null)).not.toBe(LENDING_DISABLED_MESSAGE);
  });

  it("never returns an empty or raw-looking SQL error string", () => {
    const result = loanRpcErrorMessage({ code: "42501" });
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toMatch(/function|relation|column/i);
  });
});
