// cardLifecycles (lib/lifecycle.ts) decides which open cards stay in the main
// list. Runs against the real source; the only import there is a type.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

// LIFECYCLE_SOURCE points at a deliberately broken copy when checking that a guard is really tested.
const source = await readFile(process.env.LIFECYCLE_SOURCE ?? new URL("../lib/lifecycle.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "lifecycle.ts",
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { cardLifecycles, withLifecycle, DORMANT_AFTER_MS } = await import(moduleUrl);

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-10-11T12:00:00+09:00");
let seq = 0;
// A card created `ageMs` before NOW.
const card = (project, title, ageMs, extra = {}) => {
  seq += 1;
  return {
    slug: `${project}/2026-01-01/${String(seq).padStart(3, "0")}`,
    project,
    title,
    status: "open",
    createdAt: new Date(NOW - ageMs).toISOString(),
    ...extra,
  };
};
const views = (cards) => {
  const lifecycles = cardLifecycles(cards, NOW);
  return cards.map((c) => lifecycles.get(c.slug)?.view ?? null);
};
let checks = 0;
const check = (name, run) => {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
};

check("a recent open card is active, an old one dormant", () => {
  assert.deepEqual(views([card("p", "새 질문", DAY), card("p", "오래된 질문", 8 * DAY)]), ["active", "dormant"]);
});

check("the 7-day boundary: exactly 7 days is still active, one ms more is dormant", () => {
  assert.equal(DORMANT_AFTER_MS, 7 * DAY);
  assert.deepEqual(views([card("p", "경계", 7 * DAY), card("p", "경계 넘음", 7 * DAY + 1)]), ["active", "dormant"]);
});

check("answered and dismissed cards get no lifecycle", () => {
  assert.deepEqual(views([card("p", "답함", 30 * DAY, { status: "answered" }), card("p", "치움", 30 * DAY, { status: "dismissed" })]), [null, null]);
});

check("an older open copy of the same title is superseded; the newest carries the group", () => {
  const older = card("p", "같은  질문", 3 * DAY);
  const newer = card("p", "같은 질문", DAY); // whitespace differs only
  const lifecycles = cardLifecycles([older, newer], NOW);
  assert.deepEqual(lifecycles.get(older.slug), { view: "superseded", supersededBy: newer.slug });
  assert.deepEqual(lifecycles.get(newer.slug), { view: "active", group: { count: 2, firstCreatedAt: older.createdAt } });
});

check("the same title in another project is a different card", () => {
  assert.deepEqual(views([card("p", "같은 질문", 3 * DAY), card("q", "같은 질문", DAY)]), ["active", "active"]);
});

check("an answered or dismissed newer copy still supersedes the older open ones", () => {
  assert.deepEqual(views([card("p", "경고", 3 * DAY), card("p", "경고", DAY, { status: "answered" })]), ["superseded", null]);
  assert.deepEqual(views([card("p", "알림", 3 * DAY), card("p", "알림", DAY, { status: "dismissed" })]), ["superseded", null]);
});

check("an older answered copy does not hide the newer open card", () => {
  assert.deepEqual(views([card("p", "다시 묻기", 3 * DAY, { status: "answered" }), card("p", "다시 묻기", DAY)]), [null, "active"]);
});

check("two titles that differ in a number are two questions", () => {
  assert.deepEqual(views([card("p", "재시도 3번까지?", 2 * DAY), card("p", "재시도 5번까지?", DAY)]), ["active", "active"]);
});

check("three or more titles that differ only in numbers are one recurring alert", () => {
  const cards = [card("p", "4명이 안 들어왔습니다", 3 * DAY), card("p", "12명이 안 들어왔습니다", 2 * DAY), card("p", "7명이 안 들어왔습니다", DAY)];
  const lifecycles = cardLifecycles(cards, NOW);
  assert.deepEqual(cards.map((c) => lifecycles.get(c.slug).view), ["superseded", "superseded", "active"]);
  assert.deepEqual(cards.map((c) => lifecycles.get(c.slug).supersededBy), [cards[2].slug, cards[2].slug, undefined]);
  assert.deepEqual(lifecycles.get(cards[2].slug).group, { count: 3, firstCreatedAt: cards[0].createdAt });
});

check("a literal # in a title is not a number: 승인 # is not a copy of 승인 1, 승인 2", () => {
  assert.deepEqual(views([card("p", "승인 #", 3 * DAY), card("p", "승인 1", 2 * DAY), card("p", "승인 2", DAY)]), ["active", "active", "active"]);
});

check("Korean titles in NFC and NFD are the same title", () => {
  assert.deepEqual(views([card("p", "결제 승인".normalize("NFD"), 2 * DAY), card("p", "결제 승인".normalize("NFC"), DAY)]), ["superseded", "active"]);
});

check("the newest of a group goes dormant by age like any card, and keeps its group", () => {
  const cards = [card("p", "묵은 경고", 40 * DAY), card("p", "묵은 경고", 10 * DAY)];
  const lifecycles = cardLifecycles(cards, NOW);
  assert.deepEqual(cards.map((c) => lifecycles.get(c.slug).view), ["superseded", "dormant"]);
  assert.equal(lifecycles.get(cards[1].slug).group.count, 2);
});

check("visibility keep stays active when old and when a newer copy exists", () => {
  assert.deepEqual(views([card("p", "결제 승인", 90 * DAY, { visibility: "keep" })]), ["active"]);
  const kept = card("p", "장애", 5 * DAY, { visibility: "keep" });
  const keptNewer = card("p", "장애", DAY);
  assert.deepEqual(views([kept, keptNewer]), ["active", "active"]);
  assert.equal(cardLifecycles([kept, keptNewer], NOW).get(kept.slug).supersededBy, undefined);
});

check("visibility dormant parks a fresh card; an unknown value falls back to the rule", () => {
  assert.deepEqual(views([card("p", "나중에", DAY, { visibility: "dormant" }), card("p", "이상값", DAY, { visibility: "whatever" })]), ["dormant", "active"]);
});

check("superseded wins over parked; a parked newest copy still supersedes", () => {
  assert.deepEqual(views([card("p", "x", 2 * DAY, { visibility: "dormant" }), card("p", "x", DAY, { visibility: "dormant" })]), ["superseded", "dormant"]);
});

check("same createdAt: the higher slug is the newer card", () => {
  const first = card("p", "동시", DAY);
  const second = { ...card("p", "동시", DAY), createdAt: first.createdAt };
  assert.deepEqual(views([second, first]), ["active", "superseded"]);
});

check("an unreadable createdAt counts as oldest, not as now", () => {
  assert.deepEqual(views([card("p", "깨진 시각", 0, { createdAt: "not a date" })]), ["dormant"]);
});

check("withLifecycle annotates open cards and leaves the input untouched", () => {
  const open = card("p", "열림", DAY);
  const answered = card("p", "답함2", DAY, { status: "answered" });
  const annotated = withLifecycle([open, answered], NOW);
  assert.equal(annotated[0].view, "active");
  assert.equal("view" in annotated[1], false);
  assert.equal("view" in open, false);
});

console.log(`\n${checks}/${checks} lifecycle checks passed`);
