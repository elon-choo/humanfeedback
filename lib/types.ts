export type Urgency = "low" | "medium" | "high";

/** "dismissed" = the owner cleared it without answering (already handled elsewhere).
 *  Dismissed requests drop out of the open inbox but the blob is kept, so a
 *  mis-tap is restorable (POST .../dismiss {restore:true}). */
export type RequestStatus = "open" | "answered" | "dismissed";

export type AnswerKind = "voice" | "text" | "number";

export type Effort = "낮음" | "보통" | "높음";

export interface DecisionOption {
  n: number;
  label: string;
  whatChanges: string;
  upside: string;
  downside: string;
  effort: Effort;
  reversible: boolean;
  recommended: boolean;
}

export interface DecisionRecommendation {
  n: number;
  why: string;
}

export interface SecretRequest {
  id: string;
  label: string;
  hint: string;
  required: boolean;
}

export interface EncryptedSecret {
  id: string;
  alg: "ecdh-p256-hkdf-sha256-aes256gcm";
  ephemeralPubKey: string;
  iv: string;
  ciphertext: string;
  aad: string;
}

export interface AnswerAttachment {
  name: string;
  url: string;
  contentType: string;
  size: number;
}

export interface DecisionRequest {
  slug: string;
  project: string;
  date: string;
  seq: number;
  status: RequestStatus;
  urgency: Urgency;
  createdAt: string;
  answeredAt: string | null;
  /** Set when status === "dismissed"; cleared on restore. Absent on older blobs. */
  dismissedAt?: string | null;
  /** Which credential dismissed it — "pin" = the owner in the browser, "bearer" =
   *  an agent/CLI token. Mirrors DecisionAnswer.answeredVia so a cleared card is
   *  auditable (an agent can never silently erase an owner decision). */
  dismissedVia?: "pin" | "bearer";
  /** Overrides the computed list placement of an open card (lib/lifecycle.ts):
   *  "keep" = stays in the main list however old it gets (payment or send
   *  approvals, an incident in progress, a far deadline); "dormant" = parked
   *  in the archive now. Absent = by rule. Set at creation (keepVisible) or
   *  through POST .../visibility. */
  visibility?: "keep" | "dormant";
  visibilitySetAt?: string;
  /** Who set it, same meaning as dismissedVia. */
  visibilitySetVia?: "pin" | "bearer";
  cwd: string;
  machine: string;
  /** Claude Code session UUID that posted this (CLAUDE_CODE_SESSION_ID), for precise
   *  routing of the answer back to the exact session. Optional (older clients omit it). */
  sessionId?: string;
  /** Human-readable session/context label (e.g. a short task description), shown to the owner. */
  sessionLabel?: string;
  title: string;
  tldr: string;
  whyNow: string;
  context: string;
  stakes: string;
  options: DecisionOption[];
  recommendation: DecisionRecommendation | null;
  ifIgnored: string;
  allowFreeform: boolean;
  secretRequests?: SecretRequest[];
  recipientPubKey?: string;
}

export type CreateDecisionRequest = Omit<
  DecisionRequest,
  | "slug"
  | "date"
  | "seq"
  | "status"
  | "createdAt"
  | "answeredAt"
  | "visibility"
  | "visibilitySetAt"
  | "visibilitySetVia"
> & {
  date?: string;
  /** Posts the card with visibility "keep". */
  keepVisible?: boolean;
};

export interface DecisionAnswer {
  answerId: string;
  slug: string;
  createdAt: string;
  kind: AnswerKind;
  chosenOption: number | null;
  transcript: string | null;
  text: string | null;
  audioUrls: string[];
  durationSec: number;
  pickedUp: boolean;
  // Server-stamped at answer time: which credential authenticated this answer.
  // "pin" = the owner's PIN cookie (phone); "bearer" = the shared API token.
  // Consumers that must prove a HUMAN answered (not an automated token holder)
  // require answeredVia === "pin". Absent on answers written before this field
  // existed → treat as unproven (fail-closed).
  answeredVia?: "pin" | "bearer";
  secrets?: EncryptedSecret[];
  attachments?: AnswerAttachment[];
}

export interface CreateDecisionAnswer {
  kind: AnswerKind;
  chosenOption?: number;
  text?: string;
  audioUrls?: string[];
  durationSec?: number;
  secrets?: EncryptedSecret[];
  attachments?: AnswerAttachment[];
}

export interface AnswerInboxItem {
  request: DecisionRequest;
  answers: DecisionAnswer[];
}

/** One rate-limit window for a Claude account (5h / 7d / Fable). */
export interface UsageWindow {
  pct: number;
  resetsAt?: string;
  countdown?: string;
}

/** One Claude account's live limit picture, pushed from the local cswap daemon. */
export interface UsageAccount {
  number: number;
  email: string;
  active: boolean;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  fable: UsageWindow | null;
}

/** The latest account-usage snapshot shown at the top of the dashboard. */
export interface UsageSnapshot {
  accounts: UsageAccount[];
  /** The pusher's own clock (best-effort). */
  sourceUpdatedAt?: string;
  /** Server receipt time (authoritative for staleness); null when no snapshot exists yet. */
  receivedAt: string | null;
}
