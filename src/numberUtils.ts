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

export function parseDurationToSecondsString(value: string): string {
  const cleaned = value.replace(/\s+/g, "").trim().toLowerCase();
  if (!cleaned) {
    throw new Error(`Could not parse duration value: "${value}"`);
  }

  if (/^\d+$/.test(cleaned)) {
    return BigInt(cleaned).toString();
  }

  const colonParts = cleaned.split(":");
  if (colonParts.length > 1) {
    if (colonParts.some((part) => !/^\d+$/.test(part))) {
      throw new Error(`Could not parse duration value: "${value}"`);
    }

    const parts = colonParts.map((part) => BigInt(part));
    if (parts.length === 2) {
      return ((parts[0] * 60n) + parts[1]).toString();
    }

    if (parts.length === 3) {
      return ((parts[0] * 3600n) + (parts[1] * 60n) + parts[2]).toString();
    }

    throw new Error(`Could not parse duration value: "${value}"`);
  }

  let total = 0n;
  let matched = false;
  let consumedCharacters = 0;
  const durationPattern = /(\d+)(days|day|d|hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)/g;
  let match: RegExpExecArray | null;

  while ((match = durationPattern.exec(cleaned)) !== null) {
    if (match.index !== consumedCharacters) {
      throw new Error(`Could not parse duration value: "${value}"`);
    }

    matched = true;
    consumedCharacters = durationPattern.lastIndex;
    const amount = BigInt(match[1]);
    const unit = match[2];

    if (unit.startsWith("d")) {
      total += amount * 86_400n;
    } else if (unit.startsWith("h")) {
      total += amount * 3_600n;
    } else if (unit.startsWith("m")) {
      total += amount * 60n;
    } else {
      total += amount;
    }
  }

  if (!matched || consumedCharacters !== cleaned.length) {
    throw new Error(`Could not parse duration value: "${value}"`);
  }

  return total.toString();
}

export function subtractClamped(value: string, deduction: string): string {
  const result = BigInt(value) - BigInt(deduction);
  return (result < 0n ? 0n : result).toString();
}
