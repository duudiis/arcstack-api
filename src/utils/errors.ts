export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  INVALID_CREDENTIALS: new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS"),
  UNAUTHORIZED: new AppError(401, "Authentication required", "UNAUTHORIZED"),
  FORBIDDEN: new AppError(403, "Access denied", "FORBIDDEN"),
  NOT_FOUND: new AppError(404, "Resource not found", "NOT_FOUND"),
  CONFLICT: (field: string) => new AppError(409, `${field} already exists`, "CONFLICT"),
  VALIDATION: (message: string) => new AppError(400, message, "VALIDATION_ERROR"),
  AGENT_OFFLINE: new AppError(503, "Arc agent is offline", "AGENT_OFFLINE"),
} as const;
