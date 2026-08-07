import pc from "picocolors";
import stringWidth from "string-width";

import type { CommandEnvelope, ErrorEnvelope } from "../types.js";
import type { CliError } from "./errors.js";

export interface OutputOptions {
  /** Force ANSI colors on or off. Defaults to terminal capability detection. */
  color?: boolean;
}

export type OutputTone = "default" | "success" | "warning" | "danger" | "muted" | "accent";
export type OutputStatus = "success" | "warning" | "error" | "skipped";

export interface OutputRow {
  label: string;
  value: string;
  status?: OutputStatus;
  tone?: OutputTone;
}

export interface Output {
  readonly json: boolean;
  heading(message: string): void;
  blank(): void;
  rows(rows: readonly OutputRow[]): void;
  note(message: string, tone?: OutputTone): void;
  command(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  result<T>(command: string, data: T): void;
  failure(error: CliError): void;
}

const applyTone = (colors: ReturnType<typeof pc.createColors>, value: string, tone: OutputTone) => {
  if (/^https?:\/\//.test(value) && (tone === "default" || tone === "accent")) {
    return colors.underline(colors.cyan(value));
  }
  if (tone === "success") return colors.green(value);
  if (tone === "warning") return colors.yellow(value);
  if (tone === "danger") return colors.red(value);
  if (tone === "muted") return colors.dim(value);
  if (tone === "accent") return colors.cyan(value);
  return value;
};

const formatStatus = (colors: ReturnType<typeof pc.createColors>, status?: OutputStatus) => {
  if (status === "success") return colors.green("✓");
  if (status === "warning") return colors.yellow("!");
  if (status === "error") return colors.red("✗");
  if (status === "skipped") return colors.dim("–");
  return "";
};

const padLabel = (label: string, width: number) =>
  `${label}${" ".repeat(width - stringWidth(label))}`;

/** Creates an output adapter that keeps stdout JSON-only under --json. */
export const createOutput = (json: boolean, options: OutputOptions = {}): Output => {
  const colors = pc.createColors(!json && (options.color ?? pc.isColorSupported));
  return {
    json,
    heading(message) {
      if (json) console.error(message);
      else {
        console.log(`${colors.magenta("◆")} ${colors.bold(message)}`);
        console.log();
      }
    },
    blank() {
      if (!json) console.log();
    },
    rows(rows) {
      if (json || rows.length === 0) return;
      const labelWidth = Math.max(...rows.map(({ label }) => stringWidth(label)));
      const hasStatus = rows.some(({ status }) => status !== undefined);
      for (const row of rows) {
        const status = hasStatus
          ? row.status
            ? `${formatStatus(colors, row.status)} `
            : "  "
          : "";
        const label = colors.dim(padLabel(row.label, labelWidth));
        const value = applyTone(colors, row.value, row.tone ?? "default");
        console.log(`  ${status}${label}  ${value}`);
      }
    },
    note(message, tone = "default") {
      if (json) console.error(message);
      else console.log(`  ${applyTone(colors, message, tone)}`);
    },
    command(message) {
      if (json) console.error(message);
      else console.log(`  ${colors.dim("$")} ${colors.cyan(message)}`);
    },
    info(message) {
      if (json) console.error(message);
      else console.log(message);
    },
    success(message) {
      if (json) console.error(message);
      else console.log(`${colors.green("✓")} ${message}`);
    },
    warn(message) {
      if (json) console.error(message);
      else console.warn(`${colors.yellow("!")} ${message}`);
    },
    result(command, data) {
      if (json) {
        const envelope: CommandEnvelope<typeof data> = { ok: true, command, data };
        console.log(JSON.stringify(envelope, null, 2));
        return;
      }

      if (typeof data === "string") console.log(data);
      else console.log(JSON.stringify(data, null, 2));
    },
    failure(error) {
      if (json) {
        const envelope: ErrorEnvelope = {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            hints: error.hints,
          },
        };
        console.log(JSON.stringify(envelope, null, 2));
        return;
      }

      if (error.exitCode === 0) {
        console.error(`${colors.yellow("■")} ${colors.bold("Operation cancelled")}`);
        return;
      }

      console.error(`${colors.red("✖")} ${colors.bold(`Error [${error.code}]`)}`);
      console.error();
      console.error(`  ${error.message}`);
      if (error.hints.length > 0) {
        console.error();
        console.error(colors.dim("  Suggestions"));
        for (const hint of error.hints) console.error(`  ${colors.cyan("→")} ${hint}`);
      }
    },
  };
};
