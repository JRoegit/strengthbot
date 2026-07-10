# Skarot Discord Bot

A Discord bot starter that watches one channel, sends uploaded screenshots to OpenAI vision, normalizes compact numbers like `13.2K`, and stores parsed player stat submissions locally.

## What it does

- Monitors one configured Discord channel
- Looks for the first image attachment on each message
- Sends the image to OpenAI vision for extraction
- Parses these fields:
  - `username`
  - `highestStrength`
  - `highestWins`
  - `rebirths`
  - `timePlayed`
- Converts values like `1.23K`, `4.5M`, and `2B` into full integers
- Converts time values like `15m30s`, `2h`, or `1:30:00` into stored seconds
- Saves submissions to `data/submissions.json`
- Stores penalties separately in `data/penalties.json`
- Supports a `.me` command to show a user's latest stored stats
- Supports `.top strength`, `.top wins`, `.top rebirths`, and `.top time` for top 10 lists
- Supports dev-only `.backlog`, `.remove <playerId>`, and `.penalize <playerId> <strength> <wins> <rebirths> <time>` commands

## Setup

1. Create a Discord bot application and enable these bot permissions/intents:
   - `MESSAGE CONTENT INTENT`
   - Read messages in the target channel
   - Read attachment history
   - Add reactions
2. Copy `.env.example` to `.env`
3. Fill in:
   - `DISCORD_TOKEN`
   - `DISCORD_CHANNEL_ID`
   - `OPENAI_API_KEY`
   - `PENALTY_FILE` if you want a custom penalty storage path
   - `DEV_ROLE_ID` for `.backlog` and other dev-only commands
4. Install dependencies:

```bash
npm install
```

5. Start the bot:

```bash
npm run dev
```

## Notes

- The current version stores data in a local JSON file so it is easy to inspect during development.
- The bot reacts with `:white_check_mark:` after a successful save and `:warning:` if parsing fails.
- The OpenAI prompt is intentionally narrow around the centered Lifetime Stats panel so output stays cheap and structured.

## Suggested next steps

- Add image preprocessing for especially messy screenshots
- Add confidence checks or a second-pass retry prompt
- Move storage to SQLite or Postgres
- Add commands for listing or exporting stored data
