export type ErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "csrf_failed"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_code"
  | "internal";

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: ErrorDetail[]) {
    super("validation_failed", 422, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Sign in required") {
    super("unauthenticated", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed", code: "forbidden" | "csrf_failed" = "forbidden") {
    super(code, 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("not_found", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("conflict", 409, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds: number,
    message = "Too many requests",
  ) {
    super("rate_limited", 429, message);
  }
}

export class InvalidCodeError extends AppError {
  constructor() {
    super("invalid_code", 400, "That code is invalid or has expired");
  }
}
