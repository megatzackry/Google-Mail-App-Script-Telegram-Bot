# Google Mail App Script Telegram Bot

An email-verification Telegram bot built entirely on **Google Apps Script** — no server, no hosting bill, no external database. Users verify their email address by chatting with the bot, receive a one-time password (OTP) by email, and once verified get auto-approved into a linked Telegram group. Every update, outgoing message, and error is logged straight into a Google Sheet.

<img width="1672" height="941" alt="googleappscriptsbot_description" src="https://github.com/user-attachments/assets/6179e9aa-cce7-479b-a5cc-0292e02c3fca" />

This project is built on top of the [**Google Apps Script Telegram Bot** template](https://github.com/megatzackry/Google-App-Script-Telegram-Bot)
> ## 🚀 Live Demo
>
> This bot is live and running:
>
> - **Try it** → [@googleappscriptsbot](https://t.me/googleappscriptsbot) — DM it to start the email verification flow yourself.
> - **See it gate a real group** → [Google App Scripts](https://t.me/googleappscripts) — join the group; if you haven't verified an email with the bot yet, your request will wait for approval until you do.

## Table of Contents
- [What is this?](#what-is-this)
- [Live Demo](#-live-demo)
- [What the code does](#what-the-code-does)
- [Getting Started](#getting-started)
- [Using This as a Template](#using-this-as-a-template)

---

## What is this?

This repo contains a single Google Apps Script file (`Code.gs`) that turns a Google Sheet into the backend for a Telegram bot whose entire purpose is verifying that a user owns a real email address, then using that verification to gate access to a Telegram group.

The flow, end to end:
1. A user DMs the bot (or requests to join your group).
2. The bot asks for their email address.
3. The bot emails them a 6-digit OTP.
4. The user types the OTP back into the chat.
5. Once correct, their email is saved against their Telegram user id, and if they had a pending group join request, it's approved automatically.

Google Apps Script deploys the script as a **Web App**, giving you a public URL that Telegram calls every time your bot receives an update — that's your webhook, and it's completely free to run. `MailApp` (built into Apps Script) sends the OTP emails, so there's no separate email provider to configure either.

## What the code does

`Code.gs` is built around a few small pieces:

- **`setup()`** — run once to configure your bot. Paste in your full bot token (e.g. `123456789:AAExample-Token`) and your deployed Web app URL, and it splits the token into a bot id/key pair, stores both in Script Properties, and registers the Telegram webhook listening for `message`, `edited_message`, `chat_member`, `callback_query`, `my_chat_member`, and `chat_join_request` updates. Run this again any time you rotate your bot token or redeploy to a new URL.
- **`doPost(e)`** — the webhook entrypoint. Every Telegram update hits this function first and is routed by type to one of the handlers below. Any error thrown along the way is caught and logged via `Errors.handle()`.
- **`handleMessage(msg)`** — the core private-chat flow:
  - `/start` prompts the user (via `forceReply`) to enter their email address.
  - A message Telegram tags as an email address triggers `sendOTP`.
  - Any other reply while an OTP is pending is checked against the stored code — correct codes save the verified email to the Sheet and auto-approve a pending group join request; incorrect codes are rejected, with a hard cap of 3 attempts before the user has to request a fresh OTP.
- **`sendOTP(msg, user, ss, bot)`** — generates a 6-digit code, emails it using `MailApp.sendEmail` with a branded HTML template (dark-mode aware, with a "Verify in Telegram" button and links back to the group, the bot, and both GitHub repos), and replies in Telegram confirming the email was sent, with a **Resend OTP** button.
- **`forceReply(uid, ss, bot, text, message_id)`** — sends a force-reply prompt asking for an email address, clearing any cached OTP session for that user first.
- **`handleJoinRequest(cjr)`** — fired when someone requests to join your Telegram group. Already-verified users are approved immediately (via `answerChatJoinRequestQuery`); unverified users are marked `requested` in the Sheet and sent a guided Web App prompt (`sendChatJoinRequestWebApp`) so a later successful verification auto-approves them. This relies on your bot having Guard Mode enabled — see [step 1](#1-create-a-telegram-bot).
- **`handleChatMember(cm)`** — tracks member status changes (joined, left, kicked, etc.) inside your configured group and records the latest status against the user's row.
- **`handleMyChatMember(mcm)`** — tracks the *bot's own* membership in a chat. When the bot is added or promoted, it stores that chat's id as `GROUP_ID` in Script Properties; when the bot is removed, it clears it. This is how the bot knows which group it's managing without you hardcoding a chat id anywhere.
- **`Telegram`** — a wrapper around the Telegram Bot API (`send`, `setWebhook`, `approveJoinRequest`, `answerJoinRequest`, etc.) that includes:
  - Automatic retries for failed or dropped requests.
  - Handling for Telegram's `429` rate-limit responses, respecting the `retry_after` value Telegram sends back.
  - A guard that stops retrying before Apps Script's ~6-minute execution limit is hit, instead of letting the script get killed mid-request.
  - A `groupId` getter that reads the `GROUP_ID` Script Property set by `handleMyChatMember`, so group-scoped calls always target the right chat.
  - On every successful API call, it logs a confirmation row (with the outgoing payload and Telegram's response) to the `events` sheet.
- **`Sheet`** — treats the bound Google Sheet as a lightweight database: caches sheet references so you're not re-fetching them constantly, auto-creates `users`, `events`, and `errors` sheets (with header rows) the first time they're needed, and includes `getUserId(uid)` to look up or create a user's row, backed by a short-lived cache.
- **`Cache`** — a thin wrapper over Apps Script's `CacheService`, used to hold a user's in-progress OTP session (email, code, attempt count, expiry) for a few minutes at a time.
- **`User`** — a small model representing a row from the `users` sheet: `uid`, `email`, `status`, and any pending `otp` session.
- **`Errors`** — a custom `Error` subclass used everywhere in the code. Any error — a Telegram API failure, an OTP mismatch past the retry limit, a failed email send, a misconfigured bot — gets written as a new row into the `errors` sheet: timestamp, message, extra details, and the raw payload.

Because every outgoing API call and every error gets its own logged row, **you get a running, readable audit trail of every verification attempt** without adding any extra logging code of your own.

---

## Getting Started

### Prerequisites
- A Telegram account
- A Google account

### 1. Create a Telegram Bot
1. Start a chat with [@BotFather](https://t.me/BotFather).
2. Send the command `/newbot`.
3. Choose a name and a username for your bot.
4. Enable Guard Mode (**Optional, but highly recommended** to process join requests for your group)
- Open the [@BotFather](https://t.me/BotFather) mini app using the button on the bottom left.
- Click your newly created bot.
- Go to **Bot Settings**.
- Turn on **Guard Mode**.
5. Grab your bot token — BotFather will give you something in the form `123456789:AAExample-Token`. Keep the whole string; you'll paste it directly into the script later.

### 2. Set Up Your Google Sheet
1. Create a blank [Google Sheet](https://docs.google.com/spreadsheets/u/0/create).
2. Open the **Extensions** menu from the top navbar and click **Apps Script**.

### 3. Add the Code
1. Copy `Code.gs` from this repository and paste it in, replacing the existing default code.
2. Save the script.

### 4. Deploy as a Web App
1. Open the **Deploy** menu at the top right and click **New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Leave **Execute as** set to **Me**, and set **Who has access** to **Anyone**.
4. Click **Deploy**, then **Authorize access**.
5. If you see a "Google hasn't verified this app" warning, click **Advanced**, then **Go to project (unsafe)**.
6. Select all requested access and continue.
7. Copy the **Web app URL** shown after deployment (looks like `https://script.google.com/macros/s/.../exec`) and click **Done**.

### 5. Configure and Run Setup
1. Back in the editor, open `function setup()`.
2. Replace `'YOUR_BOT_TOKEN'` with the full token you got from BotFather.
3. Replace `'YOUR_WEBAPP_URL'` with the Web app URL you copied in the previous step.
4. Save the script.
5. On the top navbar of the Apps Script editor, make sure the function selector is set to **`setup`**.
6. Click **Run**, and approve any additional permission prompts.

`setup()` splits your token into an id and a key, stores them in Script Properties, and registers the webhook with Telegram — all in one run. You don't need to touch Script Properties manually at any point.

### 6. Test It
1. Once execution completes, open your bot in Telegram and send `/start`. It should prompt you for your email address.
2. Enter an email address, then check your inbox for the OTP and type it back into the chat — the bot should confirm you're verified.
3. Check your Google Sheet — a **`users`** tab will show your row with the verified email, and an **`events`** tab will log every request and reply sent along the way. If anything goes wrong, check the **`errors`** tab instead.

To test the group-verification flow:
1. Create a new Telegram group.
2. Add the newly created bot to the group.
3. Promote the bot to **administrator**.
4. In the group's permission settings, ensure **Process join requests** is turned on.

Once that's done, anyone requesting to join the group will be auto-approved if they've already verified their email with the bot, or prompted to verify first if they haven't.

---

## External References

[Google Apps Script](https://developers.google.com/apps-script/reference)  
[Telegram Bot API](https://core.telegram.org/bots/api#getting-updates)  
[MailApp Service](https://developers.google.com/apps-script/reference/mail/mail-app)  

## Using This as a Template

This repo is meant to be a working example, not a locked-down product. Feel free to:
- Swap out the OTP email template for your own branding.
- Extend the `Sheet` class or add new sheet tabs as your feature needs somewhere to store data.
- Adjust the OTP expiry window, retry limit, or code length inside `sendOTP`.

---

Found a bug or have an improvement? Issues and PRs are welcome.
