import { cancel, intro, isCancel, select, text } from "@clack/prompts";

const INTERACTIVE_COMMANDS = [
  "status",
  "doctor",
  "clone",
  "review",
  "amend",
  "merge",
  "sync",
  "setup",
  "open",
  "--help",
] as const;

export type InteractiveCommand = (typeof INTERACTIVE_COMMANDS)[number];

interface CommandMenuOption {
  value: InteractiveCommand;
  label: string;
  hint: string;
}

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
    value: "clone",
    label: "clone",
    hint: "Clone a configured Gerrit project by name · creates a repository",
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
] satisfies CommandMenuOption[];

interface InteractiveContext {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  version: string;
  selectCommand?: () => Promise<InteractiveCommand | symbol>;
  selectCloneProject?: () => Promise<string | symbol>;
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

const selectCloneProject = async () => {
  const project = await text({
    message: "Gerrit project name",
    placeholder: "team/app",
    validate: (value) => (value.trim() ? undefined : "Enter a Gerrit project name."),
  });
  if (isCancel(project)) cancel("Operation cancelled.");
  return project;
};

/** Resolves a bare CLI invocation to an interactive selection or non-TTY help. */
export const resolveRootArguments = async (
  args: readonly string[],
  context: InteractiveContext,
): Promise<string[] | null> => {
  if (args.length > 0) return [...args];
  if (!context.stdinIsTTY || !context.stdoutIsTTY) return ["--help"];

  const command = await (context.selectCommand ?? (() => selectCommand(context.version)))();
  if (typeof command === "symbol") return null;
  if (command !== "clone") return [command];

  const project = await (context.selectCloneProject ?? selectCloneProject)();
  return typeof project === "symbol" ? null : [command, project.trim()];
};
