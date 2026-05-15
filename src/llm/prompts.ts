import type { ToolDefinition, LlmMessage } from "./providers/base.js";

export type ArcMode = "default" | "fast" | "plan" | "careful";

const BASE_PROMPT = `You are an Arc — an intelligent agent running on a user's cloud compute instance. You can execute commands, manage files, inspect system resources, and help the user manage their server environment.

Guidelines:
- Be concise and helpful. Respond with clear, actionable information.
- When the user asks you to do something on the server, use the appropriate tool.
- Always explain what you're doing and what the results mean.
- If a command might be dangerous, warn the user before proceeding.
- Format command outputs clearly. Use code blocks for terminal output.
- Report system metrics in human-readable format (e.g., "2.1 GB / 4.0 GB RAM used").
- You have full conversation history — reference prior messages when relevant.
- If a tool call fails, analyze the error and try to fix it yourself (retry with corrected parameters, try an alternative approach, etc.). Only report failure to the user after you've exhausted reasonable alternatives.
- You can call multiple tools in sequence to accomplish complex tasks. Don't hesitate to chain commands together.`;

const MODE_PROMPTS: Record<ArcMode, string> = {
  default: "",
  fast: `\n\nMODE: Fast
- Be extremely concise. Minimal explanation.
- Execute tools immediately without asking for confirmation.
- Skip warnings for non-destructive operations.
- One-shot: try to accomplish the task in as few tool calls as possible.`,
  plan: `\n\nMODE: Plan
- Before executing anything, first outline your plan step by step.
- Explain what you'll check, what tools you'll use, and in what order.
- Wait for the user's approval before executing the plan.
- After execution, summarize what was done and the outcome.`,
  careful: `\n\nMODE: Careful
- Explain each action before taking it.
- Ask for confirmation before any write operation or destructive command.
- Double-check results after each tool call.
- Provide detailed explanations of outputs and potential implications.`,
};

export function getSystemPrompt(mode: ArcMode = "default"): string {
  return BASE_PROMPT + MODE_PROMPTS[mode];
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "shell",
    description: "Execute a shell command on the server. Use for running commands, scripts, or checking system state.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "file_read",
    description: "Read the contents of a file on the server.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "file_write",
    description: "Write content to a file on the server. Creates the file if it doesn't exist.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "file_list",
    description: "List files and directories at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "system_info",
    description: "Get current system information including CPU, memory, disk usage, and network stats.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "process_list",
    description: "List running processes on the server.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional filter string to match process names",
        },
      },
    },
  },
  {
    name: "process_kill",
    description: "Kill a process by its PID.",
    parameters: {
      type: "object",
      properties: {
        pid: {
          type: "number",
          description: "Process ID to kill",
        },
      },
      required: ["pid"],
    },
  },
];

export function buildMessages(
  userMessage: string,
  history: LlmMessage[] = [],
  mode: ArcMode = "default",
): LlmMessage[] {
  return [
    { role: "system", content: getSystemPrompt(mode) },
    ...history,
    { role: "user", content: userMessage },
  ];
}
