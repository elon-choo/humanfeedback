// End-to-end secret channel test: browser-encrypt a secret against the request's
// recipientPubKey, POST it as an answer (PIN cookie), so the local CLI can decrypt it.
// Usage: node scripts/secret-e2e.mjs <slug> <secret-plaintext>
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import os from 'node:os';
import ts from 'typescript';

const slug = process.argv[2];
const plaintext = process.argv[3];
if (!slug || !plaintext) { console.error('usage: node scripts/secret-e2e.mjs <slug> <plaintext>'); process.exit(1); }

const envTxt = await readFile(os.homedir() + '/.env', 'utf8').catch(() => '');
const env = {};
for (const l of envTxt.split('\n')) { const t = l.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const URL = (process.env.ELONFEEDBACK_URL || env.ELONFEEDBACK_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.ELONFEEDBACK_TOKEN || env.ELONFEEDBACK_TOKEN;
const PIN = process.env.ELON_PIN || env.ELON_PIN;
if (!URL || !TOKEN || !PIN) {
  console.error('ELONFEEDBACK_URL, ELONFEEDBACK_TOKEN, ELON_PIN을 환경 변수나 ~/.env에 설정하세요.');
  process.exit(1);
}

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

// load the REAL browser encryption module
const src = await readFile(new global.URL('../lib/crypto-browser.ts', import.meta.url), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const modUrl = `data:text/javascript;base64,${Buffer.from(out.outputText).toString('base64')}`;
const { encryptSecret } = await import(modUrl);

// fetch the request to read recipientPubKey (as the browser page would)
const reqList = await (await fetch(`${URL}/api/requests?status=open`, { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
const req = (reqList.requests || []).find((r) => r.slug === slug);
if (!req) { console.error('request not found or already answered:', slug); process.exit(1); }
if (!req.recipientPubKey) { console.error('request has no recipientPubKey'); process.exit(1); }

const enc = await encryptSecret({ id: 'openai_key', plaintext, recipientPubKey: req.recipientPubKey, slug });
console.log('encrypted secret -> ephemeralPubKey len(b64):', enc.ephemeralPubKey.length, 'iv:', enc.iv.length, 'aad:', enc.aad);

// authenticate to get the PIN cookie (as the browser would)
const authRes = await fetch(`${URL}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: PIN }) });
const setCookie = authRes.headers.get('set-cookie') || '';
const cookie = setCookie.split(';')[0];
console.log('auth:', authRes.status, 'cookie:', cookie.split('=')[0]);

// POST the answer with the encrypted secret + an attachment + a voice transcript
const body = {
  kind: 'voice', chosenOption: 2, transcript: '2번 회사 계정으로 가자. 키 넣어놨어.', durationSec: 9,
  secrets: [enc],
  attachments: [{ name: '참고-스샷.png', url: `${URL}/files/${slug}/demo.png`, contentType: 'image/png', size: 20480 }],
};
const ansRes = await fetch(`${URL}/api/answers/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
const ansJson = await ansRes.json();
console.log('answer POST:', ansRes.status, JSON.stringify(ansJson));
