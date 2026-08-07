import { spawn } from "node:child_process";

import { CliError } from "./errors.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
  allowFailure?: boolean;
  stdin?: "ignore" | "inherit";
}

/** Runs a process without a shell so repository-controlled values cannot become commands. */
export const runCommand = async (
  command: string,
  args: string[],
  { cwd, allowFailure = false, stdin = "ignore" }: RunCommandOptions,
) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: [stdin, "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(
        new CliError("COMMAND_NOT_FOUND", `Unable to run ${command}.`, {
          hints: [`Ensure ${command} is installed and available on PATH.`],
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      const result = {
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      };

      if (result.exitCode === 0 || allowFailure) {
        resolve(result);
        return;
      }

      reject(
        new CliError("COMMAND_FAILED", `${command} exited with code ${result.exitCode}.`, {
          hints: result.stderr ? [result.stderr] : [],
          cause: result,
        }),
      );
    });
  });

/** Quotes a command for display only. The displayed string is never executed by a shell. */
export const formatCommand = (command: string, args: string[]) =>
  [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
