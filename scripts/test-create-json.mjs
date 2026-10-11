// Writes to a card must not lose another write (lib/blob.ts): a new card never
// replaces a stored one (createJson, createRequestAtNextSeq), a
// read-modify-write never puts an old copy back (updateJson), and a listing
// says how much of it was read (ListCompleteness). Runs against the real
// source with the blob client, fetch and the waits replaced by an in-memory
// store that has versions (ETags) and a CDN that can serve a stale body.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

// BLOB_SOURCE points at a deliberately broken copy when checking that a guard is really tested.
const source = await readFile(process.env.BLOB_SOURCE ?? new URL("../lib/blob.ts", import.meta.url), "utf8");
const importPattern = /import \{[^}]*\} from "@vercel\/blob";/;
assert.match(source, importPattern);
const transpiled = ts.transpileModule(
  source.replace(importPattern, `const { BlobNotFoundError, BlobPreconditionFailedError, del, head, list, put } = globalThis.__blobClient;`),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }, fileName: "blob.ts" },
);

class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}

// pathname -> { body, version }. The ETag is the version number.
const store = new Map();
const headWithoutEtag = new Set(); // head() reports no ETag for these
const servedWithoutEtag = new Set(); // the CDN serves no ETag header for these
const transientFailures = new Map(); // pathname -> number of head() calls that throw a network error first
let putNeverSettles = false; // put() only ends when its abortSignal fires (as an AbortError, like the client)
let headNeverSettles = false; // head() never answers
const putLog = [];
const listHides = new Set(); // pathnames list() does not report yet
const staleCdn = new Map(); // pathname -> { body, version, serves } : the CDN answers with this old copy `serves` more times
// Per call: "store" | "throw" | "store-then-throw" | a function run after storing, before the response is lost.
let putBehaviour = () => "store";
let beforePut = null; // runs once just before the next conditional put is checked (an interleaved writer)
const write = (pathname, body) => store.set(pathname, { body, version: (store.get(pathname)?.version ?? 0) + 1 });
const seed = (pathname, value) => write(pathname, JSON.stringify(value));
const stored = (pathname) => JSON.parse(store.get(pathname).body);

globalThis.__blobClient = {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del: null,
  head: async (pathname) => {
    if (headNeverSettles) return new Promise(() => {});
    const failures = transientFailures.get(pathname) ?? 0;
    if (failures > 0) { transientFailures.set(pathname, failures - 1); throw new TypeError("fetch failed"); }
    const blob = store.get(pathname);
    if (!blob) throw new BlobNotFoundError(`not found: ${pathname}`);
    return { url: `https://store.example/${pathname}`, uploadedAt: new Date(blob.version * 1000), etag: headWithoutEtag.has(pathname) ? undefined : `"v${blob.version}"` };
  },
  list: async ({ prefix }) => ({
    blobs: [...store.keys()]
      .filter((pathname) => pathname.startsWith(prefix) && !listHides.has(pathname))
      .map((pathname) => ({ pathname, url: `https://store.example/${pathname}`, uploadedAt: new Date(0) })),
    hasMore: false,
  }),
  put: async (pathname, body, options) => {
    putLog.push({ pathname, allowOverwrite: options.allowOverwrite, ifMatch: options.ifMatch, bounded: options.abortSignal instanceof AbortSignal });
    if (putNeverSettles) {
      return new Promise((_, reject) => options.abortSignal.addEventListener("abort", () => {
        abortReasons.push(options.abortSignal.reason?.name);
        reject(options.abortSignal.reason);
      }));
    }
    if (!options.allowOverwrite && store.has(pathname)) throw new Error("blob already exists");
    if (options.ifMatch) {
      if (beforePut) { const run = beforePut; beforePut = null; run(); }
      if (`"v${store.get(pathname)?.version}"` !== options.ifMatch) throw new BlobPreconditionFailedError("etag mismatch");
    }
    const behaviour = putBehaviour(pathname);
    if (behaviour === "throw") throw new Error("put failed");
    write(pathname, body);
    if (typeof behaviour === "function") behaviour(pathname);
    if (behaviour !== "store") throw new Error("response lost");
  },
};
const abortReasons = [];
const broken = new Set(); // pathnames whose URL answers 500
const fetchLog = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const pathname = url.pathname.slice(1);
  fetchLog.push(pathname + url.search);
  if (broken.has(pathname) || !store.has(pathname)) return new Response("no", { status: broken.has(pathname) ? 500 : 404 });
  const stale = staleCdn.get(pathname);
  if (stale && stale.serves > 0) {
    stale.serves -= 1;
    return new Response(stale.body, { status: 200, headers: { etag: `"v${stale.version}"` } });
  }
  const blob = store.get(pathname);
  return new Response(blob.body, { status: 200, headers: servedWithoutEtag.has(pathname) ? {} : { etag: `"v${blob.version}"` } });
};
// The retries and collision waits back off for real time; only outcomes matter here, so
// they run at once. The create deadline keeps its (short) real length: it has to lose
// against work that finishes and win against work that never does.
const CREATE_DEADLINE_MS = 400;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => realSetTimeout(callback, ms === CREATE_DEADLINE_MS ? ms : 0, ...args);
process.env.BLOB_READ_WRITE_TOKEN = "test-token";
process.env.BLOB_CREATE_DEADLINE_MS = String(CREATE_DEADLINE_MS);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { createJson, createRequestAtNextSeq, updateJson, writeJson, isBlobNotFound, readListedBlobs, listRequests, newListCompleteness, listCompletenessHeader } = await import(moduleUrl);

let checks = 0;
const check = async (name, run) => {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
};
const own = (id) => (found) => found?.creationId === id;

// ---- creating a card

await check("a free pathname is written once, without overwrite and with a time bound", async () => {
  assert.equal(await createJson("req/p/2026-10-11/001.json", { creationId: "A", title: "first" }, own("A")), true);
  assert.deepEqual(putLog.at(-1), { pathname: "req/p/2026-10-11/001.json", allowOverwrite: false, ifMatch: undefined, bounded: true });
  assert.equal(stored("req/p/2026-10-11/001.json").title, "first");
});

await check("a pathname that holds another card is refused and left as it was", async () => {
  assert.equal(await createJson("req/p/2026-10-11/001.json", { creationId: "B", title: "second" }, own("B")), false);
  assert.equal(stored("req/p/2026-10-11/001.json").title, "first");
});

await check("stored but the response was lost: counts as written, not as taken", async () => {
  putBehaviour = () => "store-then-throw";
  assert.equal(await createJson("req/p/2026-10-11/002.json", { creationId: "C", title: "lost response" }, own("C")), true);
  putBehaviour = () => "store";
});

await check("lost response, then the card was answered before the check: still this caller's card", async () => {
  // put stores the card and loses the response; the owner answers before createJson looks.
  putBehaviour = () => (pathname) => seed(pathname, { ...stored(pathname), status: "answered" });
  assert.equal(await createJson("req/p/2026-10-11/003.json", { creationId: "D", status: "open" }, own("D")), true);
  assert.equal(stored("req/p/2026-10-11/003.json").status, "answered");
  putBehaviour = () => "store";
});

await check("a failed write that stored nothing surfaces the original error", async () => {
  putBehaviour = () => "throw";
  await assert.rejects(createJson("req/p/2026-10-11/009.json", { creationId: "E" }, own("E")), /put failed/);
  putBehaviour = () => "store";
  assert.equal(store.has("req/p/2026-10-11/009.json"), false);
});

await check("the recovery read is not fooled by a stale CDN copy of someone else's earlier card", async () => {
  // 010 held X, was overwritten by this caller's card (lost response); the CDN still serves X once.
  seed("req/p/2026-10-11/010.json", { creationId: "X" });
  staleCdn.set("req/p/2026-10-11/010.json", { body: JSON.stringify({ creationId: "X" }), version: 1, serves: 1 });
  seed("req/p/2026-10-11/010.json", { creationId: "F" }); // version 2 = ours
  putBehaviour = () => "store";
  // put fails with "already exists"; the versioned read must skip the stale v1 body and see F.
  assert.equal(await createJson("req/p/2026-10-11/010.json", { creationId: "F" }, own("F")), true);
  staleCdn.clear();
});

await check("two posts handed the same number end up on two numbers, both stored", async () => {
  const build = (id) => (slug, seq) => ({ creationId: id, slug, seq });
  const [left, right] = await Promise.all([
    createRequestAtNextSeq("two", "2026-10-11", build("left")),
    createRequestAtNextSeq("two", "2026-10-11", build("right")),
  ]);
  assert.deepEqual([left.seq, right.seq].sort(), [1, 2]);
  assert.equal(stored(`req/${left.slug}.json`).creationId, "left");
  assert.equal(stored(`req/${right.slug}.json`).seq, right.seq, "the stored card carries the number it was stored under");
});

await check("ten posts at once all get their own number", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      createRequestAtNextSeq("ten", "2026-10-11", (slug, seq) => ({ creationId: `c${index}`, slug, seq })),
    ),
  );
  assert.deepEqual(results.map((result) => result.seq).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const [index, result] of results.entries()) assert.equal(stored(`req/${result.slug}.json`).creationId, `c${index}`);
});

await check("two posts with identical content are still two cards", async () => {
  const build = (id) => (slug, seq) => ({ creationId: id, title: "같은 내용", createdAt: "2026-10-11T10:00:00+09:00" });
  const [a, b] = await Promise.all([
    createRequestAtNextSeq("same", "2026-10-11", build("one")),
    createRequestAtNextSeq("same", "2026-10-11", build("two")),
  ]);
  assert.notEqual(a.slug, b.slug);
});

await check("a post whose response was lost and whose card was then answered is not posted a second time", async () => {
  putBehaviour = () => (pathname) => seed(pathname, { ...stored(pathname), status: "answered" });
  const created = await createRequestAtNextSeq("lost", "2026-10-11", (slug, seq) => ({ creationId: "L", slug, seq, status: "open" }));
  putBehaviour = () => "store";
  assert.equal(created.seq, 1);
  assert.equal(store.has("req/lost/2026-10-11/002.json"), false, "no second card");
});

await check("a card the listing does not report yet is still not replaced", async () => {
  seed("req/q/2026-10-11/001.json", { creationId: "invisible" });
  listHides.add("req/q/2026-10-11/001.json");
  const created = await createRequestAtNextSeq("q", "2026-10-11", (slug, seq) => ({ creationId: "new", slug, seq }));
  assert.equal(created.seq, 2);
  assert.equal(stored("req/q/2026-10-11/001.json").creationId, "invisible");
  listHides.clear();
});

await check("gives up after 25 taken numbers instead of looping", async () => {
  for (let seq = 1; seq <= 30; seq += 1) {
    const pathname = `req/r/2026-10-11/${String(seq).padStart(3, "0")}.json`;
    seed(pathname, { creationId: "taken" });
    listHides.add(pathname);
  }
  await assert.rejects(createRequestAtNextSeq("r", "2026-10-11", (slug, seq) => ({ creationId: "late", slug, seq })), /No free sequence number/);
  listHides.clear();
});

await check("a put that never answers is aborted at the deadline with an AbortError, then the stored state decides", async () => {
  putNeverSettles = true;
  const started = Date.now();
  // Nothing stored: the deadline error surfaces.
  await assert.rejects(createJson("req/p/2026-10-11/020.json", { creationId: "G" }, own("G")), /timed out|not found/);
  assert.ok(Date.now() - started < 5_000, "returned near the deadline");
  assert.equal(abortReasons.at(-1), "AbortError", "the client stops retrying only on AbortError");
  // Stored by this caller but the answer never came: counted as written.
  seed("req/p/2026-10-11/021.json", { creationId: "H" });
  assert.equal(await createJson("req/p/2026-10-11/021.json", { creationId: "H" }, own("H")), true);
  // The put times out and the check that follows stalls too: still returns near the deadline.
  headNeverSettles = true;
  const again = Date.now();
  await assert.rejects(createJson("req/p/2026-10-11/022.json", { creationId: "I" }, own("I")), /timed out/);
  assert.ok(Date.now() - again < 5_000, "a stalled check does not hold the request");
  headNeverSettles = false;
  putNeverSettles = false;
});

// ---- changing a card

await check("writeJson still replaces unconditionally (answer blobs, pickups)", async () => {
  await writeJson("req/p/2026-10-11/001.json", { creationId: "A", title: "first", status: "answered" });
  assert.deepEqual([putLog.at(-1).allowOverwrite, putLog.at(-1).ifMatch], [true, undefined]);
});

await check("updateJson writes on the version it read", async () => {
  seed("req/u/1.json", { status: "open" });
  const result = await updateJson("req/u/1.json", (current) => ({ ...current, visibility: "dormant" }));
  assert.deepEqual(result, { value: { status: "open", visibility: "dormant" }, written: true });
  assert.equal(putLog.at(-1).ifMatch, '"v1"');
  assert.equal(stored("req/u/1.json").visibility, "dormant");
});

await check("mutate returning null writes nothing", async () => {
  const puts = putLog.length;
  const result = await updateJson("req/u/1.json", () => null);
  assert.equal(result.written, false);
  assert.equal(putLog.length, puts);
});

await check("an answer landing between the read and the write is kept, not undone", async () => {
  // The visibility route read "open"; the answer route stores "answered" before the write arrives.
  seed("req/u/2.json", { status: "open", answeredAt: null });
  beforePut = () => seed("req/u/2.json", { status: "answered", answeredAt: "2026-10-11T12:00:00+09:00" });
  let sawAnswered = false;
  const result = await updateJson("req/u/2.json", (current) => {
    if (current.status !== "open") { sawAnswered = true; return null; }
    return { ...current, visibility: "dormant" };
  });
  assert.equal(sawAnswered, true, "mutate ran again on the answered version");
  assert.equal(result.written, false);
  assert.deepEqual(stored("req/u/2.json"), { status: "answered", answeredAt: "2026-10-11T12:00:00+09:00" });
});

await check("two changes to different fields both survive", async () => {
  seed("req/u/3.json", { status: "open" });
  beforePut = () => seed("req/u/3.json", { status: "open", visibility: "keep" });
  await updateJson("req/u/3.json", (current) => ({ ...current, note: "added" }));
  assert.deepEqual(stored("req/u/3.json"), { status: "open", visibility: "keep", note: "added" });
});

await check("a stale CDN body is not acted on: park, then undo inside the cache window", async () => {
  seed("req/u/4.json", { status: "open" });
  const before = store.get("req/u/4.json");
  await updateJson("req/u/4.json", (current) => ({ ...current, visibility: "dormant" }));
  // For the next two reads the CDN still serves the body from before the park.
  staleCdn.set("req/u/4.json", { body: before.body, version: before.version, serves: 2 });
  const undo = await updateJson("req/u/4.json", (current) => {
    if ((current.visibility ?? "auto") === "auto") return null; // what the route does: "already auto"
    const next = { ...current };
    delete next.visibility;
    return next;
  });
  assert.equal(undo.written, true, "the undo was applied to the parked version, not skipped as already done");
  assert.deepEqual(stored("req/u/4.json"), { status: "open" });
  staleCdn.clear();
});

await check("a body that never matches its version is an error, not a guess", async () => {
  seed("req/u/5.json", { status: "open" });
  seed("req/u/5.json", { status: "open", n: 2 });
  staleCdn.set("req/u/5.json", { body: JSON.stringify({ status: "open" }), version: 1, serves: 99 });
  const puts = putLog.length;
  await assert.rejects(updateJson("req/u/5.json", (current) => ({ ...current, x: 1 })), /not readable at its current version/);
  assert.equal(putLog.length, puts);
  staleCdn.clear();
});

await check("no ETag from head() or from the CDN: nothing is written, the read fails", async () => {
  for (const [label, set] of [["head", headWithoutEtag], ["served", servedWithoutEtag]]) {
    seed(`req/u/noetag-${label}.json`, { status: "answered" });
    set.add(`req/u/noetag-${label}.json`);
    const puts = putLog.length;
    await assert.rejects(updateJson(`req/u/noetag-${label}.json`, (current) => ({ ...current, status: "open" })), /not readable at its current version/);
    assert.equal(putLog.length, puts, label);
    assert.equal(stored(`req/u/noetag-${label}.json`).status, "answered");
    set.clear();
  }
});

await check("a transient network failure on the read is retried", async () => {
  seed("req/u/flaky.json", { status: "open" });
  transientFailures.set("req/u/flaky.json", 2);
  const result = await updateJson("req/u/flaky.json", (current) => ({ ...current, visibility: "keep" }));
  assert.equal(result.written, true);
  assert.equal(stored("req/u/flaky.json").visibility, "keep");
});

await check("a writer that always loses the race gives up with the conflict, and a missing blob is recognisable", async () => {
  seed("req/u/6.json", { n: 0 });
  let bumps = 0;
  const keepBumping = () => { bumps += 1; seed("req/u/6.json", { n: bumps }); beforePut = keepBumping; };
  beforePut = keepBumping;
  await assert.rejects(updateJson("req/u/6.json", (current) => ({ ...current, mine: true })), BlobPreconditionFailedError);
  beforePut = null;
  assert.equal(stored("req/u/6.json").mine, undefined);
  const missing = await updateJson("req/u/none.json", (current) => current).catch((error) => error);
  assert.equal(isBlobNotFound(missing), true);
  assert.equal(isBlobNotFound(new Error("other")), false);
});

// ---- listing

await check("completeness counts what was listed, read, and could not be read", async () => {
  for (const name of ["a", "b", "c"]) seed(`req/cov/2026-10-11/${name}.json`, { slug: name });
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
console.log(`\n${checks}/${checks} create/update/completeness checks passed`);
