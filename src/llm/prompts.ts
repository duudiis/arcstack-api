import type { ToolDefinition, LlmMessage } from "./providers/base.js";

export const SYSTEM_PROMPT = `You are an Arc — an intelligent agent running on a user's cloud compute instance. You can execute commands, manage files, inspect system resources, and help the user manage their server environment.

Guidelines:
- Be concise and helpful. Respond with clear, actionable information.
- When the user asks you to do something on the server, use the appropriate tool.
- Always explain what you're doing and what the results mean.
- If a command might be dangerous, warn the user before proceeding.
- Format command outputs clearly. Use code blocks for terminal output.
- Report system metrics in human-readable format (e.g., "2.1 GB / 4.0 GB RAM used").`;

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

export function buildMessages(userMessage: string, history: LlmMessage[] = []): LlmMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];
}
