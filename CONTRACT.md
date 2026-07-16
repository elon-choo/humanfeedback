# elonfeedback — SHARED CONTRACT (single source of truth)

This file is the interface both sides implement against:
- **The Next.js app** (this repo, deployed to Vercel) renders pages + serves the API.
- **The local Claude Code CLI** (`~/.claude/bin/elonfeedback`) posts requests and picks up answers.

If you change a shape here, change both sides.

## 0. Purpose

Elon (non-developer, vibe-coder, businessman) runs 10+ projects. When Claude Code needs a
*meaningful* human decision, instead of blocking inline it publishes a **rich, dopamine-framed
decision page** to this app. Elon opens the URL on phone/desktop, taps a big number OR speaks
into the mic (voice is auto-transcribed, large recordings supported), and the answer is saved.
Claude picks the answer up asynchronously later.

## 1. Storage: Vercel Blob (single store)

No SQL DB. Everything is JSON/binary objects in one Blob store.

| object | pathname | written by |
|---|---|---|
| request | `req/<project>/<date>/<seq>.json` | app `POST /api/requests` |
| answer  | `ans/<project>/<date>/<seq>/<answerId>.json` | app `POST /api/answers/...` |
| audio segment | `audio/<project>/<date>/<seq>/<answerId>-<segIdx>.webm` | browser upload |

- `<date>` = `YYYY-MM-DD` (KST). `<seq>` = zero-padded 3-digit per (project,date), e.g. `003`.
- `slug` = `<project>/<date>/<seq>`. `project` slug = lowercased, spaces→`-`, keep unicode letters.
- Blob objects are written with `addRandomSuffix:false` and `allowOverwrite:true` so pathnames are deterministic.
- Listing open requests = `list({ prefix: 'req/' })` then filter by parsed JSON `status`.

## 2. Request JSON (what the CLI posts; what the page renders)

```jsonc
{
  "slug": "funnelchat/2026-07-14/003",   // set by SERVER
  "project": "funnelchat",
  "date": "2026-07-14",                   // set by SERVER (KST)
  "seq": 3,                                // set by SERVER (next per project+date)
  "status": "open",                        // "open" | "answered"
  "urgency": "high",                       // "low" | "medium" | "high"
  "createdAt": "2026-07-14T09:12:00+09:00",// set by SERVER
  "answeredAt": null,                      // set by SERVER when first answer arrives
  "cwd": "/home/you/work/funnelchat",     // project dir that posted it (for local pickup filter)
  "machine": "elon-mac",                   // hostname
  "sessionId": "3f2a…uuid",               // OPTIONAL: Claude Code session UUID (CLAUDE_CODE_SESSION_ID)
                                           //   set by the CLI. Lets the watcher route the answer back
                                           //   to the exact posting session; falls back to cwd if the
                                           //   session is gone. Many sessions can share one cwd, so this
                                           //   + the slug-in-scrollback fingerprint is what disambiguates.
  "sessionLabel": "퍼널챗 기억 하네스",     // OPTIONAL: human-readable context label shown to Elon
  "title": "결제 실패 시 자동 재시도, 몇 번까지 할까?",   // <= 80 chars, plain language
  "tldr": "한 문장 요약 — 지금 뭘 정해야 하는지",
  "whyNow": "지금 이 결정이 필요한 이유 (한두 문장)",
  "context": "비개발자용 쉬운 설명. 마크다운 허용. 비유를 써서 쉽게.",
  "stakes": "이 결정으로 뭐가 갈리는지 — 도파민 프레이밍 (기대/리스크를 생생하게)",
  "options": [
    {
      "n": 1,
      "label": "3번까지 재시도",
      "whatChanges": "이걸 고르면 결제 실패해도 3번 자동 재시도 → 대부분 살아남음",
      "upside": "🚀 결제 성공률 ↑, 고객 이탈 ↓",
      "downside": "⚠️ 드물게 중복청구 리스크(방어코드로 커버)",
      "effort": "낮음",              // 낮음 | 보통 | 높음
      "reversible": true,
      "recommended": true            // at most one true
    }
  ],
  "recommendation": { "n": 1, "why": "저라면 1번. 이유는 …" },  // nullable
  "ifIgnored": "답 안 하면 기본으로 이렇게 진행됩니다 (또는: 멈춰서 기다립니다)",
  "allowFreeform": true              // whether to expect free voice beyond a number
}
```

Server assigns `slug/date/seq/createdAt/status`. Client sends the rest (may send `date` hint).

## 3. Answer JSON (written by the app when Elon answers)

```jsonc
{
  "answerId": "a_k3n8x2",
  "slug": "funnelchat/2026-07-14/003",
  "createdAt": "2026-07-14T21:40:00+09:00",  // server
  "kind": "voice",                            // "voice" | "text" | "number"
  "chosenOption": 1,                          // parsed option n, or null if unclear
  "transcript": "음… 1번으로 가자. 대신 중복청구 방어는 꼭 확인해줘.",  // full STT text
  "text": null,                               // typed text (if kind=text)
  "audioUrls": ["https://…/audio/…-0.webm"],  // segments in order, or []
  "durationSec": 42,
  "pickedUp": false                           // set true by CLI `inbox` after Claude reads it
}
```

## 4. HTTP API

Auth model:
- **Bearer** `Authorization: Bearer <ELONFEEDBACK_TOKEN>` → machine endpoints (CLI). Bypasses PIN.
- **PIN cookie** → browser endpoints (pages + answer POST). Middleware redirects to `/unlock` if missing.

| method | path | auth | body / returns |
|---|---|---|---|
| POST | `/api/requests` | Bearer | body = request (§2 minus server fields). Returns `{ slug, url, seq }`. |
| GET  | `/api/requests` | Bearer | query `?status=open&project=&cwd=&since=`. Returns `{ requests: [...] }`. |
| POST | `/api/answers/[project]/[date]/[seq]` | PIN | JSON `{ kind, chosenOption?, text?, audioUrls?, durationSec? }`. If audioUrls present and no transcript, server STTs each segment (download from Blob → OpenAI) and concatenates. Writes answer, marks request `answered`. Returns `{ ok, answerId, transcript, chosenOption }`. |
| POST | `/api/upload` | PIN | Vercel Blob **client upload** token handler (`handleUpload`) so the browser streams large audio directly to Blob (multipart, unbounded). Returns client token. |
| GET  | `/api/answers` | Bearer | query `?cwd=&project=&since=&unpickedOnly=1`. Returns `{ items: [{ request, answers:[...] }] }`. |
| POST | `/api/answers/pickup` | Bearer | body `{ slugs: [...] }` → set `pickedUp:true` on those answers. Returns `{ updated }`. |
| POST | `/api/auth` | — | body `{ pin }` → sets `elon_pin` httpOnly cookie if matches `ELON_PIN`. |

STT: OpenAI `gpt-4o-transcribe` (fallback `whisper-1`), language hint `ko`. Each uploaded segment is
a standalone webm/opus < 24MB, so per-request limits are never hit; long recordings arrive as many segments.

## 5. Pages

- `/` — **dashboard**: all `status:open` requests across every project, grouped by project,
  sorted urgency (high→low) then oldest-first. Each card: project badge, title, tldr, urgency dot,
  age ("3시간 전"), big "답하러 가기" button. This is Elon's single "what needs me" inbox.
- `/[project]` — open requests for one project.
- `/[project]/[date]/[seq]` — **the decision page** (see §6).
- `/unlock` — PIN entry.

## 6. Decision page UX (the dopamine page) — REQUIREMENTS

Audience: a smart non-developer businessman who defers decisions under cognitive load. Goals:
make the decision feel *small, clear, and rewarding to resolve*.

Must have, top to bottom:
1. Project badge + urgency + age. Title (big). TLDR one-liner.
2. **"지금 왜?"** (whyNow) in a highlighted callout.
3. **"이걸 정하면 뭐가 달라지나"** (stakes) — energetic, concrete, emoji-punctuated, NOT corporate.
4. Plain-language context (rendered markdown).
5. **Option cards, each with a HUGE number** (1/2/3…). Each card shows: label, whatChanges,
   green upside line, amber downside line, effort chip, reversible/irreversible chip. The
   `recommended` card gets a "🤖 클로드 추천" ribbon.
6. Claude's recommendation callout (recommendation.why).
7. "답 안 하면?" (ifIgnored) muted line.
8. **Answer bar (sticky bottom)**:
   - Big number buttons 1..N — tap = instantly submit a `number` answer for that option.
   - **Mic button** — tap to record. Shows live elapsed timer + waveform/pulse. Handles long
     recordings via **segmented recording** (new MediaRecorder every ~60s; each segment uploaded
     to Blob via client `upload()` immediately). On stop → POST /api/answers with the segment urls →
     server transcribes → shows transcript + detected number → Elon confirms or taps a number to override.
   - Optional text box (fallback / when he'd rather type).
9. After submit: friendly confirmation ("✅ 저장됐어요. 클로드가 이어서 진행합니다."), show what was saved.

Design discipline: dark-friendly, mobile-first (he'll use phone), no generic AI-looking gradient soup,
one confident accent color, large tap targets, Korean copy. Number parsing must also accept Korean
number words (일/이/삼…, 하나/둘/셋…, 첫번째/두번째…).

## 7. Env vars (Vercel project + local)

- `BLOB_READ_WRITE_TOKEN` — Blob store RW token (set by `vercel blob store add`).
- `OPENAI_API_KEY` — STT.
- `ELONFEEDBACK_TOKEN` — shared secret, CLI ↔ Bearer API.
- `ELON_PIN` — phone unlock PIN.

## 8.5 Secrets, attachments, text-only (ADDED — implement these too)

### 8.5.1 Secret / token handout (END-TO-END ENCRYPTED — security critical)
Sometimes the decision requires Elon to hand Claude a secret (API token, password, OAuth code).
The secret MUST be end-to-end encrypted: only Elon's local Mac can decrypt it. The Vercel server
and Blob store must NEVER see or store plaintext. Secrets are NEVER voiced/transcribed/logged.

**Request JSON gains (optional):**
```jsonc
"secretRequests": [ { "id": "openai_key", "label": "OpenAI API 키", "hint": "sk-... 붙여넣기", "required": true } ],
"recipientPubKey": "<base64 raw uncompressed P-256 public key, 65 bytes 0x04||X||Y>"
```
`recipientPubKey` is generated by the local CLI (fresh per request) and included when `secretRequests` present.

**Answer JSON gains (optional):**
```jsonc
"secrets": [ {
  "id": "openai_key",
  "alg": "ecdh-p256-hkdf-sha256-aes256gcm",
  "ephemeralPubKey": "<base64 raw P-256 pubkey from the browser>",
  "iv": "<base64, 12 bytes>",
  "ciphertext": "<base64 of AES-GCM output = ciphertext||16-byte-tag (Web Crypto format)>",
  "aad": "<slug>:<id>"
} ]
```
Server stores this array VERBATIM in the answer JSON. Server does not decrypt, parse, or log it.

**Browser crypto (Web Crypto only, no libs), per secret field:**
1. Import `recipientPubKey` (raw) as ECDH P-256 public key.
2. `generateKey` ephemeral ECDH P-256 keypair; export ephemeral public as `raw` → base64 = `ephemeralPubKey`.
3. `deriveBits({name:'ECDH', public: recipientKey}, ephemeralPriv, 256)` → 32-byte shared secret.
4. HKDF-SHA256 over that 32 bytes: salt = empty (0 bytes), info = UTF8("elonfeedback-secret-v1"), length 256 bits → AES-256-GCM key.
5. 12-byte random IV. AAD = UTF8(`<slug>:<id>`). `encrypt({name:'AES-GCM', iv, additionalData: aad}, key, plaintextUtf8)`.
6. Send `{id, alg, ephemeralPubKey, iv:b64, ciphertext:b64, aad}`. Zeroize the plaintext var after.

The matching Node decryption (in the local CLI, not this app): `createECDH('prime256v1').setPrivateKey(priv).computeSecret(ephemeralPubRaw)` → same 32 bytes → `hkdfSync('sha256', shared, emptySalt, info, 32)` → `createDecipheriv('aes-256-gcm', key, iv)` with `setAAD(aad)`, last 16 bytes of ciphertext = authTag.

**Secret UI:** masked `type=password` field(s), one per `secretRequests` entry, with a "🔒 이 값은 암호화되어 내 컴퓨터에서만 열립니다" note (owner name is configurable via `NEXT_PUBLIC_OWNER_NAME`) and a paste button. Never sent to STT. Submit alongside the normal answer (a secret handout may accompany a chosen number or stand alone).

### 8.5.2 Attachments (files / screenshots)
Answer bar has an attach control (accept `image/*` and common docs; also support paste-image and drag-drop).
Each file is uploaded to Blob via the same client `upload()` flow, pathname prefix `files/<slug>/`, public access
(URLs carry a random suffix = unguessable). Answer JSON gains:
```jsonc
"attachments": [ { "name": "screenshot.png", "url": "https://.../files/...", "contentType": "image/png", "size": 12345 } ]
```
`/api/upload` must allow image/* and common doc content types under the `files/` and `audio/` prefixes.
Attachments are NOT the secret channel — sensitive tokens go through 8.5.1, not attachments.

### 8.5.3 Text-only fallback (mic-less environments)
The text answer box is ALWAYS visible (not hidden behind the mic). Feature-detect mic:
if `navigator.mediaDevices?.getUserMedia` is missing OR permission is denied OR recording errors,
hide/disable the mic control and show a friendly "이 환경은 마이크가 안 돼요 — 아래에 번호나 메모를 입력하세요" hint,
keeping number buttons + text box + attach fully functional. A text-only answer posts `kind:"text"`.

## 8. Tech

Next.js (App Router, TS) · `@vercel/blob` · `openai` · Tailwind · `react-markdown`.
No external network at runtime except Vercel Blob + OpenAI. `export const runtime='nodejs'` on STT route.
`next build` must pass clean before deploy.
