export type Urgency = "low" | "medium" | "high";

export type RequestStatus = "open" | "answered";

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
  "slug" | "date" | "seq" | "status" | "createdAt" | "answeredAt"
> & {
  date?: string;
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
