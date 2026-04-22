import OpenAI from "openai";
import { buildPreparedImageSet } from "./imagePreprocessor.js";
import { parseCompactNumberToString } from "./numberUtils.js";
import type { ParsedSubmission } from "./types.js";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "username",
    "packsOpened",
    "battlesWon",
    "incomePerSecond",
    "bestCard",
    "totalCardLevel"
  ],
  properties: {
    username: { type: "string" },
    packsOpened: { type: "string" },
    battlesWon: { type: "string" },
    incomePerSecond: { type: "string" },
    bestCard: { type: "string" },
    totalCardLevel: { type: "string" }
  }
} as const;

function sanitizeUsername(username: string): string {
  return username.trim();
}

function validateParsedSubmission(parsed: ParsedSubmission): ParsedSubmission {
  if (!parsed.username) {
    throw new Error("Parsed username was empty.");
  }

  if (Object.values(parsed).some((value) => typeof value === "string" && !value.trim())) {
    throw new Error("Parsed submission contained an empty field.");
  }

  return parsed;
}

export class VisionParser {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async parseImage(imageUrl: string): Promise<{ parsed: ParsedSubmission; rawText: string }> {
    const preparedImages = await buildPreparedImageSet(imageUrl);

    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract leaderboard submission stats from a game screenshot.",
                "You will be given one full panel crop plus separate focused crops for the username and each stat row.",
                "Treat the focused row crops as the primary source of truth.",
                "Use the full panel crop only as fallback context if one row crop is ambiguous.",
                "At the top center is the username.",
                "Each stat row shows a label on the left and a value on the right on the same horizontal line.",
                "Extract the values as packsOpened, battlesWon, incomePerSecond, bestCard, totalCardLevel.",
                "If totalCardLevel is not present in the screenshot, return 0 for totalCardLevel.",
                "Labels may be in English, German, Italian, or another localized language.",
                "Transcribe each value exactly as shown before any normalization.",
                "Do not simplify, round, infer, or convert values.",
                "If the screenshot shows 1.23K, return 1.23K, not 1230 and not 230.",
                "If the screenshot shows 1.23K/s, return 1.23K/s exactly, including the decimal point, suffix, and /s.",
                "If the screenshot shows 0, return 0.",
                "Return each numeric field exactly as it appears, preserving suffixes like K, M, B, T, Qa, Qt and decorations like $ or /s if present.",
                "The image may be blurry, discolored, skewed, cropped, or photographed from a screen.",
                "Double-check decimal points and suffix letters carefully before responding.",
                "If a character is slightly ambiguous, choose the most likely reading from the blue box only."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Read the provided crops and extract the username and all stat values.",
                "Prefer the focused row images over the panel image whenever possible.",
                "For each stat, read the right-aligned value on the same row as the label."
              ].join(" ")
            },
            {
              type: "input_image",
              image_url: preparedImages.panel,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Username crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.username,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Packs Opened row crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.packsOpenedRow,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Battles Won row crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.battlesWonRow,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Cash/s row crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.incomePerSecondRow,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Best Card row crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.bestCardRow,
              detail: "high"
            },
            {
              type: "input_text",
              text: "Total Card Level row crop"
            },
            {
              type: "input_image",
              image_url: preparedImages.totalCardLevelRow,
              detail: "high"
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "discord_stat_submission",
          schema: OUTPUT_SCHEMA,
          strict: true
        }
      },
      max_output_tokens: 200
    });

    const rawText = response.output_text;
    if (!rawText) {
      throw new Error("OpenAI response did not include output_text.");
    }

    const payload = JSON.parse(rawText) as Record<string, string>;
    const parsed: ParsedSubmission = validateParsedSubmission({
      username: sanitizeUsername(payload.username),
      packsOpened: parseCompactNumberToString(payload.packsOpened),
      battlesWon: parseCompactNumberToString(payload.battlesWon),
      incomePerSecond: parseCompactNumberToString(payload.incomePerSecond),
      bestCard: parseCompactNumberToString(payload.bestCard),
      totalCardLevel: parseCompactNumberToString(payload.totalCardLevel)
    });

    return { parsed, rawText };
  }
}
