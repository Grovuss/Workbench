# Workbench support relay

Reports from the app's Help page (bugs, suggestions, questions) are posted to a Discord forum
channel by this Cloudflare Worker. Reply in a post on Discord and the reply shows up in the app.
Nothing has to keep running: the Worker only wakes up when the app sends a report or checks for replies.

The bot token only ever lives in the Worker's secrets. The app knows the Worker's URL and nothing else.

## Setting it up

### 1. The bot

In the [Discord Developer Portal](https://discord.com/developers/applications), open the Workbench application:

1. **Bot** → **Reset Token**, and keep the token for step 3.
2. On the same page, turn on **Message Content Intent**, and turn off **Public Bot**.
3. **OAuth2** → **URL Generator**: tick the `bot` scope, then these permissions: View Channels,
   Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads,
   Read Message History, Attach Files. Open the link it makes and add the bot to your server.

### 2. The forum

1. Make a **Forum** channel, e.g. `#reports`. Keep it private: under its permissions, take
   View Channel away from @everyone and give it to the bot.
2. Add the tags **Bug**, **Suggestion** and **Help** (Edit Channel → Tags).
3. Turn on Developer Mode (User Settings → Advanced). Right-click the channel → **Copy Channel ID**,
   and right-click your own name → **Copy User ID**.

### 3. The Worker

From this folder:

```sh
npx wrangler@4 login
npx wrangler@4 deploy
npx wrangler@4 secret put DISCORD_BOT_TOKEN   # the token from step 1
npx wrangler@4 secret put FORUM_CHANNEL_ID    # the channel id
npx wrangler@4 secret put STAFF_IDS           # your user id; several ids separated by commas
npx wrangler@4 secret put TICKET_SECRET       # any long random string, see below
```

For `TICKET_SECRET`, `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` makes one.
Never change it later: every report's key is signed with it, so the app couldn't read replies to older reports.

`deploy` prints the Worker's address (`https://workbench-support.<you>.workers.dev`). Put it in
`SUPPORT_URL` in `electron/config.cjs`. The Help page shows up once that's set.

## Replying

- Type in the post. Only replies from the user ids in `STAFF_IDS` reach the app.
- Start a message with `//` to keep it on Discord, as a note to yourself.
- **Close and lock** the post to end the conversation. The app shows it as closed and stops checking it.
