// readListedJson (lib/blob.ts) must fetch an unchanged blob once, and must not
// remember a body it cannot tie to the listed version (settle window, ETag
// mismatch, a write during the request) or keep one past its TTL. Runs against
// the real source with fetch, put, the clock and the TTL jitter replaced.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

const source = await readFile(new URL("../lib/blob.ts", import.meta.url), "utf8");
const importPattern = /import \{[^}]*\} from "@vercel\/blob";/;
assert.match(source, importPattern);
const transpiled = ts.transpileModule(
  // @vercel/blob is the only runtime import; only put() is reached (writeJson).
  source.replace(importPattern, `const del = null, head = null, list = null; const put = async (...args) => { if (globalThis.__putFails) throw new Error("put failed"); globalThis.__putLog.push(args); };`),
  {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "blob.ts",
  },
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
globalThis.__putLog = [];
process.env.BLOB_READ_WRITE_TOKEN = "test-token";
const { readListedJson, listedReadStats, writeJson } = await import(moduleUrl);

const MIN = 60_000;
const HOUR = 60 * MIN;
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const realRandom = Math.random;
Math.random = () => 0.5; // TTL is exactly 15 minutes unless a case changes it

// pathname -> { body, etag, delayMs?, status? } as the CDN would serve it now.
const cdn = new Map();
const fetchLog = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  fetchLog.push(url.pathname + url.search);
  const served = cdn.get(url.pathname.slice(1));
  if (served?.delayMs) clock += served.delayMs; // the response takes this long
  if (served?.gate) await served.gate; // ...or stays open until the test releases it
  if (!served || served.status) return new Response("missing", { status: served?.status ?? 404 });
  return new Response(served.body, { status: 200, headers: served.etag ? { etag: `"${served.etag}"` } : {} });
};
const serve = (pathname, value, etag, extra = {}) =>
  cdn.set(pathname, { body: typeof value === "string" ? value : JSON.stringify(value), etag, ...extra });
const listed = (pathname, uploadedAt, etag) => ({
  pathname,
  url: `https://store.example/${pathname}`,
  uploadedAt: new Date(uploadedAt),
  ...(etag ? { etag: `"${etag}"` } : {}),
});
const fetchesDuring = async (task) => {
  const before = fetchLog.length;
  const value = await task();
  return { value, fetches: fetchLog.length - before };
};
const stats = () => Object.fromEntries(listedReadStats().split(";").map((part) => part.split("=")).map(([k, v]) => [k, Number(v)]));

const t0 = clock;

// 1. A settled blob is fetched once, then served from memory.
serve("req/a.json", { slug: "a", status: "open", nested: { n: 1 } }, "a1");
const a1 = listed("req/a.json", t0 - HOUR, "a1");
let r = await fetchesDuring(() => readListedJson(a1));
assert.deepEqual(r.value, { slug: "a", status: "open", nested: { n: 1 } });
assert.equal(r.fetches, 1);
assert.equal(fetchLog.at(-1), `/req/a.json?v=${t0 - HOUR}`);
r = await fetchesDuring(() => readListedJson(a1));
assert.equal(r.fetches, 0, "unchanged blob not fetched again");
assert.deepEqual(r.value, { slug: "a", status: "open", nested: { n: 1 } });

// 2. Two cache hits never share an object, including nested ones.
const hitA = await readListedJson(a1);
hitA.status = "mutated";
hitA.nested.n = 99;
const hitB = await readListedJson(a1);
assert.deepEqual(hitB, { slug: "a", status: "open", nested: { n: 1 } });

// 3. An overwrite the listing reports (new etag + uploadedAt) is fetched, then remembered.
serve("req/a.json", { slug: "a", status: "answered" }, "a2");
const a2 = listed("req/a.json", t0 - HOUR / 2, "a2");
r = await fetchesDuring(() => readListedJson(a2));
assert.equal(r.value.status, "answered");
assert.equal(r.fetches, 1);
r = await fetchesDuring(() => readListedJson(a2));
assert.equal(r.value.status, "answered");
assert.equal(r.fetches, 0);

// 4. Same uploadedAt but a different etag is a different version.
serve("req/a.json", { slug: "a", status: "dismissed" }, "a3");
r = await fetchesDuring(() => readListedJson(listed("req/a.json", t0 - HOUR / 2, "a3")));
assert.equal(r.value.status, "dismissed");
assert.equal(r.fetches, 1);

// 5. A blob written inside the settle window is fetched every time.
serve("ans/a/1.json", { answerId: "1", pickedUp: false }, "p1");
const fresh = listed("ans/a/1.json", t0 - 10_000, "p1");
await readListedJson(fresh);
r = await fetchesDuring(() => readListedJson(fresh));
assert.equal(r.fetches, 1, "fresh blob re-read");

// 6. Slow response across the settle boundary: the CDN still serves the old
//    body (listing has no etag to compare), the response only completes after
//    the blob turned 5 minutes old. It must not be remembered.
serve("ans/slow/1.json", { pickedUp: false }, undefined, { delayMs: 5 * MIN });
const slow = listed("ans/slow/1.json", clock - 10_000);
r = await fetchesDuring(() => readListedJson(slow));
assert.equal(r.value.pickedUp, false);
serve("ans/slow/1.json", { pickedUp: true });
r = await fetchesDuring(() => readListedJson(slow));
assert.equal(r.fetches, 1, "body read inside the settle window was not remembered");
assert.equal(r.value.pickedUp, true);

// 7. The served ETag differs from the listed one (CDN still on the previous
//    body, or the listing is behind): return what was served, remember nothing.
const mismatchBefore = stats().etagMismatch;
serve("ans/m/1.json", { pickedUp: false }, "old");
const m2 = listed("ans/m/1.json", clock - HOUR, "new");
r = await fetchesDuring(() => readListedJson(m2));
assert.equal(r.value.pickedUp, false);
serve("ans/m/1.json", { pickedUp: true }, "new");
r = await fetchesDuring(() => readListedJson(m2));
assert.equal(r.fetches, 1, "mismatched body was not remembered");
assert.equal(r.value.pickedUp, true);
assert.equal(stats().etagMismatch, mismatchBefore + 1);
r = await fetchesDuring(() => readListedJson(m2));
assert.equal(r.fetches, 0, "matching body is remembered");

// 8. Remembered 'open', this instance writes 'dismissed', the listing still
//    reports the previous version: the write forgot the entry, so the new body
//    is read; it is not remembered under the stale listing.
serve("req/w.json", { status: "open" }, "w1");
const w1 = listed("req/w.json", clock - HOUR, "w1");
await readListedJson(w1);
assert.equal((await fetchesDuring(() => readListedJson(w1))).fetches, 0);
await writeJson("req/w.json", { status: "dismissed" });
assert.equal(globalThis.__putLog.at(-1)[0], "req/w.json");
serve("req/w.json", { status: "dismissed" }, "w2");
r = await fetchesDuring(() => readListedJson(w1));
assert.equal(r.value.status, "dismissed", "own write is visible through a stale listing");
assert.equal(r.fetches, 1);
r = await fetchesDuring(() => readListedJson(w1));
assert.equal(r.fetches, 1, "not remembered while the listing is behind");
assert.equal(r.value.status, "dismissed");

// 9. Another instance overwrote the blob and the listing stays behind: the
//    remembered body is served only until its TTL, then the new body is read
//    and never remembered under the stale listing.
serve("req/x.json", { status: "open" }, "x1");
const x1 = listed("req/x.json", clock - HOUR, "x1");
await readListedJson(x1);
serve("req/x.json", { status: "dismissed" }, "x2");
r = await fetchesDuring(() => readListedJson(x1));
assert.deepEqual([r.value.status, r.fetches], ["open", 0]);
clock += 16 * MIN; // past the 15-minute TTL
r = await fetchesDuring(() => readListedJson(x1));
assert.deepEqual([r.value.status, r.fetches], ["dismissed", 1], "stale listing bounded by TTL");
r = await fetchesDuring(() => readListedJson(x1));
assert.deepEqual([r.value.status, r.fetches], ["dismissed", 1]);

// 10. TTL bounds with the jitter at both ends: 11.25 and 18.75 minutes.
for (const [random, heldMin, goneMin] of [[0, 11, 12], [0.999999, 18, 19]]) {
  Math.random = () => random;
  const pathname = `req/ttl-${random}.json`;
  serve(pathname, { n: 1 }, "t1");
  const entry = listed(pathname, clock - HOUR, "t1");
  const start = clock;
  await readListedJson(entry);
  clock = start + heldMin * MIN;
  assert.equal((await fetchesDuring(() => readListedJson(entry))).fetches, 0, `held at ${heldMin} min`);
  clock = start + goneMin * MIN;
  assert.equal((await fetchesDuring(() => readListedJson(entry))).fetches, 1, `re-read at ${goneMin} min`);
}
Math.random = () => 0.5;

// 11. An unreadable date is never remembered.
serve("req/b.json", { slug: "b" }, "b1");
await readListedJson(listed("req/b.json", "not a date", "b1"));
assert.equal((await fetchesDuring(() => readListedJson(listed("req/b.json", "not a date", "b1")))).fetches, 1);

// 12. A failed read throws after four attempts and remembers nothing.
r = await fetchesDuring(() => assert.rejects(readListedJson(listed("req/missing.json", clock - HOUR, "z")), /Blob JSON not found/));
assert.equal(r.fetches, 4);
serve("req/missing.json", { slug: "late" }, "z");
assert.equal((await readListedJson(listed("req/missing.json", clock - HOUR, "z"))).slug, "late");

// 13. A body that is not JSON is retried and never remembered.
serve("req/bad.json", "<html>", "h");
r = await fetchesDuring(() => assert.rejects(readListedJson(listed("req/bad.json", clock - HOUR, "h"))));
assert.equal(r.fetches, 4);
serve("req/bad.json", { slug: "fixed" }, "h");
assert.equal((await readListedJson(listed("req/bad.json", clock - HOUR, "h"))).slug, "fixed");

// 14. Concurrent first reads all get the right body; later reads are remembered.
serve("req/c.json", { slug: "c" }, "c1");
const c1 = listed("req/c.json", clock - HOUR, "c1");
const together = await Promise.all(Array.from({ length: 40 }, () => readListedJson(c1)));
assert.ok(together.every((value) => value.slug === "c"));
assert.equal((await fetchesDuring(() => readListedJson(c1))).fetches, 0);

// 15. A body over the size cap is returned but not remembered, and it does not
//     evict what is already remembered.
const entriesBefore = stats().entries;
serve("req/huge.json", JSON.stringify({ pad: "x".repeat(32 * 1024 * 1024) }), "big");
const huge = listed("req/huge.json", clock - HOUR, "big");
assert.equal((await readListedJson(huge)).pad.length, 32 * 1024 * 1024);
assert.equal((await fetchesDuring(() => readListedJson(huge))).fetches, 1);
assert.equal(stats().entries, entriesBefore);
assert.equal((await fetchesDuring(() => readListedJson(c1))).fetches, 0);

// 16. The TTL runs from when the request started. A valid body that took 10
//     minutes to arrive is held 5 more minutes, not 15.
serve("req/s.json", { n: 1 }, "s1", { delayMs: 10 * MIN });
const s1 = listed("req/s.json", clock - HOUR, "s1");
let started = clock;
await readListedJson(s1);
serve("req/s.json", { n: 1 }, "s1");
clock = started + 14 * MIN;
assert.equal((await fetchesDuring(() => readListedJson(s1))).fetches, 0);
clock = started + 16 * MIN;
assert.equal((await fetchesDuring(() => readListedJson(s1))).fetches, 1);

// 17. A body that took longer than the TTL to arrive is not remembered at all.
serve("req/s2.json", { n: 1 }, "s1", { delayMs: 16 * MIN });
const s2 = listed("req/s2.json", clock - HOUR, "s1");
await readListedJson(s2);
serve("req/s2.json", { n: 1 }, "s1");
assert.equal((await fetchesDuring(() => readListedJson(s2))).fetches, 1);

// 18. A read in flight across this instance's own write must not put the old
//     body back, and must not extend how long an old body is served. The
//     listing keeps reporting the old version throughout.
let release;
serve("req/race.json", { v: "A" }, "A", { gate: new Promise((resolve) => { release = resolve; }) });
const raceA = listed("req/race.json", clock - HOUR, "A");
started = clock;
const inFlight = readListedJson(raceA); // t=0: request starts, response stays open
await new Promise((resolve) => setImmediate(resolve));
clock = started + 1_000;
await writeJson("req/race.json", { v: "B" }); // t=1s: this instance writes B
serve("req/race.json", { v: "A" }, "A"); // CDN still serves A for its max-age
clock = started + 30_000;
r = await fetchesDuring(() => readListedJson(raceA)); // t=30s: A, ETags agree -> remembered until t=15m30s
assert.deepEqual([r.value.v, r.fetches], ["A", 1]);
clock = started + 1 * MIN;
serve("req/race.json", { v: "B" }, "B"); // t=1m: CDN now serves B
clock = started + 4 * MIN;
release(); // t=4m: the first request finally completes with A
assert.equal((await inFlight).v, "A");
clock = started + 15 * MIN + 31_000; // past the t=30s entry's TTL
r = await fetchesDuring(() => readListedJson(raceA));
assert.deepEqual([r.value.v, r.fetches], ["B", 1], "in-flight read did not extend the old body");

// 19. Same race with nothing remembered in between: the late completion alone
//     must not be remembered either.
serve("req/race2.json", { v: "A" }, "A", { gate: new Promise((resolve) => { release = resolve; }) });
const race2 = listed("req/race2.json", clock - HOUR, "A");
const inFlight2 = readListedJson(race2);
await new Promise((resolve) => setImmediate(resolve));
await writeJson("req/race2.json", { v: "B" });
serve("req/race2.json", { v: "B" }, "B");
release();
assert.equal((await inFlight2).v, "A");
r = await fetchesDuring(() => readListedJson(race2));
assert.deepEqual([r.value.v, r.fetches], ["B", 1], "read that crossed a write is not remembered");

// 20. A write whose put() throws still invalidates.
serve("req/f.json", { v: "A" }, "A");
const fA = listed("req/f.json", clock - HOUR, "A");
await readListedJson(fA);
assert.equal((await fetchesDuring(() => readListedJson(fA))).fetches, 0);
globalThis.__putFails = true;
await assert.rejects(writeJson("req/f.json", { v: "B" }), /put failed/);
globalThis.__putFails = false;
assert.equal((await fetchesDuring(() => readListedJson(fA))).fetches, 1);

// 21. No ETag on one side: counted as unchecked, remembered on settle alone.
const uncheckedBefore = stats().etagUnchecked;
serve("req/n.json", { n: 1 });
const noEtag = listed("req/n.json", clock - HOUR, "n1");
await readListedJson(noEtag);
assert.equal(stats().etagUnchecked, uncheckedBefore + 1);
assert.equal((await fetchesDuring(() => readListedJson(noEtag))).fetches, 0);

const end = stats();
assert.equal(end.etagMismatch, mismatchBefore + 7, "one in case 7, two each in cases 8 and 9, one each in cases 18 and 19");
Date.now = realNow;
Math.random = realRandom;
console.log("test-listed-cache: all assertions passed —", listedReadStats());
