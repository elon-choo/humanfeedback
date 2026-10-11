import "server-only";

import {
  listRequests,
  newListCompleteness,
  readJson,
  requestPath,
} from "@/lib/blob";
import { type ListedDecisionRequest, withLifecycle } from "@/lib/lifecycle";
import type { DecisionRequest, UsageSnapshot } from "@/lib/types";

const urgencyRank = { high: 0, medium: 1, low: 2 } as const;

export function sortOpenRequests<T extends DecisionRequest>(requests: T[]) {
  return requests
    .filter((request) => request.status === "open")
    .sort((a, b) => {
      const urgency = urgencyRank[a.urgency] - urgencyRank[b.urgency];
      if (urgency !== 0) return urgency;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

/** Cards the main list leaves out: by the lifecycle rule, or cleared by the owner. */
export type HiddenCounts = {
  dormant: number;
  superseded: number;
  dismissed: number;
};

const NOTHING_HIDDEN: HiddenCounts = { dormant: 0, superseded: 0, dismissed: 0 };

function countHidden(requests: ListedDecisionRequest[]): HiddenCounts {
  const counts = { ...NOTHING_HIDDEN };
  for (const request of requests) {
    if (request.status === "dismissed") counts.dismissed += 1;
    else if (request.view === "dormant") counts.dormant += 1;
    else if (request.view === "superseded") counts.superseded += 1;
  }
  return counts;
}

// Every card with its list placement. `partial` = some blobs could not be
// read, so lists and counts built from this are short.
async function loadCards() {
  const completeness = newListCompleteness();
  const all = withLifecycle(
    await listRequests("req/", completeness),
    Date.now(),
  );
  return { all, partial: completeness.failed > 0 };
}

// The main list: open cards the lifecycle rule keeps in front of the owner.
// The rest are counted here and listed by the archive loaders below.
export async function getOpenRequests(project?: string) {
  try {
    const { all, partial } = await loadCards();
    const scoped = project
      ? all.filter((request) => request.project === project)
      : all;
    return {
      requests: sortOpenRequests(scoped).filter(
        (request) => request.view === "active",
      ),
      hidden: countHidden(scoped),
      partial,
      unavailable: false,
    };
  } catch (error) {
    console.error("결정 목록을 불러오지 못했습니다.", error);
    return {
      requests: [] as ListedDecisionRequest[],
      hidden: NOTHING_HIDDEN,
      partial: false,
      unavailable: true,
    };
  }
}

export type ArchiveProjectSummary = HiddenCounts & { project: string };

// The archive front page: how much each project has in it. The cards
// themselves are loaded one project at a time (getArchiveProject) so the page
// stays small however long the archive grows.
export async function getArchiveSummary() {
  try {
    const { all, partial } = await loadCards();
    const byProject = new Map<string, ListedDecisionRequest[]>();
    for (const request of all) {
      const group = byProject.get(request.project);
      if (group) group.push(request);
      else byProject.set(request.project, [request]);
    }
    const total = (counts: HiddenCounts) =>
      counts.dormant + counts.superseded + counts.dismissed;
    const projects: ArchiveProjectSummary[] = [...byProject.entries()]
      .map(([project, requests]) => ({ project, ...countHidden(requests) }))
      .filter((summary) => total(summary) > 0)
      .sort((a, b) => total(b) - total(a));
    return { projects, totals: countHidden(all), partial, unavailable: false };
  } catch (error) {
    console.error("보관함을 불러오지 못했습니다.", error);
    return {
      projects: [] as ArchiveProjectSummary[],
      totals: NOTHING_HIDDEN,
      partial: false,
      unavailable: true,
    };
  }
}

/** One repeated card: the newest copy and the older open copies behind it. */
export type RepeatGroup = {
  newest: DecisionRequest;
  members: ListedDecisionRequest[];
};

// One project's archive, nothing deleted: cards past the age rule or parked
// by hand, older copies of a repeated card (each one listed, so every open
// card can be reached from a list), and cards cleared with "이미 처리했어요".
export async function getArchiveProject(project: string) {
  try {
    const { all, partial } = await loadCards();
    const cards = all.filter((request) => request.project === project);
    const bySlug = new Map(cards.map((request) => [request.slug, request]));
    const newestFirst = (a: DecisionRequest, b: DecisionRequest) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      (a.slug < b.slug ? 1 : -1);

    const repeats = new Map<string, RepeatGroup>();
    for (const request of cards) {
      if (request.view !== "superseded") continue;
      // A card whose newest copy could not be read still gets its own row.
      const newest = bySlug.get(request.supersededBy ?? "") ?? request;
      const group = repeats.get(newest.slug);
      if (group) group.members.push(request);
      else repeats.set(newest.slug, { newest, members: [request] });
    }
    for (const group of repeats.values()) group.members.sort(newestFirst);

    return {
      dormant: cards
        .filter((request) => request.view === "dormant")
        .sort(newestFirst),
      repeats: [...repeats.values()].sort(
        (a, b) => b.members.length - a.members.length,
      ),
      dismissed: cards
        .filter((request) => request.status === "dismissed")
        .sort(newestFirst),
      partial,
      unavailable: false,
    };
  } catch (error) {
    console.error(`보관함을 불러오지 못했습니다: ${project}`, error);
    return {
      dormant: [] as ListedDecisionRequest[],
      repeats: [] as RepeatGroup[],
      dismissed: [] as ListedDecisionRequest[],
      partial: false,
      unavailable: true,
    };
  }
}

export async function getDecisionRequest(slug: string) {
  try {
    return await readJson<DecisionRequest>(requestPath(slug));
  } catch (error) {
    console.error(`결정을 불러오지 못했습니다: ${slug}`, error);
    return null;
  }
}

export async function getUsageSnapshot(): Promise<UsageSnapshot | null> {
  try {
    return await readJson<UsageSnapshot>("usage/latest.json");
  } catch {
    // No snapshot yet (pusher hasn't posted) — render nothing, not an error.
    return null;
  }
}
