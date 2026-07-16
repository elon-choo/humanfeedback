import {
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
  const meta = await head(pathnameOrUrl, { token: blobToken() });
  const res = await fetch(meta.url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Blob JSON not found: ${pathnameOrUrl} (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function writeJson(
  pathname: string,
  value: unknown,
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
    allowOverwrite: true,
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
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
      token: blobToken(),
    });
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

export async function listRequests(
  prefix = "req/",
): Promise<DecisionRequest[]> {
  const blobs = (await listPrefix(prefix)).filter((blob) =>
    blob.pathname.endsWith(".json"),
  );
  const settled = await Promise.allSettled(
    blobs.map((blob) => readJson<DecisionRequest>(blob.pathname)),
  );

  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}
