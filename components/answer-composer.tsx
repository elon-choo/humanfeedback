"use client";

import { upload } from "@vercel/blob/client";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { encryptSecret, type EncryptedSecret } from "@/lib/crypto-browser";
import { OWNER_COMPUTER_LABEL } from "@/lib/public-config";
import type {
  AnswerAttachment,
  DecisionOption,
  SecretRequest,
} from "@/lib/types";

type Phase = "idle" | "arming" | "recording" | "processing" | "review" | "success";
type AnswerKind = "voice" | "text" | "number";

type AnswerBody = {
  kind: AnswerKind;
  chosenOption?: number;
  text?: string;
  audioUrls?: string[];
  durationSec?: number;
  secrets?: EncryptedSecret[];
  attachments?: AnswerAttachment[];
};

type AnswerResponse = {
  ok: true;
  answerId: string;
  transcript: string | null;
  chosenOption: number | null;
};

type ReviewAnswer = {
  answerId: string;
  transcript: string;
  chosenOption: number | null;
};

type SavedAnswer = {
  kind: AnswerKind;
  answerId?: string;
  chosenOption: number | null;
  transcript?: string;
  text?: string;
  secretCount?: number;
  attachmentCount?: number;
};

type UploadedSegment = {
  index: number;
  url: string | null;
  error?: string;
};

type ActiveSegment = {
  recorder: MediaRecorder;
  finalized: Promise<void>;
};

type AttachmentStatus = "uploading" | "uploaded" | "failed";

type AttachmentItem = {
  id: string;
  file?: File;
  name: string;
  contentType: string;
  size: number;
  status: AttachmentStatus;
  url?: string;
  error?: string;
};

type RecordingCoordinationDetail = {
  ownerId: string;
  active: boolean;
};

export type AnswerComposerProps = {
  slug: string;
  options: DecisionOption[];
  allowFreeform: boolean;
  secretRequests?: SecretRequest[];
  recipientPubKey?: string;
  variant?: "bar" | "inline";
  onAnswered?: (slug: string) => void;
};

const SEGMENT_MS = 60_000;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RECORDING_COORDINATION_EVENT = "humanfeedback:recording-coordination";
const MIC_FALLBACK_HINT = "이 환경은 마이크가 안 돼요 — 아래에 번호나 메모를 입력하세요";
const ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".txt",
  ".csv",
  ".md",
  ".json",
  ".rtf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
].join(",");

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

const ALLOWED_DOCUMENT_TYPES = new Set(Object.values(DOCUMENT_MIME_BY_EXTENSION));

function makeAnswerId() {
  const values = new Uint8Array(6);
  crypto.getRandomValues(values);
  let suffix = "";
  for (const value of values) suffix += ID_ALPHABET[value % ID_ALPHABET.length];
  return `a_${suffix}`;
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function errorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
    return "마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "잠시 문제가 생겼어요. 다시 시도해 주세요.";
}

function makeAttachmentId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function attachmentContentType(file: File) {
  const normalized = file.type.split(";")[0].trim().toLowerCase();
  if (normalized.startsWith("image/") || ALLOWED_DOCUMENT_TYPES.has(normalized)) {
    return normalized;
  }
  const extension = fileExtension(file.name);
  return IMAGE_MIME_BY_EXTENSION[extension] ?? DOCUMENT_MIME_BY_EXTENSION[extension] ?? "";
}

function safeAttachmentName(name: string) {
  const extension = fileExtension(name);
  const rawStem = extension ? name.slice(0, -(extension.length + 1)) : name;
  const stem = rawStem
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
  const safeExtension = extension.replace(/[^a-z0-9]/g, "").slice(0, 12);
  return safeExtension ? `${stem}.${safeExtension}` : stem;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function pastedImageFiles(clipboardData: DataTransfer | null): File[] {
  const itemImages = Array.from(clipboardData?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  return itemImages.length > 0
    ? itemImages
    : Array.from(clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
}

function MicIcon({ stop = false }: { stop?: boolean }) {
  if (stop) return <span className="block h-5 w-5 rounded-[5px] bg-white" />;
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function AnswerComposer({
  slug,
  options,
  allowFreeform,
  secretRequests = [],
  recipientPubKey,
  variant = "bar",
  onAnswered,
}: AnswerComposerProps) {
  const instanceId = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [error, setError] = useState("");
  const [busyLabel, setBusyLabel] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState<ReviewAnswer | null>(null);
  const [saved, setSaved] = useState<SavedAnswer | null>(null);
  const [micAvailable, setMicAvailable] = useState<boolean | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [encryptedSecretIds, setEncryptedSecretIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [anotherRecordingActive, setAnotherRecordingActive] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [reasonPhase, setReasonPhase] = useState<"idle" | "sending" | "sent">("idle");

  const mountedRef = useRef(true);
  const discardOnStopRef = useRef(false);
  const recordingRef = useRef(false);
  const stoppingRef = useRef(false);
  const generationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const activeSegmentRef = useRef<ActiveSegment | null>(null);
  const segmentIndexRef = useRef(0);
  const segmentUploadsRef = useRef<Array<Promise<UploadedSegment>>>([]);
  const recordingAnswerIdRef = useRef("");
  const startedAtRef = useRef(0);
  const rotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVoiceBodyRef = useRef<AnswerBody | null>(null);
  const encryptedSecretsRef = useRef<Record<string, EncryptedSecret>>({});
  const attachmentUploadsRef = useRef<Record<string, Promise<void>>>({});
  const attachmentResultsRef = useRef<Record<string, AnswerAttachment | Error>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const externalRecordingRef = useRef(false);
  const ownsRecordingSlotRef = useRef(false);
  const answeredNotifiedRef = useRef(false);

  const endpoint = `/api/answers/${slug
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const isInline = variant === "inline";

  function claimRecordingSlot(): boolean {
    if (externalRecordingRef.current) return false;
    if (ownsRecordingSlotRef.current) return true;

    ownsRecordingSlotRef.current = true;
    window.dispatchEvent(
      new CustomEvent<RecordingCoordinationDetail>(RECORDING_COORDINATION_EVENT, {
        detail: { ownerId: instanceId, active: true },
      }),
    );
    return true;
  }

  function releaseRecordingSlot() {
    if (!ownsRecordingSlotRef.current) return;
    ownsRecordingSlotRef.current = false;
    window.dispatchEvent(
      new CustomEvent<RecordingCoordinationDetail>(RECORDING_COORDINATION_EVENT, {
        detail: { ownerId: instanceId, active: false },
      }),
    );
  }

  function completeAnswer(answer: SavedAnswer) {
    setSaved(answer);
    setPhase("success");
    if (!answeredNotifiedRef.current) {
      answeredNotifiedRef.current = true;
      onAnswered?.(slug);
    }
  }

  function disableMic() {
    if (mountedRef.current) setMicAvailable(false);
  }

  const uploadAttachmentItem = useCallback(
    async (item: AttachmentItem) => {
      if (!item.file) return;

      try {
        const result = await upload(
          `files/${slug}/${safeAttachmentName(item.name)}`,
          item.file,
          {
            access: "public",
            handleUploadUrl: "/api/upload",
            multipart: true,
            contentType: item.contentType,
          },
        );
        if (!mountedRef.current) return;
        attachmentResultsRef.current[item.id] = {
          name: item.name,
          url: result.url,
          contentType: item.contentType,
          size: item.size,
        };
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === item.id
              ? {
                  ...attachment,
                  file: undefined,
                  status: "uploaded",
                  url: result.url,
                  error: undefined,
                }
              : attachment,
          ),
        );
      } catch (uploadError) {
        attachmentResultsRef.current[item.id] =
          uploadError instanceof Error
            ? uploadError
            : new Error("첨부 파일을 올리지 못했어요.");
        if (!mountedRef.current) return;
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === item.id
              ? {
                  ...attachment,
                  status: "failed",
                  error: errorMessage(uploadError),
                }
              : attachment,
          ),
        );
      }
    },
    [slug],
  );

  const addAttachmentFiles = useCallback(
    (incoming: File[]) => {
      const accepted: AttachmentItem[] = [];
      const rejected: string[] = [];

      for (const file of incoming) {
        const contentType = attachmentContentType(file);
        if (!contentType) {
          rejected.push(file.name);
          continue;
        }
        accepted.push({
          id: makeAttachmentId(),
          file,
          name: file.name || "attachment",
          contentType,
          size: file.size,
          status: "uploading",
        });
      }

      if (rejected.length > 0) {
        setError(`지원하지 않는 파일이에요: ${rejected.join(", ")}`);
      } else if (accepted.length > 0) {
        setError("");
      }

      if (accepted.length === 0) return;
      setAttachments((current) => [...current, ...accepted]);
      for (const item of accepted) {
        const pending = uploadAttachmentItem(item);
        attachmentUploadsRef.current[item.id] = pending;
        void pending.finally(() => {
          if (attachmentUploadsRef.current[item.id] === pending) {
            delete attachmentUploadsRef.current[item.id];
          }
        });
      }
    },
    [uploadAttachmentItem],
  );

  function retryAttachment(id: string) {
    const item = attachments.find((attachment) => attachment.id === id);
    if (!item?.file) return;
    setError("");
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === id
          ? { ...attachment, status: "uploading", error: undefined }
          : attachment,
      ),
    );
    delete attachmentResultsRef.current[id];
    const pending = uploadAttachmentItem({ ...item, status: "uploading", error: undefined });
    attachmentUploadsRef.current[id] = pending;
    void pending.finally(() => {
      if (attachmentUploadsRef.current[id] === pending) {
        delete attachmentUploadsRef.current[id];
      }
    });
  }

  function removeAttachment(id: string) {
    delete attachmentResultsRef.current[id];
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function updateSecretValue(id: string, value: string) {
    if (encryptedSecretsRef.current[id]) {
      delete encryptedSecretsRef.current[id];
      setEncryptedSecretIds(Object.keys(encryptedSecretsRef.current));
    }
    setSecretValues((current) => ({ ...current, [id]: value }));
  }

  async function pasteSecret(id: string) {
    setError("");
    let clipboardValue = "";
    try {
      if (!navigator.clipboard?.readText) throw new Error("클립보드 읽기를 지원하지 않아요.");
      clipboardValue = await navigator.clipboard.readText();
      updateSecretValue(id, clipboardValue);
    } catch {
      setError("붙여넣기 버튼을 쓸 수 없어요. 입력칸을 길게 눌러 붙여넣어 주세요.");
    } finally {
      clipboardValue = "";
    }
  }

  async function prepareSecrets(): Promise<EncryptedSecret[]> {
    // Secrets are an OPTIONAL side-channel, independent of the answer itself: whatever
    // token is filled in gets encrypted and attached, but a missing (even "required")
    // secret never blocks saving a number/voice/text answer. "required" is only a visual
    // hint that the owner probably wants to include that value.
    const provided = secretRequests.filter(
      (request) => secretValues[request.id]?.length > 0,
    );
    if (provided.length > 0 && !recipientPubKey) {
      throw new Error("암호화 키가 없어 비밀 값을 안전하게 보낼 수 없어요.");
    }

    const valuesToClear = new Set(provided.map((request) => request.id));
    try {
      for (const request of provided) {
        let plaintext = secretValues[request.id] ?? "";
        try {
          encryptedSecretsRef.current[request.id] = await encryptSecret({
            id: request.id,
            plaintext,
            recipientPubKey: recipientPubKey!,
            slug,
          });
        } finally {
          plaintext = "";
        }
      }
    } finally {
      if (valuesToClear.size > 0) {
        setSecretValues((current) => {
          const cleared = { ...current };
          for (const id of valuesToClear) cleared[id] = "";
          return cleared;
        });
      }
      setEncryptedSecretIds(Object.keys(encryptedSecretsRef.current));
    }

    return secretRequests
      .map((request) => encryptedSecretsRef.current[request.id])
      .filter((secret): secret is EncryptedSecret => Boolean(secret));
  }

  async function prepareAnswerBody(body: AnswerBody): Promise<AnswerBody> {
    // Encrypt first so password/token strings leave React state immediately,
    // while any already-started direct Blob uploads continue in parallel.
    const secrets = await prepareSecrets();
    const pendingUploads = attachments
      .map((attachment) => attachmentUploadsRef.current[attachment.id])
      .filter((pending): pending is Promise<void> => Boolean(pending));
    if (pendingUploads.length > 0) await Promise.all(pendingUploads);

    const failedAttachment = attachments.find(
      (attachment) => attachmentResultsRef.current[attachment.id] instanceof Error,
    );
    if (failedAttachment) {
      throw new Error("올리지 못한 첨부 파일을 재시도하거나 삭제해 주세요.");
    }

    const completedAttachments = attachments
      .map((attachment) => attachmentResultsRef.current[attachment.id])
      .filter((result): result is AnswerAttachment => Boolean(result) && !(result instanceof Error));

    if (completedAttachments.length !== attachments.length) {
      throw new Error("첨부 파일 상태를 확인할 수 없어요. 다시 첨부해 주세요.");
    }

    return {
      ...body,
      ...(secrets.length > 0 ? { secrets } : {}),
      ...(completedAttachments.length > 0
        ? { attachments: completedAttachments }
        : {}),
    };
  }

  function clearTimers() {
    if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    rotationTimerRef.current = null;
    elapsedTimerRef.current = null;
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function postAnswer(body: AnswerBody): Promise<AnswerResponse> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.redirected && new URL(response.url).pathname === "/unlock") {
      window.location.assign(`/unlock?next=${encodeURIComponent(window.location.pathname)}`);
      throw new Error("잠금이 만료되어 다시 확인이 필요해요.");
    }

    const payload = (await response.json().catch(() => null)) as (Partial<AnswerResponse> & { error?: string }) | null;
    if (!response.ok || !payload?.ok) {
      if (response.status === 401) {
        window.location.assign(`/unlock?next=${encodeURIComponent(window.location.pathname)}`);
      }
      if (response.status === 502) {
        throw new Error("음성을 글로 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      }
      if (response.status === 404) {
        throw new Error("이 결정을 찾을 수 없어요. 인박스에서 다시 열어 주세요.");
      }
      throw new Error(
        payload?.error === "Unable to save answer"
          ? "답을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요."
          : payload?.error || "답을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    }

    return {
      ok: true,
      answerId: payload.answerId ?? "",
      transcript: payload.transcript ?? null,
      chosenOption: payload.chosenOption ?? null,
    };
  }

  function beginSegment(stream: MediaStream, generation: number) {
    if (!recordingRef.current || generation !== generationRef.current) return;

    const index = segmentIndexRef.current++;
    const mimeType = pickMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
      : new MediaRecorder(stream, { audioBitsPerSecond: 128_000 });
    const chunks: BlobPart[] = [];
    let resolveFinalized!: () => void;
    let didFinalize = false;
    const finalized = new Promise<void>((resolve) => {
      resolveFinalized = resolve;
    });
    let resolveUpload!: (value: UploadedSegment) => void;
    let didResolveUpload = false;
    const uploaded = new Promise<UploadedSegment>((resolve) => {
      resolveUpload = resolve;
    });

    segmentUploadsRef.current.push(uploaded);

    const finishFinalizing = () => {
      if (didFinalize) return;
      didFinalize = true;
      resolveFinalized();
    };
    const finishUpload = (value: UploadedSegment) => {
      if (didResolveUpload) return;
      didResolveUpload = true;
      resolveUpload(value);
    };

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    recorder.addEventListener("error", () => {
      const failedDuringActiveRecording = recordingRef.current;
      discardOnStopRef.current = true;
      recordingRef.current = false;
      releaseRecordingSlot();
      generationRef.current += 1;
      clearTimers();
      disableMic();
      finishUpload({ index, url: null, error: `${index + 1}번째 녹음 조각을 만들지 못했어요.` });
      finishFinalizing();
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be transitioning to inactive after error.
        }
      }
      releaseStream();
      if (failedDuringActiveRecording && mountedRef.current) {
        setPhase("idle");
        setError("");
      }
    });

    recorder.addEventListener("stop", () => {
      if (discardOnStopRef.current) {
        finishUpload({ index, url: null });
        finishFinalizing();
        return;
      }

      const recordedType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: recordedType });
      if (blob.size === 0) {
        finishUpload({ index, url: null, error: `${index + 1}번째 녹음이 비어 있어요.` });
        finishFinalizing();
        return;
      }

      const pathname = `audio/${slug}/${recordingAnswerIdRef.current}-${index}.webm`;
      const normalizedContentType = (blob.type || "audio/webm").split(";")[0];
      void upload(pathname, blob, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: true,
        contentType: normalizedContentType,
      })
        .then((result) => {
          if (mountedRef.current) setUploadedCount((count) => count + 1);
          finishUpload({ index, url: result.url });
        })
        .catch((uploadError: unknown) => {
          finishUpload({ index, url: null, error: errorMessage(uploadError) });
        });
      finishFinalizing();
    });

    recorder.start(1_000);
    activeSegmentRef.current = { recorder, finalized };
  }

  async function stopSegment(segment: ActiveSegment | null) {
    if (!segment) return;
    if (segment.recorder.state !== "inactive") segment.recorder.stop();
    await segment.finalized;
    if (activeSegmentRef.current === segment) activeSegmentRef.current = null;
  }

  function scheduleRotation(generation: number) {
    if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current);
    rotationTimerRef.current = setTimeout(() => {
      void rotateSegment(generation);
    }, SEGMENT_MS);
  }

  async function rotateSegment(generation: number) {
    if (!recordingRef.current || generation !== generationRef.current || stoppingRef.current) return;
    const current = activeSegmentRef.current;

    try {
      await stopSegment(current);
      if (!recordingRef.current || generation !== generationRef.current || stoppingRef.current) return;
      const stream = streamRef.current;
      if (!stream) throw new Error("마이크 연결이 끊겼어요. 다시 녹음해 주세요.");
      beginSegment(stream, generation);
      scheduleRotation(generation);
    } catch (rotationError) {
      recordingRef.current = false;
      releaseRecordingSlot();
      clearTimers();
      releaseStream();
      if (mountedRef.current) {
        setPhase("idle");
        disableMic();
        setError("");
      }
    }
  }

  async function startRecording() {
    if (
      phase !== "idle" ||
      recordingRef.current ||
      stoppingRef.current ||
      externalRecordingRef.current
    ) {
      return;
    }
    setError("");

    // The mic is INDEPENDENT of the secret fields — recording a voice answer never
    // requires a token to be entered first. Any secret that happens to be filled in is
    // still attached at submit time, but its absence must never block the mic.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      disableMic();
      return;
    }
    if (!claimRecordingSlot()) return;

    setPhase("arming");
    setBusyLabel("마이크 여는 중…");
    discardOnStopRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      segmentIndexRef.current = 0;
      segmentUploadsRef.current = [];
      recordingAnswerIdRef.current = makeAnswerId();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setUploadedCount(0);
      recordingRef.current = true;
      const generation = ++generationRef.current;
      beginSegment(stream, generation);
      setPhase("recording");

      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1_000));
      }, 500);
      scheduleRotation(generation);
    } catch (recordingError) {
      recordingRef.current = false;
      releaseRecordingSlot();
      releaseStream();
      setPhase("idle");
      disableMic();
      setError("");
    }
  }

  async function stopRecording() {
    if (!recordingRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    recordingRef.current = false;
    releaseRecordingSlot();
    generationRef.current += 1;
    clearTimers();
    setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1_000));
    setPhase("processing");
    setBusyLabel("녹음을 올리고 받아쓰는 중…");
    setError("");
    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1_000));

    try {
      await stopSegment(activeSegmentRef.current);
      releaseStream();

      const results = await Promise.all(segmentUploadsRef.current);
      const failed = results.find((segment) => segment.error);
      if (failed?.error) throw new Error(failed.error);

      const audioUrls = results
        .filter((segment): segment is UploadedSegment & { url: string } => Boolean(segment.url))
        .sort((a, b) => a.index - b.index)
        .map((segment) => segment.url);
      if (audioUrls.length === 0) throw new Error("녹음된 소리가 없어요. 마이크를 확인하고 다시 말해 주세요.");

      const voiceBody = await prepareAnswerBody({ kind: "voice", audioUrls, durationSec });
      lastVoiceBodyRef.current = voiceBody;
      const response = await postAnswer(voiceBody);
      setReview({
        answerId: response.answerId,
        transcript: response.transcript?.trim() || "(말소리를 글로 옮기지 못했어요)",
        chosenOption: response.chosenOption,
      });
      setPhase("review");
    } catch (stopError) {
      releaseStream();
      setPhase("idle");
      setError(errorMessage(stopError));
    } finally {
      stoppingRef.current = false;
    }
  }

  async function chooseNumber(chosenOption: number) {
    if (phase !== "idle") return;
    setError("");
    setPhase("processing");
    setBusyLabel(`${chosenOption}번으로 저장하는 중…`);
    try {
      const body = await prepareAnswerBody({ kind: "number", chosenOption });
      const response = await postAnswer(body);
      completeAnswer({
        kind: "number",
        answerId: response.answerId,
        chosenOption,
        secretCount: body.secrets?.length,
        attachmentCount: body.attachments?.length,
      });
    } catch (submitError) {
      setPhase("idle");
      setError(errorMessage(submitError));
    }
  }

  async function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanText = text.trim();
    const hasSecret = secretRequests.some(
      (request) =>
        secretValues[request.id]?.length > 0 ||
        Boolean(encryptedSecretsRef.current[request.id]),
    );
    if ((!cleanText && !hasSecret && attachments.length === 0) || phase !== "idle") return;

    setError("");
    setPhase("processing");
    setBusyLabel("답을 저장하는 중…");
    try {
      const body = await prepareAnswerBody({
        kind: "text",
        ...(cleanText ? { text: cleanText } : {}),
      });
      const response = await postAnswer(body);
      completeAnswer({
        kind: "text",
        text: cleanText || undefined,
        chosenOption: response.chosenOption,
        secretCount: body.secrets?.length,
        attachmentCount: body.attachments?.length,
      });
    } catch (submitError) {
      setPhase("idle");
      setError(errorMessage(submitError));
    }
  }

  function confirmVoice() {
    if (!review) return;
    completeAnswer({
      kind: "voice",
      transcript: review.transcript,
      chosenOption: review.chosenOption,
      secretCount: lastVoiceBodyRef.current?.secrets?.length,
      attachmentCount: lastVoiceBodyRef.current?.attachments?.length,
    });
  }

  async function overrideVoice(chosenOption: number) {
    if (!review || !lastVoiceBodyRef.current) return;
    const previousReview = review;
    setPhase("processing");
    setBusyLabel(`${chosenOption}번으로 바로잡는 중…`);
    setError("");

    try {
      const response = await postAnswer({ ...lastVoiceBodyRef.current, chosenOption });
      completeAnswer({
        kind: "voice",
        transcript: response.transcript?.trim() || previousReview.transcript,
        chosenOption,
        secretCount: lastVoiceBodyRef.current.secrets?.length,
        attachmentCount: lastVoiceBodyRef.current.attachments?.length,
      });
    } catch (overrideError) {
      setReview(previousReview);
      setPhase("review");
      setError(errorMessage(overrideError));
    }
  }

  useEffect(() => {
    const handleRecordingCoordination = (event: Event) => {
      const detail = (event as CustomEvent<RecordingCoordinationDetail>).detail;
      if (!detail || detail.ownerId === instanceId) return;

      externalRecordingRef.current = detail.active;
      setAnotherRecordingActive(detail.active);
    };

    window.addEventListener(
      RECORDING_COORDINATION_EVENT,
      handleRecordingCoordination,
    );
    return () =>
      window.removeEventListener(
        RECORDING_COORDINATION_EVENT,
        handleRecordingCoordination,
      );
  }, [instanceId]);

  useEffect(() => {
    mountedRef.current = true;
    setMicAvailable(
      Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined",
    );
    return () => {
      mountedRef.current = false;
      discardOnStopRef.current = true;
      recordingRef.current = false;
      releaseRecordingSlot();
      generationRef.current += 1;
      clearTimers();
      const active = activeSegmentRef.current;
      if (active?.recorder.state !== "inactive") active?.recorder.stop();
      releaseStream();
    };
  }, []);

  useEffect(() => {
    if (variant !== "bar" || phase !== "idle") return;

    const handlePaste = (event: ClipboardEvent) => {
      const pastedImages = pastedImageFiles(event.clipboardData);
      if (pastedImages.length === 0) return;
      event.preventDefault();
      addAttachmentFiles(pastedImages);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addAttachmentFiles, phase, variant]);

  function handleInlinePaste(event: ReactClipboardEvent<HTMLElement>) {
    if (!isInline || phase !== "idle") return;
    const pastedImages = pastedImageFiles(event.clipboardData);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    addAttachmentFiles(pastedImages);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (phase === "idle") addAttachmentFiles(Array.from(event.dataTransfer.files));
  }

  const selectedOption = saved?.chosenOption
    ? options.find((option) => option.n === saved.chosenOption)
    : undefined;
  // A number that differs from the recommendation is the most useful thing to
  // learn from, and the number alone does not say why.
  const recommendedOption = options.find((option) => option.recommended);
  const askWhy =
    saved?.kind === "number" &&
    Boolean(saved.answerId) &&
    recommendedOption !== undefined &&
    selectedOption !== undefined &&
    selectedOption.n !== recommendedOption.n;

  async function sendReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = reasonText.trim();
    if (!reason || !saved?.answerId || reasonPhase !== "idle") return;
    setReasonPhase("sending");
    setError("");
    try {
      // Attached to the answer just given, not posted as a new one: a new answer
      // would count as the latest choice and could undo a later correction.
      const response = await fetch(`${endpoint}/reason`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId: saved.answerId, reason }),
      });
      if (response.status === 401) {
        window.location.assign(`/unlock?next=${encodeURIComponent(window.location.pathname)}`);
        throw new Error("잠금이 만료되어 다시 확인이 필요해요.");
      }
      if (!response.ok) throw new Error("이유를 남기지 못했어요. 고르신 번호는 이미 저장됐어요.");
      setReasonPhase("sent");
    } catch (reasonError) {
      setReasonPhase("idle");
      setError(errorMessage(reasonError));
    }
  }
  const hasSecretContent = secretRequests.some(
    (request) =>
      secretValues[request.id]?.length > 0 || encryptedSecretIds.includes(request.id),
  );
  const hasStandaloneContent =
    Boolean(text.trim()) || hasSecretContent || attachments.length > 0;
  const savedSummary = saved
    ? [
        selectedOption
          ? `${selectedOption.n}번 · ${selectedOption.label}`
          : saved.text || (saved.kind === "voice" ? saved.transcript || "음성 답변" : null),
        saved.secretCount ? `암호화 값 ${saved.secretCount}개` : null,
        saved.attachmentCount ? `첨부 ${saved.attachmentCount}개` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "답변"
    : "";
  const shellClassName = isInline
    ? "relative w-full"
    : "fixed inset-x-0 bottom-0 z-50 sm:px-4 sm:pb-4";
  const panelClassName = isInline
    ? `w-full overflow-hidden rounded-[20px] border bg-[#0e1013] px-3 pt-3 sm:px-4 ${
        isDragging
          ? "border-[#ff5a36] ring-2 ring-inset ring-[#ff5a36]/40"
          : "border-[#30343b]"
      }`
    : `mx-auto max-h-[82vh] w-full max-w-[780px] overflow-y-auto overscroll-contain border-t bg-[#0e1013] px-4 pt-3 shadow-[0_-18px_50px_rgba(0,0,0,0.42)] sm:rounded-[24px] sm:border ${
        isDragging
          ? "border-[#ff5a36] ring-2 ring-inset ring-[#ff5a36]/40"
          : "border-[#30343b]"
      }`;

  return (
    <aside
      className={shellClassName}
      aria-label="답변하기"
      onPaste={isInline ? handleInlinePaste : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={panelClassName}
        style={{
          paddingBottom: isInline
            ? "0.75rem"
            : "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        <div aria-live="polite">
          {phase === "idle" ? (
            <div className="lift-in">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-[#f4f1ea]">
                    {isDragging ? "여기에 놓으면 바로 첨부돼요" : "번호를 누르거나 메모로 답하세요"}
                  </div>
                  <div className="mt-0.5 text-[0.7rem] font-semibold text-[#787b82]">
                    {allowFreeform ? "짧게 써도 되고, 마이크로 편하게 말해도 돼요" : "번호만 눌러도 바로 끝나요"}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-[#32363d] bg-[#181b20] px-3 py-1.5 text-[0.68rem] font-extrabold text-[#92959c]">
                  자동 저장
                </span>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {options.map((option) => (
                  <button
                    key={option.n}
                    type="button"
                    onClick={() => void chooseNumber(option.n)}
                    className={`min-h-14 min-w-14 flex-1 rounded-2xl border text-xl font-black transition active:scale-95 ${
                      option.recommended
                        ? "border-[#ff5a36] bg-[#ff5a36] text-white"
                        : "border-[#373b43] bg-[#191c21] text-[#f0eee8] hover:border-[#666b75]"
                    }`}
                    aria-label={`${option.n}번 ${option.label}${option.recommended ? ", 클로드 추천" : ""}`}
                  >
                    {option.n}
                  </button>
                ))}
                {micAvailable ? (
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    disabled={anotherRecordingActive}
                    className="grid min-h-14 min-w-14 place-items-center rounded-2xl border border-[#663427] bg-[#261613] text-[#ff7659] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#373a40] disabled:bg-[#181b20] disabled:text-[#60636a]"
                    aria-label={
                      anotherRecordingActive
                        ? "다른 결정에서 녹음 중"
                        : "음성으로 답하기"
                    }
                  >
                    <MicIcon />
                  </button>
                ) : null}
              </div>

              {anotherRecordingActive ? (
                <p className="mt-2 rounded-xl border border-[#30343b] bg-[#15181d] px-3 py-2 text-[0.7rem] font-bold leading-5 text-[#9b9ea5]">
                  다른 결정에서 녹음 중이에요. 끝나면 이 카드의 마이크가 다시 켜집니다.
                </p>
              ) : micAvailable === false ? (
                <p className="mt-2 rounded-xl border border-[#3a3630] bg-[#191713] px-3 py-2 text-[0.7rem] font-bold leading-5 text-[#c2b9a8]">
                  {MIC_FALLBACK_HINT}
                </p>
              ) : null}

              <form onSubmit={submitText} className="mt-3">
                <div className="flex gap-2">
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={2}
                    placeholder="예: 2번으로 가자. 대신 출시 전에 한 번 더 확인해줘."
                    className="min-h-[58px] min-w-0 flex-1 resize-none rounded-2xl border border-[#363a42] bg-[#171a1f] px-4 py-3 text-sm font-semibold leading-5 text-white placeholder:text-[#65686f] focus:border-[#ff5a36] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!hasStandaloneContent}
                    className="min-h-[58px] shrink-0 rounded-2xl bg-[#ff5a36] px-4 text-sm font-black text-white disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ATTACHMENT_ACCEPT}
                      className="sr-only"
                      onChange={(event) => {
                        addAttachmentFiles(Array.from(event.target.files ?? []));
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-[#3b3f47] bg-[#191c21] px-3 text-xs font-black text-[#d3d1cc] active:scale-95"
                    >
                      <span aria-hidden="true">＋</span>
                      파일 첨부
                    </button>
                    <span className="truncate text-[0.66rem] font-semibold text-[#70737a]">
                      스크린샷 붙여넣기 · 파일 끌어놓기
                    </span>
                  </div>
                  {attachments.length > 0 ? (
                    <span className="shrink-0 text-[0.68rem] font-black text-[#9ca0a7]">{attachments.length}개</span>
                  ) : null}
                </div>

                {attachments.length > 0 ? (
                  <ul className="mt-2 space-y-1.5" aria-label="첨부 파일">
                    {attachments.map((attachment) => (
                      <li
                        key={attachment.id}
                        className="flex min-h-10 items-center gap-2 rounded-xl border border-[#30343b] bg-[#15181d] px-3 py-1.5"
                      >
                        <span className="shrink-0 text-sm" aria-hidden="true">
                          {attachment.contentType.startsWith("image/") ? "▣" : "▤"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-bold text-[#c8c7c3]">
                          {attachment.name}
                          <span className="ml-1 font-semibold text-[#6f7279]">{formatFileSize(attachment.size)}</span>
                        </span>
                        {attachment.status === "uploading" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-[0.65rem] font-bold text-[#d3ae70]">
                            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-[#5a4a30] border-t-[#e9b75f]" />
                            올리는 중
                          </span>
                        ) : attachment.status === "uploaded" ? (
                          <span className="shrink-0 text-[0.65rem] font-black text-[#78dca1]">첨부됨 ✓</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => retryAttachment(attachment.id)}
                            className="min-h-8 shrink-0 rounded-lg bg-[#33201a] px-2 text-[0.65rem] font-black text-[#ff9a83]"
                          >
                            실패 · 재시도
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#777a81] hover:bg-[#24272d] hover:text-white"
                          aria-label={`${attachment.name} 삭제`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {secretRequests.length > 0 ? (
                  <section className="mt-3 rounded-2xl border border-[#3c3832] bg-[#171613] p-3" aria-label="암호화 비밀 값">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-black text-[#efe9dd]">안전한 값 전달 (선택)</div>
                      <div className="text-[0.65rem] font-bold text-[#8dd4aa]">서버에서 읽을 수 없음</div>
                    </div>
                    <p className="mt-1 text-[0.68rem] font-semibold leading-5 text-[#a7a29a]">
                      🔒 이 값은 암호화되어 {OWNER_COMPUTER_LABEL}에서만 열립니다. 위의 번호·음성·메모 답변과 별개로,
                      토큰·비밀번호를 줄 때만 여기에 넣으세요.
                    </p>
                    <div className="mt-2 space-y-2">
                      {secretRequests.map((secretRequest) => {
                        const encryptedReady = encryptedSecretIds.includes(secretRequest.id);
                        return (
                          <label key={secretRequest.id} className="block">
                            <span className="mb-1 flex items-center justify-between gap-2 text-[0.7rem] font-extrabold text-[#d4d0c7]">
                              <span>
                                {secretRequest.label}
                                {secretRequest.required ? <span className="ml-1 text-[#ffb27a]">권장</span> : null}
                              </span>
                              {encryptedReady ? <span className="text-[#78dca1]">암호화 준비됨 ✓</span> : null}
                            </span>
                            <span className="flex gap-2">
                              <input
                                type="password"
                                value={secretValues[secretRequest.id] ?? ""}
                                onChange={(event) => updateSecretValue(secretRequest.id, event.target.value)}
                                placeholder={encryptedReady ? "안전하게 준비됐어요" : secretRequest.hint}
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                disabled={!recipientPubKey}
                                className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#3b3d3b] bg-[#0f1112] px-3 text-sm font-bold text-white placeholder:text-[#666963] focus:border-[#ff5a36] focus:outline-none disabled:opacity-45"
                              />
                              <button
                                type="button"
                                onClick={() => void pasteSecret(secretRequest.id)}
                                disabled={!recipientPubKey}
                                className="min-h-11 shrink-0 rounded-xl border border-[#484a47] bg-[#20211e] px-3 text-xs font-black text-[#dedad1] active:scale-95 disabled:opacity-40"
                              >
                                붙여넣기
                              </button>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[0.63rem] font-semibold text-[#716f6a]">
                      토큰·비밀번호는 파일 첨부가 아니라 이 암호 입력칸으로 보내세요.
                    </p>
                    {!recipientPubKey ? (
                      <p className="mt-2 text-[0.68rem] font-bold text-[#ff987f]">
                        암호화 키가 없어 비밀 값을 입력할 수 없어요.
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </form>
            </div>
          ) : null}

          {phase === "arming" || phase === "processing" ? (
            <div className="flex min-h-[118px] items-center justify-center gap-4 py-3">
              <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#41342f] border-t-[#ff5a36]" aria-hidden="true" />
              <div>
                <div className="text-base font-black">{busyLabel}</div>
                <div className="mt-1 text-xs font-semibold text-[#7f8289]">
                  {phase === "processing" ? "긴 녹음은 조각 순서대로 안전하게 합칩니다" : "처음 한 번만 허용하면 됩니다"}
                </div>
              </div>
            </div>
          ) : null}

          {phase === "recording" ? (
            <div className="lift-in flex min-h-[118px] items-center gap-4 py-2">
              <button
                type="button"
                onClick={() => void stopRecording()}
                className="recording-pulse grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#ff5a36] text-white active:scale-95"
                aria-label="녹음 정지"
              >
                <MicIcon stop />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#ff5a36]" aria-hidden="true" />
                  <span className="text-sm font-black text-[#ff876e]">듣고 있어요</span>
                </div>
                <div className="mt-1 flex items-end gap-3">
                  <span className="text-[1.8rem] font-black leading-none tabular-nums tracking-[-0.04em]">{formatTimer(elapsed)}</span>
                  <div className="waveform mb-0.5 flex h-6 items-end gap-1" aria-hidden="true">
                    {[11, 19, 14, 22, 10].map((height, index) => (
                      <span key={index} className="wave-bar w-1 rounded-full bg-[#ff7456]" style={{ height, animationDelay: `${index * 90}ms` }} />
                    ))}
                  </div>
                </div>
                <div className="mt-2 text-[0.7rem] font-semibold text-[#797c83]">
                  정지하면 바로 글로 바꿔요{uploadedCount > 0 ? ` · ${uploadedCount}개 조각 안전 저장` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void stopRecording()}
                className="min-h-12 shrink-0 rounded-xl border border-[#494d55] px-4 text-sm font-black text-white"
              >
                정지
              </button>
            </div>
          ) : null}

          {phase === "review" && review ? (
            <div className="lift-in max-h-[56vh] overflow-y-auto py-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black">제가 이렇게 들었어요</div>
                {review.chosenOption ? (
                  <div className="rounded-full border border-[#704032] bg-[#241713] px-3 py-1.5 text-xs font-black text-[#ff8b72]">
                    {review.chosenOption}번 감지
                  </div>
                ) : (
                  <div className="rounded-full border border-[#4d4230] bg-[#201b13] px-3 py-1.5 text-xs font-black text-[#d6ae69]">
                    번호 불명확
                  </div>
                )}
              </div>
              <blockquote className="mt-2 max-h-28 overflow-y-auto rounded-xl border border-[#30343b] bg-[#171a1f] px-4 py-3 text-sm font-semibold leading-6 text-[#d8d6d1]">
                “{review.transcript}”
              </blockquote>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {options.map((option) => (
                  <button
                    key={option.n}
                    type="button"
                    onClick={() => void overrideVoice(option.n)}
                    className={`min-h-11 min-w-11 flex-1 rounded-xl border text-sm font-black ${
                      review.chosenOption === option.n
                        ? "border-[#ff5a36] bg-[#251713] text-[#ff8c74]"
                        : "border-[#373b43] bg-[#181b20] text-[#c9c8c4]"
                    }`}
                    aria-label={`${option.n}번으로 선택 바로잡기`}
                  >
                    {option.n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={confirmVoice}
                  className="min-h-11 min-w-[150px] rounded-xl bg-[#ff5a36] px-4 text-sm font-black text-white"
                >
                  이대로 완료
                </button>
              </div>
              <p className="mt-1 text-[0.68rem] font-semibold text-[#71747b]">번호가 다르면 원하는 숫자를 누르세요.</p>
            </div>
          ) : null}

          {phase === "success" && saved ? (
            <div className="success-pop flex min-h-[118px] items-center gap-4 py-2">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#183522] text-2xl text-[#78dca1]" aria-hidden="true">
                ✓
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-black">저장됐어요. 클로드가 이어서 진행합니다.</div>
                <div className="mt-1 truncate text-xs font-semibold text-[#8c8f95]">
                  {savedSummary}
                </div>
              </div>
              {isInline ? (
                <span className="grid min-h-11 shrink-0 place-items-center rounded-xl border border-[#31513d] bg-[#142219] px-3 text-xs font-black text-[#78dca1]">
                  완료
                </span>
              ) : (
                <a
                  href="/"
                  className="grid min-h-11 shrink-0 place-items-center rounded-xl border border-[#3a3e46] px-3 text-xs font-black text-[#c8c7c3]"
                >
                  인박스
                </a>
              )}
            </div>
          ) : null}

          {phase === "success" && askWhy ? (
            reasonPhase === "sent" ? (
              <p className="pb-2 text-xs font-bold text-[#78dca1]">이유도 남겨 두었어요.</p>
            ) : (
              <form onSubmit={sendReason} className="pb-2">
                <label htmlFor={`${instanceId}-reason`} className="block text-xs font-bold leading-5 text-[#a9abb0]">
                  추천과 다르게 고르셨네요. 이유를 한 줄 남겨 주시면 다음엔 더 잘 맞출게요. (안 써도 돼요)
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id={`${instanceId}-reason`}
                    value={reasonText}
                    onChange={(event) => setReasonText(event.target.value)}
                    disabled={reasonPhase === "sending"}
                    maxLength={500}
                    placeholder="예: 지금은 비용보다 속도가 중요해서"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#3a3e46] bg-[#14171c] px-3 text-sm font-semibold text-[#ece9e2] placeholder:text-[#5f6269] focus:border-[#ff5a36] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!reasonText.trim() || reasonPhase === "sending"}
                    className="min-h-11 shrink-0 rounded-xl bg-[#ff5a36] px-4 text-xs font-black text-white transition-colors hover:bg-[#ff6747] disabled:opacity-40"
                  >
                    {reasonPhase === "sending" ? "남기는 중…" : "남기기"}
                  </button>
                </div>
              </form>
            )
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-[#5a312b] bg-[#211312] px-3 py-2 text-xs font-bold leading-5 text-[#ff9a83]">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} className="min-h-6 shrink-0 px-1 text-[#bd7565]" aria-label="오류 닫기">
              ×
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
