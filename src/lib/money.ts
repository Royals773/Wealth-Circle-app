/**
 * All monetary amounts in WealthCircle are stored and passed around as
 * integer minor units (e.g. pence, cents) — never as floating point — to
 * avoid rounding drift in financial records. These helpers are the only
 * place major/minor unit conversion should happen.
 */

const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  // Zero-decimal currencies. Everything not listed defaults to 2 decimals,
  // which covers the currencies most community savings groups use.
  JPY: 1,
  KRW: 1,
  UGX: 1,
  RWF: 1,
};

export function minorUnitsPerMajor(currencyCode: string): number {
  return MINOR_UNITS_PER_MAJOR[currencyCode.toUpperCase()] ?? 100;
}

export function majorToMinorUnits(amountMajor: number, currencyCode: string): number {
  const factor = minorUnitsPerMajor(currencyCode);
  return Math.round(amountMajor * factor);
}

export function minorToMajorUnits(amountMinor: number, currencyCode: string): number {
  const factor = minorUnitsPerMajor(currencyCode);
  return amountMinor / factor;
}

export function formatMoney(amountMinor: number, currencyCode: string, locale = "en-GB"): string {
  const major = minorToMajorUnits(amountMinor, currencyCode);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "narrowSymbol",
  }).format(major);
}
