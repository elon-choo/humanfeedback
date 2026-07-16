#!/usr/bin/env node

import { randomBytes, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LINK_FILE = join(ROOT, ".vercel", "project.json");
const LOCAL_ENV_FILE = join(ROOT, ".elonfeedback.env");
const TARGETS = ["production", "preview", "development"];
const REQUIRED_ENV_NAMES = [
  "BLOB_READ_WRITE_TOKEN",
  "OPENAI_API_KEY",
  "ELONFEEDBACK_TOKEN",
  "ELON_PIN",
];
const LOCAL_PROJECT_ID = "ELONFEEDBACK_SETUP_PROJECT_ID";
const LOCAL_ORG_ID = "ELONFEEDBACK_SETUP_ORG_ID";
const LOCAL_SETUP_STATE = "ELONFEEDBACK_SETUP_STATE";

const HELP = `\
elonfeedback 개인 인스턴스 설정

사용법:
  node scripts/setup.mjs          설정하고 Production에 배포합니다.
  node scripts/setup.mjs --check  읽기 전용으로 준비 상태와 실행 계획만 확인합니다.
  node scripts/setup.mjs --help   이 도움말을 표시합니다.

일반 실행이 하는 일:
  1. Vercel CLI 설치 및 로그인 상태 확인
  2. 현재 폴더만 Vercel 프로젝트에 연결 (vercel link --yes)
  3. 연결된 프로젝트의 Blob 토큰 확인
  4. 필요한 비밀 값을 Production/Preview/Development에 안전하게 추가
  5. vercel deploy --prod --yes 실행
  6. 로컬 .elonfeedback.env 파일을 권한 0600으로 작성

Blob 저장소 추가는 검증한 Vercel CLI 50.1.4에서도 대화형입니다. 토큰이 없으면
스크립트가 실행하지 않고 정확한 수동 명령과 선택 방법을 안내합니다.
`;

function logStep(number, message) {
  console.log(`\n[${number}/6] ${message}`);
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function maskSecret(value) {
  if (!value) return "(없음)";
  return `<숨김 · ${value.length}자>`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dotenvValue(value) {
  // Generated URLs/tokens/PINs use this safe subset; keeping them unquoted also
  // works with tiny CLI parsers that read everything after the first `=` verbatim.
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function parseDotenv(source) {
  const result = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, name, rawValue] = match;
    let value = rawValue.trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/'\\''/g, "'");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    result[name] = value;
  }

  return result;
}

async function readLocalEnv() {
  try {
    return parseDotenv(await readFile(LOCAL_ENV_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function hasLocalEnvironmentState(localValues) {
  return [
    "ELONFEEDBACK_URL",
    "ELONFEEDBACK_TOKEN",
    "ELON_PIN",
    LOCAL_PROJECT_ID,
    LOCAL_ORG_ID,
    LOCAL_SETUP_STATE,
  ].some((name) => Boolean(localValues[name]));
}

function validateLocalEnvironment(localValues, linked) {
  if (!hasLocalEnvironmentState(localValues)) return;

  const sameProject =
    localValues[LOCAL_PROJECT_ID] === linked.projectId &&
    localValues[LOCAL_ORG_ID] === linked.orgId;
  const validState = ["pending", "complete"].includes(
    localValues[LOCAL_SETUP_STATE],
  );

  if (!sameProject || !validState) {
    throw new Error(
      `${LOCAL_ENV_FILE}이 현재 연결된 '${linked.projectName}' 프로젝트에 속한다는 것을 확인할 수 없습니다. ` +
        "파일을 안전한 곳에 백업한 뒤 이동하고 다시 실행하세요. Vercel 값은 변경하지 않았습니다.",
    );
  }
}

async function readLink() {
  try {
    const parsed = JSON.parse(await readFile(LINK_FILE, "utf8"));
    if (
      typeof parsed.projectId !== "string" ||
      typeof parsed.orgId !== "string" ||
      typeof parsed.projectName !== "string"
    ) {
      throw new Error(`${LINK_FILE} 형식이 올바르지 않습니다.`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function run(command, args, { input, cwd = ROOT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const childEnvironment = { ...process.env };
    if (command === "vercel") {
      // Vercel CLI prefers shell project/team overrides (including legacy NOW_*
      // aliases) over .vercel/project.json. Remove selectors while preserving
      // authentication such as VERCEL_TOKEN, so every command uses this repo's link.
      for (const name of [
        "VERCEL_PROJECT_ID",
        "VERCEL_ORG_ID",
        "VERCEL_TEAM_ID",
        "VERCEL_SCOPE",
        "NOW_PROJECT_ID",
        "NOW_ORG_ID",
        "NOW_TEAM_ID",
        "NOW_SCOPE",
      ]) {
        delete childEnvironment[name];
      }
    }
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolvePromise({
        code: code ?? 1,
        signal,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
      });
    });

    if (input !== undefined) child.stdin.end(`${input}\n`);
    else child.stdin.end();
  });
}

async function runVercel(args, options) {
  return run("vercel", [...args, "--cwd", ROOT, "--no-color"], options);
}

function conciseFailure(result) {
  return (result.stderr || result.stdout || `종료 코드 ${result.code}`)
    .trim()
    .split("\n")
    .slice(-4)
    .join("\n");
}

function requireNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(
      `Node.js 20 이상이 필요합니다. 현재 버전: ${process.version}. https://nodejs.org/ 에서 LTS를 설치하세요.`,
    );
  }
  console.log(`  ✓ Node.js ${process.version}`);
}

async function requireVercel() {
  requireNode();
  let version;
  try {
    version = await run("vercel", ["--version"]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Vercel CLI가 없습니다. `npm install --global vercel` 실행 후 다시 시도하세요.",
      );
    }
    throw error;
  }

  if (version.code !== 0) {
    throw new Error(`Vercel CLI 확인 실패:\n${conciseFailure(version)}`);
  }

  const versionLine = `${version.stdout}\n${version.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /\d+\.\d+\.\d+/.test(line));
  console.log(`  ✓ ${versionLine || "Vercel CLI 설치됨"}`);
}

async function requireLogin() {
  const result = await runVercel(["whoami"]);
  if (result.code !== 0) {
    throw new Error(
      "Vercel 로그인이 필요합니다. 정확히 `vercel login`을 실행한 뒤 이 스크립트를 다시 실행하세요.",
    );
  }

  const account = result.stdout.trim().split("\n").at(-1) || "로그인됨";
  console.log(`  ✓ Vercel 계정: ${account}`);
  return account;
}

async function ensureLinkedProject() {
  const existing = await readLink();
  if (existing) {
    console.log(`  ✓ 현재 폴더가 '${existing.projectName}' 프로젝트에 연결되어 있습니다.`);
    return existing;
  }

  console.log("  • 현재 폴더를 새 프로젝트 또는 선택한 프로젝트에 연결합니다.");
  const result = await runVercel(["link", "--yes"]);
  if (result.code !== 0) {
    throw new Error(
      `자동 연결에 실패했습니다. 이 폴더에서 \`vercel link\`를 실행해 프로젝트를 선택한 뒤 다시 실행하세요.\n${conciseFailure(result)}`,
    );
  }

  const linked = await readLink();
  if (!linked) {
    throw new Error("vercel link가 끝났지만 .vercel/project.json을 찾지 못했습니다.");
  }
  console.log(`  ✓ '${linked.projectName}' 프로젝트에 연결했습니다.`);
  return linked;
}

function outputHasEnvName(output, name) {
  return new RegExp(`(^|\\s)${escapeRegex(name)}(?=\\s|$)`, "m").test(output);
}

async function listEnvironment(target) {
  const result = await runVercel(["env", "ls", target]);
  if (result.code !== 0) {
    throw new Error(
      `${target} 환경 변수 목록을 확인하지 못했습니다:\n${conciseFailure(result)}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

async function getEnvironmentStatus() {
  const outputs = {};
  for (const target of TARGETS) outputs[target] = await listEnvironment(target);

  return Object.fromEntries(
    REQUIRED_ENV_NAMES.map((name) => [
      name,
      Object.fromEntries(
        TARGETS.map((target) => [target, outputHasEnvName(outputs[target], name)]),
      ),
    ]),
  );
}

function statusSummary(status) {
  return TARGETS.map((target) => `${target}:${status[target] ? "있음" : "없음"}`).join(
    ", ",
  );
}

function missingTargets(status) {
  return TARGETS.filter((target) => !status[target]);
}

function firstPresentTarget(status) {
  return ["production", "development", "preview"].find((target) => status[target]);
}

const pulledEnvironmentCache = new Map();

async function pullEnvironment(target) {
  if (pulledEnvironmentCache.has(target)) return pulledEnvironmentCache.get(target);

  const tempDirectory = await mkdtemp(join(tmpdir(), "elonfeedback-env-"));
  const destination = join(tempDirectory, "vercel.env");
  try {
    const result = await runVercel([
      "env",
      "pull",
      destination,
      "--environment",
      target,
      "--yes",
    ]);
    if (result.code !== 0) {
      throw new Error(`${target} 값을 안전하게 가져오지 못했습니다.`);
    }
    const parsed = parseDotenv(await readFile(destination, "utf8"));
    pulledEnvironmentCache.set(target, parsed);
    return parsed;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function remoteValue(name, status) {
  const target = firstPresentTarget(status);
  if (!target) return null;
  const values = await pullEnvironment(target);
  return values[name] || null;
}

async function addEnvironmentValue(name, target, value) {
  // Values travel over stdin and are intentionally never placed in argv or output.
  const result = await runVercel(
    ["env", "add", name, target, "--sensitive"],
    { input: value },
  );

  if (result.code === 0) {
    console.log(`  ✓ ${name} → ${target}`);
    return;
  }

  // A concurrent setup may have added it after our read. Recheck rather than force-overwrite.
  const latest = await listEnvironment(target);
  if (outputHasEnvName(latest, name)) {
    console.log(`  ✓ ${name} → ${target} (이미 있어 기존 값을 보존함)`);
    return;
  }

  throw new Error(
    `${name}을 ${target}에 추가하지 못했습니다. 기존 값은 덮어쓰지 않았고, 비밀 보호를 위해 Vercel 명령 출력도 표시하지 않았습니다.`,
  );
}

async function fillMissingTargets(name, status, value) {
  for (const target of missingTargets(status)) {
    await addEnvironmentValue(name, target, value);
    status[target] = true;
  }
}

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function generatePin() {
  let pin = "";
  for (let index = 0; index < 16; index += 1) pin += randomInt(10).toString();
  return pin;
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    let value = "";
    for await (const chunk of process.stdin) value += chunk;
    return value.trim();
  }

  return new Promise((resolvePromise, reject) => {
    const input = process.stdin;
    const output = process.stderr;
    const wasRaw = input.isRaw;
    const previousEncoding = input.readableEncoding;
    let value = "";

    const restore = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      if (previousEncoding) input.setEncoding(previousEncoding);
    };

    const finish = () => {
      restore();
      output.write("\n");
      resolvePromise(value.trim());
    };

    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          restore();
          output.write("\n");
          reject(new Error("사용자가 입력을 취소했습니다."));
          return;
        }
        if (character === "\r" || character === "\n" || character === "\u0004") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    output.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function resolveProvisioningValue({
  name,
  status,
  localValues,
  generate,
  prompt,
  promptWhenRemoteUnavailable = false,
}) {
  // Explicit input wins so a deliberate secret rotation can supersede the local
  // recovery cache. Sensitive remote values may intentionally be non-retrievable.
  if (process.env[name]) return process.env[name].trim();

  const hasRemoteValue = Boolean(firstPresentTarget(status));
  const hasMissingTarget = missingTargets(status).length > 0;
  const localValue = localValues[name];
  const isPendingRecovery = localValues[LOCAL_SETUP_STATE] === "pending";

  // A pending file was written before this script's own first remote mutation,
  // so it is safe for resuming a partial run. A completed cache must not silently
  // overwrite a partially rotated remote secret; pull/explicit input is required.
  if (
    localValue &&
    (!hasRemoteValue || !hasMissingTarget || isPendingRecovery)
  ) {
    return localValue;
  }

  if (hasRemoteValue) {
    let value = null;
    try {
      value = await remoteValue(name, status);
    } catch (error) {
      if (!promptWhenRemoteUnavailable) throw error;
    }
    if (!value && promptWhenRemoteUnavailable) {
      value = await readSecret(prompt);
    }
    if (!value) {
      throw new Error(
        `${name}은 Vercel에 있지만 값을 안전하게 가져오지 못했습니다. 기존 값은 변경하지 않았습니다. Vercel Dashboard에서 연결 상태를 확인하세요.`,
      );
    }
    return value;
  }

  if (generate) return generate();

  const value = await readSecret(prompt);
  if (!value) throw new Error(`${name} 값이 비어 있습니다.`);
  return value;
}

function blobStoreName(projectName) {
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${normalized || "elonfeedback"}-blob`;
}

function printBlobInstructions(projectName) {
  const storeName = blobStoreName(projectName);
  console.log(`\nBlob 저장소가 아직 연결되지 않았습니다.`);
  console.log(`현재 폴더에서 다음 명령을 직접 실행하세요:`);
  console.log(`\n  vercel blob store add ${storeName}\n`);
  console.log("질문이 나오면 현재 연결된 프로젝트에 링크하고 다음 세 환경을 모두 선택하세요:");
  console.log("  Production, Preview, Development");
  console.log("완료 후 `node scripts/setup.mjs`를 다시 실행하세요.");
  console.log("(설치된 CLI에는 이 과정을 안전하게 자동화하는 비대화형 옵션이 없습니다.)");
}

async function writeLocalEnvironment({ url, token, pin, linked, state }) {
  const content = [
    "# elonfeedback local CLI settings — keep this file private",
    "# Setup metadata binds cached credentials to one Vercel project.",
    `${LOCAL_PROJECT_ID}=${dotenvValue(linked.projectId)}`,
    `${LOCAL_ORG_ID}=${dotenvValue(linked.orgId)}`,
    `${LOCAL_SETUP_STATE}=${state}`,
    `ELONFEEDBACK_URL=${dotenvValue(url)}`,
    `ELONFEEDBACK_TOKEN=${dotenvValue(token)}`,
    `ELON_PIN=${dotenvValue(pin)}`,
    "",
  ].join("\n");
  const tempPath = `${LOCAL_ENV_FILE}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(tempPath, 0o600);
    await rename(tempPath, LOCAL_ENV_FILE);
    await chmod(LOCAL_ENV_FILE, 0o600);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function deploymentUrl(output) {
  const labeled = [...output.matchAll(/(?:Aliased|Production):\s*(https:\/\/[^\s]+)/gi)];
  if (labeled.length) return labeled.at(-1)[1].replace(/[),.;]+$/, "");

  const urls = [...output.matchAll(/https:\/\/[^\s]+/g)]
    .map((match) => match[0].replace(/[),.;]+$/, ""))
    .filter((url) => /\.vercel\.app(?:\/|$)/i.test(url));
  return urls.at(-1) || null;
}

async function deployProduction() {
  const result = await runVercel(["deploy", "--prod", "--yes"]);
  if (result.code !== 0) {
    throw new Error(`Production 배포에 실패했습니다:\n${conciseFailure(result)}`);
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const url = deploymentUrl(combined);
  if (!url) {
    throw new Error(
      "배포는 끝났지만 URL을 판독하지 못했습니다. `vercel ls`로 확인하세요. 비밀 값은 변경되지 않았습니다.",
    );
  }
  return url;
}

async function cliInstallGuidance() {
  const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const entries =
    typeof packageJson.bin === "string"
      ? [[packageJson.name, packageJson.bin]]
      : Object.entries(packageJson.bin || {});

  if (!entries.length) {
    console.log("\n로컬 CLI 설치:");
    console.log("  이 앱 저장소에는 현재 package.json의 bin 항목이 없어 설치할 로컬 CLI가 없습니다.");
    console.log("  별도 watcher/CLI 저장소를 사용한다면 그 저장소의 설치 안내를 따르세요.");
    return;
  }

  console.log("\n로컬 CLI 설치:");
  console.log(`  cd ${ROOT}`);
  console.log("  npm install --global .");
  console.log("  개발 중 링크 방식(선택): npm link");
  console.log(`  명령: ${entries.map(([name]) => name).join(", ")}`);
  console.log(`  저장소 bin: ${entries.map(([, path]) => path).join(", ")}`);
}

async function writeSensitiveHandoff({ url, token, pin }) {
  const message = [
    "",
    "아래 세 줄을 필요할 때 ~/.env에 복사하세요:",
    `ELONFEEDBACK_URL=${dotenvValue(url)}`,
    `ELONFEEDBACK_TOKEN=${dotenvValue(token)}`,
    `ELON_PIN=${dotenvValue(pin)}`,
    "",
  ].join("\n");

  // Deliberately avoid redirected stdout/stderr so secrets do not land in setup logs.
  // They are shown once on the controlling terminal, as requested for handoff.
  if (process.stdout.isTTY) {
    process.stdout.write(message);
    return true;
  }

  for (const ttyPath of ["/dev/tty", "CONOUT$"]) {
    try {
      const tty = await open(ttyPath, "w");
      try {
        await tty.writeFile(message);
      } finally {
        await tty.close();
      }
      return true;
    } catch {
      // Try the next platform's controlling-terminal path.
    }
  }

  return false;
}

function printPlan() {
  console.log("실행 계획 (현재 폴더에 연결된 Vercel 프로젝트만 대상):");
  console.log(`  폴더: ${ROOT}`);
  console.log("  • Vercel CLI/로그인 확인");
  console.log("  • 로컬 .vercel/project.json 연결 확인");
  console.log("  • Blob 및 필수 환경 변수 3개 환경 확인");
  console.log("  • 누락 값만 추가하고 기존 값은 강제 덮어쓰지 않음");
  console.log("  • 일반 실행에서만 Production 배포 및 .elonfeedback.env 작성");
}

async function checkOnly() {
  console.log("elonfeedback 설정 사전 점검 (--check, 변경 없음)\n");
  printPlan();

  logStep(1, "Vercel 준비 상태 확인");
  await requireVercel();
  await requireLogin();

  logStep(2, "현재 폴더의 프로젝트 연결 확인");
  const linked = await readLink();
  const localValues = await readLocalEnv();
  if (!linked) {
    if (hasLocalEnvironmentState(localValues)) {
      console.log(
        "  ! 프로젝트 연결은 없지만 이전 .elonfeedback.env가 있습니다. 일반 실행은 안전을 위해 자동 링크하지 않습니다.",
      );
      console.log("    `vercel link`로 원래 프로젝트를 선택하거나 파일을 백업한 뒤 이동하세요.");
    } else {
      console.log("  ! 연결되지 않음 — 일반 실행은 `vercel link --yes`를 실행합니다.");
    }
    console.log("\n점검 완료: 로그인됨, 프로젝트 연결 필요. 어떤 변경도 하지 않았습니다.");
    return;
  }
  validateLocalEnvironment(localValues, linked);
  console.log(`  ✓ '${linked.projectName}' 프로젝트에 연결됨`);

  logStep(3, "환경 변수 이름 확인 (값은 읽거나 출력하지 않음)");
  const status = await getEnvironmentStatus();
  for (const name of REQUIRED_ENV_NAMES) {
    console.log(`  ${name}: ${statusSummary(status[name])}`);
  }

  if (!firstPresentTarget(status.BLOB_READ_WRITE_TOKEN)) {
    printBlobInstructions(linked.projectName);
  }

  console.log("\n점검 완료: 어떤 프로젝트/환경 변수/파일도 변경하지 않았습니다.");
}

async function provision() {
  console.log("elonfeedback 개인 인스턴스 설정을 시작합니다.");
  console.log(`대상 폴더: ${ROOT}`);

  logStep(1, "Vercel CLI 및 로그인 확인");
  await requireVercel();
  await requireLogin();

  logStep(2, "현재 폴더의 Vercel 프로젝트 연결");
  const localValues = await readLocalEnv();
  if (!(await readLink()) && hasLocalEnvironmentState(localValues)) {
    throw new Error(
      `${LOCAL_ENV_FILE}에 이전 설정이 있지만 현재 폴더는 프로젝트에 연결되어 있지 않습니다. ` +
        "먼저 `vercel link`로 원래 프로젝트를 직접 선택하거나, 파일을 안전한 곳에 백업한 뒤 이동하세요. 자동으로 새 프로젝트를 만들지 않았습니다.",
    );
  }
  const linked = await ensureLinkedProject();
  validateLocalEnvironment(localValues, linked);

  logStep(3, "Blob 저장소 및 환경 변수 확인");
  const status = await getEnvironmentStatus();
  for (const name of REQUIRED_ENV_NAMES) {
    console.log(`  ${name}: ${statusSummary(status[name])}`);
  }

  const blobStatus = status.BLOB_READ_WRITE_TOKEN;
  if (!firstPresentTarget(blobStatus)) {
    printBlobInstructions(linked.projectName);
    process.exitCode = 2;
    return;
  }

  if (missingTargets(blobStatus).length) {
    const blobToken =
      process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      (await remoteValue("BLOB_READ_WRITE_TOKEN", blobStatus));
    if (!blobToken) {
      throw new Error(
        "Blob 토큰이 일부 환경에만 있고 값을 안전하게 가져오지 못했습니다. Vercel Dashboard에서 같은 Blob store를 Production, Preview, Development 모두에 연결한 뒤 다시 실행하세요.",
      );
    }
    await fillMissingTargets("BLOB_READ_WRITE_TOKEN", blobStatus, blobToken);
  } else {
    console.log("  ✓ Blob 토큰이 세 환경에 모두 있어 저장소 생성을 건너뜁니다.");
  }

  logStep(4, "비밀 값 준비 및 누락된 환경에만 추가");
  let openAiKey = null;
  if (missingTargets(status.OPENAI_API_KEY).length) {
    openAiKey = await resolveProvisioningValue({
      name: "OPENAI_API_KEY",
      status: status.OPENAI_API_KEY,
      localValues,
      prompt: "OpenAI API key 입력 (화면에 표시되지 않음): ",
      promptWhenRemoteUnavailable: true,
    });
    if (!openAiKey) throw new Error("OPENAI_API_KEY 값이 비어 있습니다.");
    await fillMissingTargets("OPENAI_API_KEY", status.OPENAI_API_KEY, openAiKey);
  } else {
    console.log("  ✓ OPENAI_API_KEY가 세 환경에 모두 있어 기존 값을 보존합니다.");
  }
  const apiToken = await resolveProvisioningValue({
    name: "ELONFEEDBACK_TOKEN",
    status: status.ELONFEEDBACK_TOKEN,
    localValues,
    generate: generateToken,
  });
  const pin = await resolveProvisioningValue({
    name: "ELON_PIN",
    status: status.ELON_PIN,
    localValues,
    generate: generatePin,
  });

  const credentialsNeedRemoteWrite =
    missingTargets(status.ELONFEEDBACK_TOKEN).length > 0 ||
    missingTargets(status.ELON_PIN).length > 0;
  const recoveryState =
    localValues[LOCAL_SETUP_STATE] === "complete" &&
    !credentialsNeedRemoteWrite
      ? "complete"
      : "pending";

  // Persist resolved credentials before the first remote write. If a
  // later env-add or deployment fails, a rerun can recover Sensitive values
  // without generating a mismatched token/PIN. The final URL is written below.
  await writeLocalEnvironment({
    url: localValues.ELONFEEDBACK_URL || "",
    token: apiToken,
    pin,
    linked,
    state: recoveryState,
  });
  console.log("  ✓ 재실행용 token/PIN을 권한 0600 로컬 파일에 안전하게 보관했습니다.");

  await fillMissingTargets("ELONFEEDBACK_TOKEN", status.ELONFEEDBACK_TOKEN, apiToken);
  await fillMissingTargets("ELON_PIN", status.ELON_PIN, pin);
  console.log(`  ✓ API token: ${maskSecret(apiToken)}`);
  console.log(`  ✓ PIN: ${maskSecret(pin)}`);

  logStep(5, "Production 배포");
  const url = await deployProduction();
  console.log(`  ✓ Live URL: ${url}`);

  logStep(6, "로컬 연결 정보 저장");
  await writeLocalEnvironment({
    url,
    token: apiToken,
    pin,
    linked,
    state: "complete",
  });
  console.log(`  ✓ ${LOCAL_ENV_FILE} (권한 0600)`);
  console.log(`\n설정 완료\nLive URL: ${url}\nPIN: ${maskSecret(pin)}`);

  const showedSecrets = await writeSensitiveHandoff({ url, token: apiToken, pin });
  if (!showedSecrets) {
    console.log("보안 값은 로그에 표시하지 않았습니다. 다음 파일에서 확인하세요:");
    console.log(`  ${LOCAL_ENV_FILE}`);
  }
  console.log("이 스크립트는 ~/.env 또는 ~/.claude를 자동으로 수정하지 않았습니다.");
  await cliInstallGuidance();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.some((arg) => arg !== "--check")) {
    throw new Error(`알 수 없는 옵션: ${args.join(" ")}\n\n${HELP}`);
  }
  if (args.includes("--check")) await checkOnly();
  else await provision();
}

main().catch((error) => {
  console.error(`\n설정 중단: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
