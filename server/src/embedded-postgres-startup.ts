import { existsSync, readFileSync } from "node:fs";

export type PostmasterPidState =
  | { status: "missing"; pid: null; firstLine: null }
  | { status: "empty"; pid: null; firstLine: "" }
  | { status: "invalid"; pid: null; firstLine: string | null }
  | { status: "stale"; pid: number | null; firstLine: string | null }
  | { status: "running"; pid: number; firstLine: string | null }
  | { status: "unreadable"; pid: null; firstLine: null };

export type PostmasterPidSettleResult =
  | { action: "reuse"; state: PostmasterPidState }
  | { action: "cleanup"; state: PostmasterPidState }
  | { action: "block"; state: Extract<PostmasterPidState, { status: "running" }> };

function defaultIsPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function inspectPostmasterPidFile(
  postmasterPidFile: string,
  isPidRunning: (pid: number) => boolean = defaultIsPidRunning,
): PostmasterPidState {
  if (!existsSync(postmasterPidFile)) {
    return { status: "missing", pid: null, firstLine: null };
  }

  try {
    const firstLine = readFileSync(postmasterPidFile, "utf8").split("\n")[0] ?? "";
    const trimmed = firstLine.trim();
    if (trimmed.length === 0) {
      return { status: "empty", pid: null, firstLine: "" };
    }

    const pid = Number(trimmed);
    if (!Number.isInteger(pid) || pid <= 0) {
      return { status: "invalid", pid: null, firstLine: trimmed };
    }

    if (isPidRunning(pid)) {
      return { status: "running", pid, firstLine: trimmed };
    }

    return { status: "stale", pid, firstLine: trimmed };
  } catch {
    return { status: "unreadable", pid: null, firstLine: null };
  }
}

export async function waitForPostmasterPidSettle(input: {
  postmasterPidFile: string;
  probeReachable: () => Promise<boolean>;
  attempts?: number;
  delayMs?: number;
  isPidRunning?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PostmasterPidSettleResult> {
  const attempts = Math.max(1, input.attempts ?? 12);
  const delayMs = Math.max(0, input.delayMs ?? 500);
  const isPidRunning = input.isPidRunning ?? defaultIsPidRunning;
  const sleep = input.sleep ?? defaultSleep;

  let state = inspectPostmasterPidFile(input.postmasterPidFile, isPidRunning);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = inspectPostmasterPidFile(input.postmasterPidFile, isPidRunning);
    if (await input.probeReachable()) {
      return { action: "reuse", state };
    }

    const shouldRetry =
      attempt < attempts - 1 &&
      (state.status === "empty" ||
        state.status === "invalid" ||
        state.status === "running" ||
        state.status === "unreadable");
    if (!shouldRetry) {
      break;
    }

    await sleep(delayMs);
  }

  state = inspectPostmasterPidFile(input.postmasterPidFile, isPidRunning);
  if (await input.probeReachable()) {
    return { action: "reuse", state };
  }

  if (state.status === "running") {
    return { action: "block", state };
  }

  return { action: "cleanup", state };
}
