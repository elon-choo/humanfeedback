---
name: feedback-inbox-setup
description: >
  Deploy your OWN personal "decision inbox" (elonfeedback) to your OWN Vercel account, and wire
  up the local CLI so your AI assistant can post decisions to it and pick up your answers. Use when
  the user wants to set up / install / deploy their own feedback-inbox / decision-inbox / 결정 인박스,
  or says "이 스킬로 결정 인박스 깔아줘 / 배포해줘 / 세팅해줘". This walks them through Vercel signup,
  the Blob store, the OpenAI key, and deployment — one person, one private instance, no shared server.
---

# feedback-inbox-setup — deploy the user's own decision inbox

This skill installs **feedback-inbox** (a.k.a. elonfeedback): a personal tool where an AI assistant
posts "decisions only you can make" as a nice web page, and the user answers by tapping a number or
speaking into the mic. Each person runs THEIR OWN instance on THEIR OWN Vercel — there is no shared
server (the tool ties into the user's own AI sessions).

Source (public): **https://github.com/elon-choo/elonfeedback**

## Before you start — confirm prerequisites with the user

Ask the user to have these ready (help them get each if missing):
1. **Node.js 20+** — check `node --version`. If missing: https://nodejs.org/ko/download (LTS).
2. **A Vercel account** — free. If they don't have one, send them to https://vercel.com/signup, then
   `npm i -g vercel && vercel login`.
3. **An OpenAI API key** (for voice→text) — https://platform.openai.com/api-keys. Note: ChatGPT
   subscription ≠ API billing; the API key needs its own billing set up.

Secrets rule: never paste the user's OpenAI key / PIN / token into the chat. They go into the
terminal prompt that `setup.mjs` shows, or into Vercel's env UI — never into your conversation.

## Steps

1. **Get the code.** In a fresh folder:
   ```bash
   git clone https://github.com/elon-choo/elonfeedback.git
   cd elonfeedback
   npm install
   ```
2. **Dry-run the setup** (no changes, prints the plan + checks prerequisites):
   ```bash
   node scripts/setup.mjs --check
   ```
   Fix anything it flags (usually `vercel login`).
3. **Run the provisioner.** It links a new Vercel project, creates the Blob store, generates a
   strong API token + a login PIN, asks for the OpenAI key, sets env vars across all environments,
   and deploys:
   ```bash
   node scripts/setup.mjs
   ```
   If it stops at the Blob-store step (that step is interactive), it prints the exact
   `vercel blob store add <name>` command — have the user run it, select **all environments**, then
   re-run `node scripts/setup.mjs` (it's idempotent and resumes).
4. **Read back the result.** On success it writes `.elonfeedback.env` (gitignored) and prints the
   live URL, the PIN, and three lines (`ELONFEEDBACK_URL` / `ELONFEEDBACK_TOKEN` / `ELON_PIN`).
   Tell the user to add those three lines to their `~/.env` (append, don't wipe existing lines).
5. **Install the local CLI** so the AI can post/pick-up decisions:
   ```bash
   npm install --global .    # or `npm link` in a dev setup
   elonfeedback doctor       # should print URL + conn: OK
   ```
6. **(Optional) personalize** — set `NEXT_PUBLIC_OWNER_NAME` / `NEXT_PUBLIC_APP_TITLE` in the Vercel
   project env and redeploy to show the user's name/title. Defaults are fine to keep.

## After setup — how they use it

- The user opens their live URL on their phone, enters the PIN once (30-day cookie), and answers
  decisions by number / mic / text. Full deploy + usage details are in the repo's `SETUP.md`.
- Their AI assistant posts decisions with `elonfeedback ask <payload.json>` and picks answers up with
  `elonfeedback inbox --cwd "$(pwd)"`. See the repo's `SETUP.md` and the app's `CONTRACT.md`.

## Notes / limits

- **One instance per person.** Do not point two people at one deployment.
- The background auto-resume "watcher" (injecting answers straight back into a live session) is
  specific to a PTY-bridge setup and is NOT part of this basic install; without it, answers are still
  picked up the async way via `elonfeedback inbox`. Don't attempt to install a watcher here.
- Never commit `.env` / `.elonfeedback.env` / tokens (the repo's `.gitignore` already blocks them).
