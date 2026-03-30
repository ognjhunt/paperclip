import type { AgentAdapterType } from "../constants.js";

export interface AgentExecutionProfile {
  cwd?: string;
  instructionsFilePath?: string;
  promptTemplate?: string;
  bootstrapPromptTemplate?: string;
  timeoutSec?: number;
  graceSec?: number;
  env?: Record<string, unknown>;
  workspaceStrategy?: Record<string, unknown> | null;
  workspaceRuntime?: Record<string, unknown> | null;
}

export interface AgentExecutionPolicy {
  mode?: "fixed" | "prefer_available";
  compatibleAdapterTypes?: AgentAdapterType[];
  preferredAdapterTypes?: AgentAdapterType[];
  perAdapterConfig?: Record<string, Record<string, unknown>>;
}

export interface IssueExecutionOverrides {
  model?: string;
  reasoningEffort?: string;
  chrome?: boolean;
  search?: boolean;
  perAdapterConfig?: Record<string, Record<string, unknown>>;
}
