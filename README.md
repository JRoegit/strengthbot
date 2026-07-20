# Skarot Discord Bot

A Discord bot starter that watches one channel, sends uploaded screenshots to OpenAI vision, normalizes compact numbers like `13.2K`, and stores parsed player stat submissions locally.

## What it does

- Monitors one configured Discord channel
- Looks for the first image attachment on each message
- Restricts bot commands to configured command channels
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
- Supports dev-only `.csv <statname>` exports of the top 10 with `IsVIP`, `Name`, and display-formatted `Value` columns; exported VIP flags are synchronized from the configured Discord role
- Supports persistent dev-only scheduled messages with `.schedule <epochtime> <channelId> <message>`
- Supports dev-only `.vip @playername` to mark a submission as VIP and grant a configured Discord role

## Setup

1. Create a Discord bot application and enable these bot permissions/intents:
   - `MESSAGE CONTENT INTENT`
   - Read messages in the target channel
   - Read attachment history
   - Add reactions
2. Copy `.env.example` to `.env`
3. Fill in:
   - `DISCORD_TOKEN`
   - `DISCORD_CHANNEL_ID` for screenshot submissions
   - `COMMAND_CHANNEL_IDS` for command usage, as one or more comma-separated channel IDs
   - `OPENAI_API_KEY`
   - `PENALTY_FILE` if you want a custom penalty storage path
   - `SCHEDULE_FILE` if you want a custom scheduled-message storage path
   - `DEV_ROLE_ID` for `.backlog` and other dev-only commands
   - `VIP_ROLE_ID` for the role granted by `.vip @playername`
   - The bot needs `Manage Roles`, and its highest role must be above the VIP role
4. Install dependencies:

```bash
npm install
```

5. Start the bot for local development:

```bash
npm run dev
```

For production, build and run the compiled bot:

```bash
npm run build
npm start
```

## Raspberry Pi autostart

Use `systemd` to run the compiled bot after the Pi restarts.

1. Build the bot on the Pi:

```bash
cd /home/pi/skarobot/skarobot
npm install
npm run build
```

2. Create the service:

```bash
sudo nano /etc/systemd/system/strengthbot.service
```

3. Paste this service file, adjusting `User` and `WorkingDirectory` if your Pi user or project path is different:

```ini
[Unit]
Description=Strength Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/skarobot/skarobot
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

4. Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable strengthbot
sudo systemctl start strengthbot
```

Useful commands:

```bash
sudo systemctl status strengthbot
journalctl -u strengthbot -f
sudo systemctl restart strengthbot
```

After pulling code changes on the Pi, rebuild and restart:

```bash
npm install
npm run build
sudo systemctl restart strengthbot
```

## Notes

- The current version stores data in a local JSON file so it is easy to inspect during development.
- Scheduled-message epoch times are Unix timestamps in seconds. Pending schedules are restored after a bot restart, and overdue messages are sent when the bot comes back online.
- The bot reacts with `:white_check_mark:` after a successful save and `:warning:` if parsing fails.
- The OpenAI prompt is intentionally narrow around the centered Lifetime Stats panel so output stays cheap and structured.

## Suggested next steps

- Add image preprocessing for especially messy screenshots
- Add confidence checks or a second-pass retry prompt
- Move storage to SQLite or Postgres
- Add commands for listing or exporting stored data
