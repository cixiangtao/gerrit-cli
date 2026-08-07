/** Error with a stable code and actionable hints for human and JSON output. */
export class CliError extends Error {
  readonly code: string;
  readonly hints: string[];
  readonly exitCode: number;

  constructor(
    code: string,
    message: string,
    options: { hints?: string[]; exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.hints = options.hints ?? [];
    this.exitCode = options.exitCode ?? 1;
  }
}

/** Converts unexpected failures into the CLI's stable error contract. */
export const toCliError = (error: unknown) => {
  if (error instanceof CliError) return error;

  return new CliError(
    "UNEXPECTED_ERROR",
    error instanceof Error ? error.message : "An unexpected error occurred.",
    { cause: error },
  );
};
