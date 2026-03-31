import { describe, expect, it } from "vitest";
import {
  CURRENT_SECRET_REDACTION_TOKEN,
  maskUserNameForLogs,
  redactCurrentUserText,
  redactCurrentUserValue,
} from "../log-redaction.js";

describe("log redaction", () => {
  it("redacts the active username inside home-directory paths", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const input = [
      `cwd=/Users/${userName}/paperclip`,
      `home=/home/${userName}/workspace`,
      `win=C:\\Users\\${userName}\\paperclip`,
    ].join("\n");

    const result = redactCurrentUserText(input, {
      userNames: [userName],
      homeDirs: [`/Users/${userName}`, `/home/${userName}`, `C:\\Users\\${userName}`],
    });

    expect(result).toContain(`cwd=/Users/${maskedUserName}/paperclip`);
    expect(result).toContain(`home=/home/${maskedUserName}/workspace`);
    expect(result).toContain(`win=C:\\Users\\${maskedUserName}\\paperclip`);
    expect(result).not.toContain(userName);
  });

  it("redacts standalone username mentions without mangling larger tokens", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const result = redactCurrentUserText(
      `user ${userName} said ${userName}/project should stay but apaperclipuserz should not change`,
      {
        userNames: [userName],
        homeDirs: [],
      },
    );

    expect(result).toBe(
      `user ${maskedUserName} said ${maskedUserName}/project should stay but apaperclipuserz should not change`,
    );
  });

  it("recursively redacts nested event payloads", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const result = redactCurrentUserValue({
      cwd: `/Users/${userName}/paperclip`,
      prompt: `open /Users/${userName}/paperclip/ui`,
      nested: {
        author: userName,
      },
      values: [userName, `/home/${userName}/project`],
    }, {
      userNames: [userName],
      homeDirs: [`/Users/${userName}`, `/home/${userName}`],
    });

    expect(result).toEqual({
      cwd: `/Users/${maskedUserName}/paperclip`,
      prompt: `open /Users/${maskedUserName}/paperclip/ui`,
      nested: {
        author: maskedUserName,
      },
      values: [maskedUserName, `/home/${maskedUserName}/project`],
    });
  });

  it("skips redaction when disabled", () => {
    const input = "cwd=/Users/paperclipuser/paperclip";
    expect(redactCurrentUserText(input, { enabled: false })).toBe(input);
  });

  it("redacts secret-shaped env assignments and bearer headers in text logs", () => {
    const input = [
      "PAPERCLIP_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
      "PAPERCLIP_AGENT_JWT_SECRET=super-secret-value",
      "Authorization: Bearer sk-test-123456",
      "PAPERCLIP_TASK_ID=task-123",
    ].join("\n");

    const result = redactCurrentUserText(input, {
      userNames: [],
      homeDirs: [],
    });

    expect(result).toContain(`PAPERCLIP_API_KEY=${CURRENT_SECRET_REDACTION_TOKEN}`);
    expect(result).toContain(`PAPERCLIP_AGENT_JWT_SECRET=${CURRENT_SECRET_REDACTION_TOKEN}`);
    expect(result).toContain(`Authorization: Bearer ${CURRENT_SECRET_REDACTION_TOKEN}`);
    expect(result).toContain("PAPERCLIP_TASK_ID=task-123");
    expect(result).not.toContain("payload.signature");
    expect(result).not.toContain("super-secret-value");
    expect(result).not.toContain("sk-test-123456");
  });

  it("redacts secret-shaped keys in structured payloads", () => {
    const result = redactCurrentUserValue({
      env: {
        PAPERCLIP_API_KEY: "jwt-token",
        PAPERCLIP_TASK_ID: "task-123",
      },
      headers: {
        Authorization: "Bearer sk-live-secret",
      },
      nested: {
        authToken: "nested-secret",
      },
    }, {
      userNames: [],
      homeDirs: [],
    });

    expect(result).toEqual({
      env: {
        PAPERCLIP_API_KEY: CURRENT_SECRET_REDACTION_TOKEN,
        PAPERCLIP_TASK_ID: "task-123",
      },
      headers: {
        Authorization: CURRENT_SECRET_REDACTION_TOKEN,
      },
      nested: {
        authToken: CURRENT_SECRET_REDACTION_TOKEN,
      },
    });
  });
});
