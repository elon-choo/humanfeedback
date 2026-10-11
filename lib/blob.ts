import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  head,
  list,
  put,
  type HeadBlobResult,
  type ListBlobResultBlob,
} from "@vercel/blob";

import type { DecisionRequest } from "@/lib/types";

const KST_TIME_ZONE = "Asia/Seoul";

const kstFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function blobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  return token;
}

// List endpoints fan readJson/list out to one Blob API call per stored card,
// unbounded. Past a few hundred blobs the API rate-limits, and the
// Promise.allSettled callers silently drop the failed reads — newest cards then
// vanish from every list/inbox/wait/pickup response (observed 2026-08-06 when
// the store crossed ~400 request blobs). Bound the concurrency and retry
// transient failures so reads stay complete instead of randomly truncated.
const BLOB_CALL_CONCURRENCY = 8;
// Reads of an already-listed blob fetch its public URL (CDN), which is not a
// Blob API call, so they get a wider bound of their own. Routing them through
// head() as well cost one rate-limited API call per card: at ~380 cards the
// list endpoints took 109 s and /api/answers hit the 300 s limit (2026-09-27).
const BLOB_FETCH_CONCURRENCY = 32;
// The list endpoints used to re-fetch every stored card on every call. The
// 20 s watcher poll alone read ~1,800 blob URLs 4,320 times a day, and each
// read is a billed CDN request (~$25/day by 2026-10-10). A blob's content only
// changes when it is overwritten, which moves its etag and uploadedAt, so the
// body is remembered per pathname+version and only changed blobs are fetched
// again. A stale remembered answer (pickedUp: false) would put an already
// handled decision back in a session's inbox, so a body is only remembered
// when all of these hold:
// - the blob was at least SETTLE old when the request started (a read racing
//   an overwrite can be served the previous body for the 60 s CDN max-age);
// - the served ETag equals the listed etag, when both are present;
// - this instance wrote no blob while the request was in flight;
// and it is re-read TTL after its request started regardless, which bounds
// whatever those checks miss, e.g. a listing that keeps reporting the previous
// version after an overwrite made by another function instance. ~1,800 blobs
// per 15 min is under 200k fetches a day per instance, against 12 million
// before.
const LISTED_CACHE_SETTLE_MS = 5 * 60_000;
const LISTED_CACHE_TTL_MS = 15 * 60_000;
// Safety valve only: ~1,500 cards are a few MB of JSON text.
const LISTED_CACHE_MAX_CHARS = 32 * 1024 * 1024;

type ListedJsonCache = {
  entries: Map<string, { version: string; text: string; expiresAt: number }>;
  chars: number;
  fetched: number;
  cached: number;
  etagMismatch: number;
  etagUnchecked: number;
  // Bumped by every writeJson in this instance.
  writeEpoch: number;
};

// Kept on globalThis so every route bundle in one function instance shares it.
const listedCacheHolder = globalThis as typeof globalThis & {
  __listedJsonCache?: ListedJsonCache;
};
const listedCache: ListedJsonCache = (listedCacheHolder.__listedJsonCache ??= {
  entries: new Map(),
  chars: 0,
  fetched: 0,
  cached: 0,
  etagMismatch: 0,
  etagUnchecked: 0,
  writeEpoch: 0,
});

function normalizeEtag(value: string | null | undefined): string {
  return (value ?? "").replace(/^W\//, "").replace(/"/g, "");
}

function forgetListedJson(pathname: string): void {
  const previous = listedCache.entries.get(pathname);
  if (!previous) return;
  listedCache.chars -= previous.text.length;
  listedCache.entries.delete(pathname);
}

function invalidateListedJson(pathname: string): void {
  listedCache.writeEpoch += 1;
  forgetListedJson(pathname);
}

function rememberListedJson(
  pathname: string,
  version: string,
  text: string,
  requestedAt: number,
): void {
  forgetListedJson(pathname);
  // Counted from when the request started, not from when the body arrived: a
  // slow response must not outlive the bound. Jittered so the entries filled
  // by one cold call do not all expire in the same later call.
  const expiresAt =
    requestedAt + LISTED_CACHE_TTL_MS * (0.75 + Math.random() * 0.5);
  if (expiresAt <= Date.now()) return;
  if (text.length > LISTED_CACHE_MAX_CHARS) return;
  if (listedCache.chars + text.length > LISTED_CACHE_MAX_CHARS) {
    listedCache.entries.clear();
    listedCache.chars = 0;
  }
  listedCache.entries.set(pathname, { version, text, expiresAt });
  listedCache.chars += text.length;
}

// Running totals for this function instance, sent as the x-blob-reads header
// so a caller can see that repeat calls stop fetching. Not a billing count:
// failed attempts are not included.
export function listedReadStats(): string {
  return `fetched=${listedCache.fetched};cached=${listedCache.cached};entries=${listedCache.entries.size};etagMismatch=${listedCache.etagMismatch};etagUnchecked=${listedCache.etagUnchecked}`;
}

function createLimiter(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      // The releasing task hands its slot over directly (active stays
      // unchanged), so a newcomer cannot slip in between release and wake-up.
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

const withBlobSlot = createLimiter(BLOB_CALL_CONCURRENCY);
const withFetchSlot = createLimiter(BLOB_FETCH_CONCURRENCY);

async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function kstParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    kstFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function getKstDate(now = new Date()): string {
  const parts = kstParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getKstIso(now = new Date()): string {
  const parts = kstParts(now);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;
}

export function slugifyProject(value: string): string {
  const slug = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, "-")
    .replace(new RegExp("[^\\p{L}\\p{N}-]", "gu"), "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) throw new Error("project must produce a non-empty slug");
  return slug;
}

export function padSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) {
    throw new Error("seq must be an integer from 1 to 999");
  }
  return String(seq).padStart(3, "0");
}

export function requestPath(slug: string): string {
  return `req/${slug}.json`;
}

export function answerPrefix(slug: string): string {
  return `ans/${slug}/`;
}

export function answerPath(slug: string, answerId: string): string {
  return `${answerPrefix(slug)}${answerId}.json`;
}

export async function blobHead(pathnameOrUrl: string): Promise<HeadBlobResult> {
  return head(pathnameOrUrl, { token: blobToken() });
}

export async function readJson<T>(pathnameOrUrl: string): Promise<T> {
  // Read via an authenticated head() (needs the RW token) then fetch the URL.
  // Blobs are public-access (see writeJson note); their URLs sit under an
  // unpublished store hostname, and the truly sensitive field (secrets) is
  // end-to-end encrypted, so plaintext here is a documented residual risk only.
  return withBlobSlot(() =>
    withRetry(async () => {
      const meta = await head(pathnameOrUrl, { token: blobToken() });
      const res = await fetch(meta.url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Blob JSON not found: ${pathnameOrUrl} (${res.status})`);
      }
      return (await res.json()) as T;
    }),
  );
}

export async function readListedJson<T>(blob: ListBlobResultBlob): Promise<T> {
  const uploadedAt = new Date(blob.uploadedAt).getTime();
  const listedEtag = normalizeEtag(blob.etag);
  const version = `${listedEtag}@${uploadedAt}`;
  const remembered = listedCache.entries.get(blob.pathname);
  if (
    remembered &&
    remembered.version === version &&
    Date.now() < remembered.expiresAt
  ) {
    listedCache.cached += 1;
    // Parsed per call so callers never share one object.
    return JSON.parse(remembered.text) as T;
  }

  // list() already returned the blob URL, so skip head(). The version query
  // changes on every overwrite: best-effort cache-busting against the 60 s
  // CDN max-age writeJson sets. If the CDN ignores the query, reads are just
  // as fresh as the old head()+fetch of the same URL, never staler.
  const url = new URL(blob.url);
  url.searchParams.set("v", String(uploadedAt));
  return withFetchSlot(() =>
    withRetry(async () => {
      // Decided before the request: a slow response must not turn a body read
      // inside the settle window, or across a write, into a remembered one.
      const requestedAt = Date.now();
      const settled = requestedAt - uploadedAt >= LISTED_CACHE_SETTLE_MS;
      const writeEpoch = listedCache.writeEpoch;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Blob JSON not found: ${blob.pathname} (${res.status})`);
      }
      const text = await res.text();
      const value = JSON.parse(text) as T;
      listedCache.fetched += 1;
      const servedEtag = normalizeEtag(res.headers.get("etag"));
      const sameVersion =
        !listedEtag || !servedEtag || listedEtag === servedEtag;
      if (!sameVersion) listedCache.etagMismatch += 1;
      else if (!listedEtag || !servedEtag) listedCache.etagUnchecked += 1;
      if (
        settled &&
        sameVersion &&
        writeEpoch === listedCache.writeEpoch
      ) {
        rememberListedJson(blob.pathname, version, text, requestedAt);
      }
      return value;
    }),
  );
}

export async function writeJson(
  pathname: string,
  value: unknown,
): Promise<void> {
  // Before and after the write, also when put() throws (the store may have
  // accepted the body): no read in flight across it is remembered, and nothing
  // remembered for this pathname survives it. Covers this instance only; other
  // instances rely on the checks in readListedJson.
  invalidateListedJson(pathname);
  try {
    await putJson(pathname, value);
  } finally {
    invalidateListedJson(pathname);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isBlobNotFound(error: unknown): boolean {
  return error instanceof BlobNotFoundError;
}

// The stored body together with the version it belongs to. readJson() pairs a
// head() with whatever the public URL serves, and for up to the 60 s CDN
// max-age that can be the body from before the last overwrite: a route that
// decides from it ("already parked", "still open") then acts on an old card.
// Here the body only counts when its ETag is the one head() reported.
async function readVersionedJson<T>(
  pathname: string,
): Promise<{ value: T; etag: string | undefined }> {
  for (let attempt = 0; ; attempt += 1) {
    const meta = await withBlobSlot(() => head(pathname, { token: blobToken() }));
    const url = new URL(meta.url);
    url.searchParams.set("v", String(new Date(meta.uploadedAt).getTime()));
    const res = await fetch(url, { cache: "no-store" });
    const listedEtag = normalizeEtag(meta.etag);
    const servedEtag = normalizeEtag(res.headers.get("etag"));
    if (res.ok && (!listedEtag || !servedEtag || listedEtag === servedEtag)) {
      return { value: (await res.json()) as T, etag: meta.etag };
    }
    if (attempt >= 5) {
      throw new Error(
        `Blob JSON not readable at its current version: ${pathname} (${res.status})`,
      );
    }
    await sleep(200 * (attempt + 1));
  }
}

// Read-modify-write that cannot put an old copy back. Three routes rewrite a
// request blob (answer, dismiss, visibility); with plain read + writeJson, one
// that read before another's write restored its stale snapshot afterwards —
// an answered card went back to "open". The write here only lands if the blob
// is still the version that was read; otherwise it is read again and `mutate`
// reapplied. `mutate` returns null when there is nothing to change.
export async function updateJson<T>(
  pathname: string,
  mutate: (current: T) => T | null,
): Promise<{ value: T; written: boolean }> {
  for (let attempt = 0; ; attempt += 1) {
    const { value: current, etag } = await readVersionedJson<T>(pathname);
    const next = mutate(current);
    if (next === null) return { value: current, written: false };

    invalidateListedJson(pathname);
    try {
      await putJson(pathname, next, etag ? { ifMatch: etag } : {});
      return { value: next, written: true };
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt >= 5) {
        throw error;
      }
      await sleep(50 + Math.random() * 150);
    } finally {
      invalidateListedJson(pathname);
    }
  }
}

// Stores a blob that must not exist yet. true = this caller's body is what is
// stored; false = the pathname already holds someone else's. Two posts for
// the same project and day can be handed the same sequence number (nextSeq is
// a list followed by max+1), and writeJson would let the second silently
// replace the first card. `isOwn` recognises this caller's write in what is
// stored: by then the body may already differ (the card was answered), so it
// compares an id the caller put in, not the whole body.
export async function createJson<T>(
  pathname: string,
  value: T,
  isOwn: (stored: T) => boolean,
): Promise<boolean> {
  invalidateListedJson(pathname);
  try {
    // Bounded: if the store reports "exists" with a code the client retries,
    // the put would otherwise back off for minutes before failing.
    await putJson(pathname, value, {
      allowOverwrite: false,
      abortSignal: AbortSignal.timeout(8_000),
    });
    return true;
  } catch (error) {
    // "Already exists" and "stored, but the response was lost" both arrive
    // here as a failed put, so decide from what is stored now.
    let stored: T;
    try {
      stored = (await readVersionedJson<T>(pathname)).value;
    } catch {
      throw error;
    }
    return isOwn(stored);
  } finally {
    invalidateListedJson(pathname);
  }
}

async function putJson(
  pathname: string,
  value: unknown,
  options: {
    allowOverwrite?: boolean;
    ifMatch?: string;
    abortSignal?: AbortSignal;
  } = {},
): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    // NOTE: the provisioned Blob store is a PUBLIC store, so private access is
    // not available (audio/attachments also need public URLs). Request/answer
    // JSON therefore sit on public-access blobs under an unpublished store
    // hostname. Secret VALUES are end-to-end encrypted (see crypto-browser.ts),
    // so the residual exposure is only project context/transcript metadata to
    // someone who already knows the store hostname. Documented, accepted for a
    // single-user tool; upgrade path = a private store + authed media proxy.
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: options.allowOverwrite ?? true,
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    token: blobToken(),
  });
}

export async function listPrefix(
  prefix: string,
): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;

  do {
    const pageCursor = cursor;
    const page = await withBlobSlot(() =>
      withRetry(() =>
        list({
          prefix,
          cursor: pageCursor,
          limit: 1000,
          token: blobToken(),
        }),
      ),
    );
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return blobs;
}

export async function deletePath(pathnameOrUrl: string): Promise<void> {
  await del(pathnameOrUrl, { token: blobToken() });
}

export async function nextSeq(project: string, date: string): Promise<number> {
  const prefix = `req/${project}/${date}/`;
  const blobs = await listPrefix(prefix);
  let maximum = 0;

  for (const blob of blobs) {
    const filename = blob.pathname.slice(prefix.length);
    const match = /^(\d{3})\.json$/.exec(filename);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }

  if (maximum >= 999) {
    throw new Error(`No sequence numbers remain for ${project}/${date}`);
  }
  return maximum + 1;
}

// Stores a new card under the next free sequence number for (project, date).
// The number is only taken once the write went through; when another post got
// there first the next number is tried, with a short random wait so posts that
// collided once do not collide on every following number too.
export async function createRequestAtNextSeq<T extends { creationId: string }>(
  project: string,
  date: string,
  build: (slug: string, seq: number) => T,
): Promise<{ slug: string; seq: number }> {
  let seq = await nextSeq(project, date);
  for (let attempt = 0; ; attempt += 1) {
    const slug = `${project}/${date}/${padSeq(seq)}`;
    const value = build(slug, seq);
    const created = await createJson(
      requestPath(slug),
      value,
      (stored) => stored?.creationId === value.creationId,
    );
    if (created) return { slug, seq };
    if (attempt >= 24) throw new Error(`No free sequence number at ${slug}`);
    seq += 1;
    await sleep(Math.random() * 120);
  }
}

// How much of a listing was actually read. A blob that still fails after the
// retries is left out of the response rather than failing it, so a caller that
// needs every record (an export, a count) checks failed === 0.
export type ListCompleteness = { listed: number; read: number; failed: number };

export function newListCompleteness(): ListCompleteness {
  return { listed: 0, read: 0, failed: 0 };
}

export function listCompletenessHeader(completeness: ListCompleteness): string {
  return `listed=${completeness.listed};read=${completeness.read};failed=${completeness.failed}`;
}

export async function listRequests(
  prefix = "req/",
  completeness?: ListCompleteness,
): Promise<DecisionRequest[]> {
  const blobs = (await listPrefix(prefix)).filter((blob) =>
    blob.pathname.endsWith(".json"),
  );
  return readListedBlobs<DecisionRequest>(blobs, completeness);
}

export async function readListedBlobs<T>(
  blobs: ListBlobResultBlob[],
  completeness?: ListCompleteness,
): Promise<T[]> {
  const settled = await Promise.allSettled(
    blobs.map((blob) => readListedJson<T>(blob)),
  );

  if (completeness) {
    const failed = settled.filter(
      (result) => result.status === "rejected",
    ).length;
    completeness.listed += settled.length;
    completeness.read += settled.length - failed;
    completeness.failed += failed;
  }
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

// Inverse of requestPath(): "req/<slug>.json" -> "<slug>".
export function slugFromRequestPath(pathname: string): string | null {
  if (!pathname.startsWith("req/") || !pathname.endsWith(".json")) return null;
  return pathname.slice("req/".length, -".json".length) || null;
}

// Inverse of answerPath(): "ans/<slug>/<answerId>.json" -> "<slug>".
export function slugFromAnswerPath(pathname: string): string | null {
  if (!pathname.startsWith("ans/") || !pathname.endsWith(".json")) return null;
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash > "ans/".length ? pathname.slice("ans/".length, lastSlash) : null;
}
