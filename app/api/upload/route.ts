import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { hasPin, hasValidBearer } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const audioContentTypes = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
];

const fileContentTypes = [
  "image/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/json",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/rtf",
];

function validAudioPathname(pathname: string): boolean {
  return (
    /^audio\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d{3}\/a_[A-Za-z0-9_-]{6}-\d+\.webm$/.test(
      pathname,
    ) &&
    !pathname.includes("..") &&
    !pathname.includes("\\")
  );
}

function validFilePathname(pathname: string): boolean {
  const match =
    /^files\/[^/]+\/\d{4}-\d{2}-\d{2}\/\d{3}\/([^/]+)$/u.exec(pathname);
  if (!match) return false;

  const filename = match[1];
  return (
    filename !== "." &&
    filename !== ".." &&
    !pathname.includes("..") &&
    !pathname.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(filename)
  );
}

export async function POST(request: Request) {
  if (!hasPin(request) && !hasValidBearer(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Blob storage is not configured" },
      { status: 500 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      token,
      onBeforeGenerateToken: async (pathname) => {
        if (validAudioPathname(pathname)) {
          return {
            allowedContentTypes: audioContentTypes,
            maximumSizeInBytes: 60_000_000,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
          };
        }

        if (validFilePathname(pathname)) {
          return {
            allowedContentTypes: fileContentTypes,
            maximumSizeInBytes: 60_000_000,
            addRandomSuffix: true,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
          };
        }

        throw new Error("Uploads must use a valid audio/ or files/ pathname");
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Unable to authorize Blob upload", error);
    return NextResponse.json(
      { error: "Unable to authorize upload" },
      { status: 400 },
    );
  }
}
