// A new card must never replace a stored one (createJson,
// createRequestAtNextSeq in lib/blob.ts), and a listing must say how much of
// it was read (ListCompleteness). Runs against the real source with the blob
// client, fetch and the retry delay replaced by an in-memory store.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

const source = await readFile(new URL("../lib/blob.ts", import.meta.url), "utf8");
const importPattern = /import \{[^}]*\} from "@vercel\/blob";/;
assert.match(source, importPattern);
const transpiled = ts.transpileModule(
  source.replace(importPattern, `const { del, head, list, put } = globalThis.__blobClient;`),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }, fileName: "blob.ts" },
);

// pathname -> stored body text. listHides: pathnames list() does not report yet.
const store = new Map();
const putLog = [];
const listHides = new Set();
let putBehaviour = () => "store"; // per call: "store" | "throw" | "store-then-throw"
globalThis.__blobClient = {
  del: null,
  head: async (pathname) => {
    if (!store.has(pathname)) throw new Error(`not found: ${pathname}`);
    return { url: `https://store.example/${pathname}` };
  },
  list: async ({ prefix }) => ({
    blobs: [...store.keys()]
      .filter((pathname) => pathname.startsWith(prefix) && !listHides.has(pathname))
      .map((pathname) => ({ pathname, url: `https://store.example/${pathname}`, uploadedAt: new Date(0) })),
    hasMore: false,
  }),
  put: async (pathname, body, options) => {
    putLog.push({ pathname, allowOverwrite: options.allowOverwrite });
    if (!options.allowOverwrite && store.has(pathname)) throw new Error("blob already exists");
    const behaviour = putBehaviour(pathname);
    if (behaviour === "throw") throw new Error("put failed");
    store.set(pathname, body);
    if (behaviour === "store-then-throw") throw new Error("response lost");
  },
};
const broken = new Set(); // pathnames whose URL answers 500
globalThis.fetch = async (input) => {
  const pathname = new URL(String(input)).pathname.slice(1);
  if (broken.has(pathname) || !store.has(pathname)) return new Response("no", { status: broken.has(pathname) ? 500 : 404 });
  return new Response(store.get(pathname), { status: 200 });
};
// withRetry backs off for seconds; the cases below only care about the outcome.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, _ms, ...args) => realSetTimeout(callback, 0, ...args);
process.env.BLOB_READ_WRITE_TOKEN = "test-token";

const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { createJson, createRequestAtNextSeq, writeJson, readListedBlobs, listRequests, newListCompleteness, listCompletenessHeader } = await import(moduleUrl);

let checks = 0;
const check = async (name, run) => {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
};
const stored = (pathname) => JSON.parse(store.get(pathname));

await check("a free pathname is written once, without overwrite", async () => {
  assert.equal(await createJson("req/p/2026-10-11/001.json", { title: "first" }), true);
  assert.deepEqual(putLog.at(-1), { pathname: "req/p/2026-10-11/001.json", allowOverwrite: false });
  assert.deepEqual(stored("req/p/2026-10-11/001.json"), { title: "first" });
});

await check("a pathname that holds another card is refused and left as it was", async () => {
  assert.equal(await createJson("req/p/2026-10-11/001.json", { title: "second" }), false);
  assert.deepEqual(stored("req/p/2026-10-11/001.json"), { title: "first" });
});

await check("stored but the response was lost: counts as written, not as taken", async () => {
  putBehaviour = () => "store-then-throw";
  assert.equal(await createJson("req/p/2026-10-11/002.json", { title: "lost response" }), true);
  putBehaviour = () => "store";
});

await check("a failed write that stored nothing surfaces the original error", async () => {
  putBehaviour = () => "throw";
  await assert.rejects(createJson("req/p/2026-10-11/003.json", { title: "never" }), /put failed/);
  putBehaviour = () => "store";
  assert.equal(store.has("req/p/2026-10-11/003.json"), false);
});

await check("writeJson still replaces (answers, dismissals and pickups rewrite a blob)", async () => {
  await writeJson("req/p/2026-10-11/001.json", { title: "first", status: "answered" });
  assert.equal(putLog.at(-1).allowOverwrite, true);
  assert.equal(stored("req/p/2026-10-11/001.json").status, "answered");
});

await check("two posts handed the same number end up on two numbers, both stored", async () => {
  // Both list before either writes: each sees 002 as the highest.
  const build = (label) => (slug, seq) => ({ slug, seq, label });
  const [left, right] = await Promise.all([
    createRequestAtNextSeq("p", "2026-10-11", build("left")),
    createRequestAtNextSeq("p", "2026-10-11", build("right")),
  ]);
  assert.deepEqual([left.seq, right.seq].sort(), [3, 4]);
  assert.equal(stored(`req/${left.slug}.json`).label, "left");
  assert.equal(stored(`req/${right.slug}.json`).label, "right");
  assert.equal(stored(`req/${left.slug}.json`).seq, left.seq, "the stored card carries the number it was stored under");
});

await check("a card the listing does not report yet is still not replaced", async () => {
  store.set("req/q/2026-10-11/001.json", JSON.stringify({ label: "invisible to list" }));
  listHides.add("req/q/2026-10-11/001.json");
  const created = await createRequestAtNextSeq("q", "2026-10-11", (slug, seq) => ({ slug, seq, label: "new" }));
  assert.equal(created.seq, 2);
  assert.equal(stored("req/q/2026-10-11/001.json").label, "invisible to list");
  listHides.clear();
});

await check("gives up after five taken numbers instead of looping", async () => {
  for (let seq = 1; seq <= 6; seq += 1) {
    const pathname = `req/r/2026-10-11/00${seq}.json`;
    store.set(pathname, JSON.stringify({ label: "taken" }));
    listHides.add(pathname);
  }
  await assert.rejects(createRequestAtNextSeq("r", "2026-10-11", (slug, seq) => ({ slug, seq })), /No free sequence number/);
  listHides.clear();
});

await check("completeness counts what was listed, read, and could not be read", async () => {
  for (const name of ["a", "b", "c"]) store.set(`req/cov/2026-10-11/${name}.json`, JSON.stringify({ slug: name }));
  broken.add("req/cov/2026-10-11/b.json");
  const completeness = newListCompleteness();
  const values = await listRequests("req/cov/", completeness);
  assert.deepEqual(values.map((value) => value.slug).sort(), ["a", "c"]);
  assert.deepEqual(completeness, { listed: 3, read: 2, failed: 1 });
  assert.equal(listCompletenessHeader(completeness), "listed=3;read=2;failed=1");
  // Without a completeness object the result is the same and nothing is counted.
  assert.equal((await listRequests("req/cov/")).length, 2);
  // One object accumulates over several listings (requests + answers).
  await readListedBlobs([{ pathname: "req/cov/2026-10-11/a.json", url: "https://store.example/req/cov/2026-10-11/a.json", uploadedAt: new Date(0) }], completeness);
  assert.deepEqual(completeness, { listed: 4, read: 3, failed: 1 });
  broken.clear();
});

globalThis.setTimeout = realSetTimeout;
console.log(`\n${checks}/${checks} create/completeness checks passed`);
