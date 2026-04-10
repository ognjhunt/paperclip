import { execute as hermesPackageExecute, testEnvironment as hermesPackageTestEnvironment, sessionCodec as hermesSessionCodec } from "hermes-paperclip-adapter/server";
import { renderTaskBindingGuard } from "@paperclipai/adapter-utils/server-utils";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterSessionCodec,
} from "./types.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function hydrateHermesExecutionConfig(
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  authToken?: string,
): Record<string, unknown> {
  const next = { ...config };
  const env = asRecord(config.env);

  const taskId =
    readNonEmptyString(context.taskId) ??
    readNonEmptyString(context.issueId) ??
    readNonEmptyString(config.taskId);
  const taskTitle =
    readNonEmptyString(context.taskTitle) ??
    readNonEmptyString(context.issueTitle) ??
    readNonEmptyString(config.taskTitle);
  const taskBody =
    readNonEmptyString(context.taskBody) ??
    readNonEmptyString(context.issueBody) ??
    readNonEmptyString(context.issueDescription) ??
    readNonEmptyString(config.taskBody);
  const commentId =
    readNonEmptyString(context.wakeCommentId) ??
    readNonEmptyString(context.commentId) ??
    readNonEmptyString(config.commentId);
  const wakeReason =
    readNonEmptyString(context.wakeReason) ??
    readNonEmptyString(config.wakeReason);
  const companyName =
    readNonEmptyString(context.companyName) ??
    readNonEmptyString(config.companyName);
  const projectName =
    readNonEmptyString(context.projectName) ??
    readNonEmptyString(config.projectName);

  if (taskId) next.taskId = taskId;
  if (taskTitle) next.taskTitle = taskTitle;
  if (taskBody) next.taskBody = taskBody;
  if (commentId) next.commentId = commentId;
  if (wakeReason) next.wakeReason = wakeReason;
  if (companyName) next.companyName = companyName;
  if (projectName) next.projectName = projectName;

  const taskBindingGuard = renderTaskBindingGuard(context);
  if (taskBindingGuard) {
    if (taskId) {
      next.taskBody = [taskBindingGuard, readNonEmptyString(next.taskBody)].filter(Boolean).join("\n\n");
    } else if (readNonEmptyString(next.promptTemplate)) {
      next.promptTemplate = `${taskBindingGuard}\n\n${next.promptTemplate}`;
    }
  }

  if (!readNonEmptyString(env.PAPERCLIP_API_KEY) && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }
  if (Object.keys(env).length > 0) {
    next.env = env;
  }

  return next;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  return hermesPackageExecute({
    ...ctx,
    config: hydrateHermesExecutionConfig(ctx.config, ctx.context, ctx.authToken),
  } as AdapterExecutionContext);
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  return hermesPackageTestEnvironment(ctx);
}

export const sessionCodec: AdapterSessionCodec = hermesSessionCodec;
