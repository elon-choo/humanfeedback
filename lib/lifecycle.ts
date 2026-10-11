import type { DecisionRequest } from "@/lib/types";

// Where an OPEN card is shown. Computed on every read and never stored: the
// blob keeps status "open", so a card that drops out of the main list is still
// answerable at its URL and comes back by itself when the rule stops applying.
//   active     — in the main list
//   dormant    — older than DORMANT_AFTER_MS, or parked by hand; in the archive
//   superseded — a newer card asks the same thing; in the archive
// By 2026-10-10 the main list held 574 open cards: 311 were older copies of a
// card posted again (309 of them one automated alert) and 217 had waited more
// than a week.
export type CardView = "active" | "dormant" | "superseded";

export const DORMANT_AFTER_MS = 7 * 24 * 60 * 60_000;

// Two cards whose titles differ only in a number can be two questions ("3번
// 재시도?" / "5번 재시도?"). Once this many cards share the title shape it is
// a recurring alert ("12명이 안 들어왔습니다"), and only the newest is shown.
const NUMBERED_GROUP_MIN = 3;

export interface CardGroup {
  /** Cards asking the same thing, this one included, whatever their status. */
  count: number;
  firstCreatedAt: string;
}

export interface CardLifecycle {
  view: CardView;
  /** Set on a card that has older copies behind it. */
  group?: CardGroup;
  /** On a superseded card: slug of the newest copy. */
  supersededBy?: string;
}

export type ListedDecisionRequest = DecisionRequest & Partial<CardLifecycle>;

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    // Other control characters carry nothing a reader sees, and \u0001
    // stands for a number below.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

function createdMs(request: DecisionRequest): number {
  const timestamp = Date.parse(request.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

// createdAt has one-second resolution; the slug (date + sequence) breaks ties.
function isNewer(left: DecisionRequest, right: DecisionRequest): boolean {
  const difference = createdMs(left) - createdMs(right);
  if (difference !== 0) return difference > 0;
  return left.slug > right.slug;
}

function groupBy(
  requests: DecisionRequest[],
  keyOf: (request: DecisionRequest) => string,
): Map<string, DecisionRequest[]> {
  const groups = new Map<string, DecisionRequest[]>();
  for (const request of requests) {
    const key = keyOf(request);
    const group = groups.get(key);
    if (group) group.push(request);
    else groups.set(key, [request]);
  }
  return groups;
}

/**
 * Lifecycle of every open card in `requests`, keyed by slug. Pass the whole
 * store, not only the open cards: an answered or dismissed card still
 * supersedes the older open copies of itself, so clearing the newest copy of
 * an alert does not bring the previous 300 back.
 */
export function cardLifecycles(
  requests: DecisionRequest[],
  now: number,
): Map<string, CardLifecycle> {
  const exactKey = (request: DecisionRequest) =>
    `${request.project}\n${normalizeTitle(request.title)}`;
  // Digit runs become a character no title contains, so "승인 #" is not read
  // as one more copy of "승인 1", "승인 2".
  const numberedKey = (request: DecisionRequest) =>
    `${request.project}\n${normalizeTitle(request.title).replace(/\d+/g, "\u0001")}`;
  const exactGroups = groupBy(requests, exactKey);
  const numberedGroups = groupBy(requests, numberedKey);

  const lifecycles = new Map<string, CardLifecycle>();
  for (const request of requests) {
    if (request.status !== "open") continue;

    const numbered = numberedGroups.get(numberedKey(request)) ?? [];
    const copies =
      numbered.length >= NUMBERED_GROUP_MIN
        ? numbered
        : (exactGroups.get(exactKey(request)) ?? []);
    const newest = copies.reduce(
      (latest, other) => (isNewer(other, latest) ? other : latest),
      request,
    );
    const hasNewerCopy = newest !== request;

    let view: CardView;
    if (request.visibility === "keep") {
      view = "active";
    } else if (hasNewerCopy) {
      view = "superseded";
    } else if (
      request.visibility === "dormant" ||
      now - createdMs(request) > DORMANT_AFTER_MS
    ) {
      view = "dormant";
    } else {
      view = "active";
    }

    const lifecycle: CardLifecycle = { view };
    if (view === "superseded") lifecycle.supersededBy = newest.slug;
    if (copies.length > 1 && !hasNewerCopy) {
      const first = copies.reduce((oldest, other) =>
        isNewer(oldest, other) ? other : oldest,
      );
      lifecycle.group = {
        count: copies.length,
        firstCreatedAt: first.createdAt,
      };
    }
    lifecycles.set(request.slug, lifecycle);
  }
  return lifecycles;
}

/** `requests` with `view`/`group` set on the open ones (copies, not mutated). */
export function withLifecycle(
  requests: DecisionRequest[],
  now: number,
): ListedDecisionRequest[] {
  const lifecycles = cardLifecycles(requests, now);
  return requests.map((request) => {
    const lifecycle = lifecycles.get(request.slug);
    return lifecycle ? { ...request, ...lifecycle } : request;
  });
}
