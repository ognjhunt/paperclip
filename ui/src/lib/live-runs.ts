import type { LiveRunForIssue } from "../api/heartbeats";

export function isRunningLiveRun(status: string): boolean {
  return status === "running";
}

export function isOpenLiveRun(status: string): boolean {
  return status === "queued" || status === "running";
}

export function countRunningLiveRuns(runs: LiveRunForIssue[] | null | undefined): number {
  return (runs ?? []).filter((run) => isRunningLiveRun(run.status)).length;
}

export function countRunningLiveRunsByAgent(
  runs: LiveRunForIssue[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs ?? []) {
    if (!isRunningLiveRun(run.status)) continue;
    counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
  }
  return counts;
}

export function shouldPollPersistedRunLog(
  run: Pick<LiveRunForIssue, "status" | "logRef">,
): boolean {
  return isRunningLiveRun(run.status) || Boolean(run.logRef);
}
