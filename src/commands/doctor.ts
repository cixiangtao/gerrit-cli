import type { GlobalOptions } from "../types.js";
import { loadConfig } from "../core/config.js";
import { toCliError } from "../core/errors.js";
import { getRepositoryRoot } from "../core/git.js";
import { inspectHook } from "../core/hooks.js";
import type { Output } from "../core/output.js";
import { runCommand } from "../core/process.js";
import { resolveRepositoryContext } from "../core/repository.js";
import { detectGerritRemote, parseGerritSshRemote } from "../core/remote.js";

interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  skipped?: boolean;
}

const CHECK_LABELS: Record<string, string> = {
  git: "Git",
  repository: "Repository",
  configuration: "Configuration",
  remote: "Remote",
  gerrit: "Gerrit",
  "change-id-hook": "Change-Id hook",
  ssh: "SSH",
};

export const runDoctor = async (
  global: GlobalOptions,
  output: Output,
  options: { offline: boolean },
) => {
  const checks: DoctorCheck[] = [];
  let repositoryRoot: string | undefined;
  let auth = { kind: "ssh", source: "git-remote", required: true, checked: false };

  try {
    const git = await runCommand("git", ["--version"], {
      cwd: global.cwd,
      allowFailure: true,
    });
    checks.push({ name: "git", ok: git.exitCode === 0, message: git.stdout || git.stderr });
  } catch (error) {
    checks.push({ name: "git", ok: false, message: toCliError(error).message });
  }

  try {
    repositoryRoot = await getRepositoryRoot(global.cwd);
    checks.push({ name: "repository", ok: true, message: repositoryRoot });
    const config = await loadConfig(repositoryRoot);
    const repository = await resolveRepositoryContext(repositoryRoot, config);
    checks.push({
      name: "remote",
      ok: true,
      message: `${repository.remote} → ${repository.targetBranch}`,
    });
    const gerrit = detectGerritRemote(repository.remoteUrl, config.webUrl);
    checks.push({
      name: "gerrit",
      ok: Boolean(gerrit),
      message: gerrit ? `detected (${gerrit.evidence})` : "not identified from local configuration",
    });
    const hook = await inspectHook(repositoryRoot);
    checks.push({
      name: "change-id-hook",
      ok: hook.ready,
      message: hook.ready
        ? hook.installedPath
        : `Run gerrit setup; active hook: ${hook.activePath}`,
    });

    if (!gerrit) {
      checks.push({
        name: "ssh",
        ok: true,
        skipped: true,
        message: "skipped (not identified as Gerrit)",
      });
    } else {
      try {
        const ssh = parseGerritSshRemote(repository.remoteUrl);
        if (options.offline) {
          checks.push({ name: "ssh", ok: true, skipped: true, message: "skipped (--offline)" });
        } else {
          const result = await runCommand(
            "ssh",
            [
              "-o",
              "BatchMode=yes",
              "-o",
              "ConnectTimeout=5",
              "-p",
              String(ssh.port),
              "--",
              `${ssh.user}@${ssh.host}`,
              "gerrit",
              "version",
            ],
            { cwd: repositoryRoot, allowFailure: true },
          );
          auth = { ...auth, checked: true };
          checks.push({
            name: "ssh",
            ok: result.exitCode === 0,
            message: result.stdout || result.stderr || `Exit code ${result.exitCode}`,
          });
        }
      } catch (error) {
        checks.push({ name: "ssh", ok: false, message: toCliError(error).message });
      }
    }
  } catch (error) {
    checks.push({
      name: repositoryRoot ? "configuration" : "repository",
      ok: false,
      message: toCliError(error).message,
    });
  }

  const data = {
    healthy: checks.every((check) => check.ok),
    repositoryRoot: repositoryRoot ?? null,
    offline: options.offline,
    auth,
    checks,
  };
  if (output.json) output.result("doctor", data);
  else {
    const passed = checks.filter((check) => check.ok && !check.skipped).length;
    const skipped = checks.filter((check) => check.skipped).length;
    const failed = checks.length - passed - skipped;
    output.heading("Diagnostics");
    output.rows(
      checks.map((check) => ({
        label: CHECK_LABELS[check.name] ?? check.name,
        value: check.message,
        status: check.skipped ? "skipped" : check.ok ? "success" : "error",
        tone: check.skipped ? "muted" : check.ok ? "default" : "danger",
      })),
    );
    output.blank();
    output.note(
      [
        `${passed} passed`,
        ...(skipped > 0 ? [`${skipped} skipped`] : []),
        ...(failed > 0 ? [`${failed} failed`] : []),
      ].join(" · "),
      failed > 0 ? "danger" : skipped > 0 ? "warning" : "success",
    );
  }
  if (!data.healthy) process.exitCode = 1;
  return data;
};
