const MAGNITUDE_SUFFIXES: Record<string, bigint> = {
  K: 1_000n,
  M: 1_000_000n,
  B: 1_000_000_000n,
  T: 1_000_000_000_000n,
  QA: 1_000_000_000_000_000n,
  QT: 1_000_000_000_000_000_000n,
  SX: 1_000_000_000_000_000_000_000n,
  SP: 1_000_000_000_000_000_000_000_000n,
  OC: 1_000_000_000_000_000_000_000_000_000n,
  NO: 1_000_000_000_000_000_000_000_000_000_000n,
  DC: 1_000_000_000_000_000_000_000_000_000_000_000n
};

export function parseCompactNumberToString(value: string): string {
  const cleaned = value
    .replace(/[$\u20AC,]/g, "")
    .replace(/\/S$/i, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();

  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([A-Z]+)?$/);
  if (!match) {
    throw new Error(`Could not parse numeric value: "${value}"`);
  }

  const amount = match[1];
  const suffix = match[2] ?? "";
  const multiplier = suffix ? MAGNITUDE_SUFFIXES[suffix] : 1n;

  if (multiplier === undefined) {
    throw new Error(`Unsupported numeric value: "${value}"`);
  }

  const [wholePart, decimalPart = ""] = amount.split(".");
  const decimalScale = 10n ** BigInt(decimalPart.length);
  const whole = BigInt(wholePart);
  const fraction = decimalPart ? BigInt(decimalPart) : 0n;
  const scaledAmount = (whole * decimalScale) + fraction;
  const result = (scaledAmount * multiplier) / decimalScale;

  return result.toString();
}

export function subtractClamped(value: string, deduction: string): string {
  const result = BigInt(value) - BigInt(deduction);
  return (result < 0n ? 0n : result).toString();
}
