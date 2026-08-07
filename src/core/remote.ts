import { CliError } from "./errors.js";

export interface GerritSshRemote {
  user: string;
  host: string;
  port: number;
  project: string;
}

/** Parses standard SSH and SCP-like Git remote URLs used by Gerrit. */
export const parseGerritSshRemote = (remoteUrl: string): GerritSshRemote => {
  if (remoteUrl.startsWith("ssh://")) {
    try {
      const url = new URL(remoteUrl);
      if (!url.username || !url.hostname) throw new Error("Missing SSH user or host.");
      return {
        user: decodeURIComponent(url.username),
        host: url.hostname,
        port: url.port ? Number(url.port) : 29418,
        project: url.pathname.replace(/^\//, ""),
      };
    } catch (error) {
      throw new CliError("INVALID_GERRIT_REMOTE", `Invalid Gerrit SSH URL: ${remoteUrl}.`, {
        cause: error,
      });
    }
  }

  const scpLike = remoteUrl.match(/^([^@/:]+)@([^:]+):(.+)$/);
  if (scpLike) {
    const [, user = "", host = "", project = ""] = scpLike;
    return { user, host, port: 29418, project };
  }

  throw new CliError("UNSUPPORTED_GERRIT_REMOTE", "The Gerrit remote is not an SSH URL.", {
    hints: [
      "Use ssh://user@host:29418/project or user@host:project.",
      "Review pushes may still use HTTPS, but setup and doctor connectivity require SSH.",
    ],
  });
};

/** Derives a best-effort Gerrit browser URL from an SSH remote. */
export const deriveWebUrl = (remoteUrl: string) => {
  if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
    return new URL(remoteUrl).origin;
  }
  const { host } = parseGerritSshRemote(remoteUrl);
  return `https://${host}`;
};
