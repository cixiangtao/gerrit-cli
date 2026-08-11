import { cancel, intro, isCancel, select, type Option } from "@clack/prompts";

const INTERACTIVE_COMMANDS = [
  "status",
  "doctor",
  "review",
  "amend",
  "merge",
  "sync",
  "setup",
  "open",
  "--help",
] as const;

export type InteractiveCommand = (typeof INTERACTIVE_COMMANDS)[number];

export const COMMAND_MENU_OPTIONS = [
  {
    value: "status",
    label: "status",
    hint: "Inspect branch and review readiness · read-only",
  },
  {
    value: "doctor",
    label: "doctor",
    hint: "Check Git, hook, remote, and SSH readiness · read-only",
  },
  {
    value: "review",
    label: "review",
    hint: "Preflight, synchronize, and push commits · confirms before push",
  },
  {
    value: "amend",
    label: "amend",
    hint: "Update HEAD and upload a new Patch Set for the same Change",
  },
  {
    value: "merge",
    label: "merge",
    hint: "Merge a selected branch · previews and confirms before changing history",
  },
  {
    value: "sync",
    label: "sync",
    hint: "Fetch and synchronize the target branch · may update history",
  },
  {
    value: "setup",
    label: "setup",
    hint: "Install the official Change-Id hook · writes Git hooks",
  },
  {
    value: "open",
    label: "open",
    hint: "Open the current project in Gerrit · launches a browser",
  },
  {
    value: "--help",
    label: "help",
    hint: "Show every command and option · read-only",
  },
] satisfies Option<InteractiveCommand>[];

interface InteractiveContext {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  version: string;
  selectCommand?: () => Promise<InteractiveCommand | symbol>;
}

/** Formats the title shared by the interactive menu and versioned CLI release. */
export const formatInteractiveTitle = (version: string) => `Gerrit CLI v${version}`;

const selectCommand = async (version: string) => {
  intro(formatInteractiveTitle(version));
  const command = await select<InteractiveCommand>({
    message: "Select a command to run",
    options: COMMAND_MENU_OPTIONS,
    initialValue: "status",
    maxItems: COMMAND_MENU_OPTIONS.length,
  });
  if (isCancel(command)) cancel("Operation cancelled.");
  return command;
};

/** Resolves a bare CLI invocation to an interactive selection or non-TTY help. */
export const resolveRootArguments = async (
  args: readonly string[],
  context: InteractiveContext,
): Promise<string[] | null> => {
  if (args.length > 0) return [...args];
  if (!context.stdinIsTTY || !context.stdoutIsTTY) return ["--help"];

  const command = await (context.selectCommand ?? (() => selectCommand(context.version)))();
  return typeof command === "symbol" ? null : [command];
};
