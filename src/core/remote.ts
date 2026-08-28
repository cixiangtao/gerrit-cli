import { CliError } from "./errors.js";

export interface GerritSshRemote {
  user: string;
  host: string;
  port: number;
  project: string;
}

export type GerritRemoteEvidence = "ssh-port" | "configured-web-url";

export interface GerritRemoteDetection {
  detected: true;
  evidence: GerritRemoteEvidence;
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
    const remote = new URL(remoteUrl);
    const authenticatedPathIndex = remote.pathname.indexOf("/a/");
    return authenticatedPathIndex < 0
      ? remote.origin
      : `${remote.origin}${remote.pathname.slice(0, authenticatedPathIndex)}`;
  }
  const { host } = parseGerritSshRemote(remoteUrl);
  return `https://${host}`;
};

const trimProjectSuffix = (project: string) => project.replace(/\.git$/, "");

/** Validates a Gerrit project name before it is appended to a configured clone base URL. */
export const normalizeProjectName = (project: string) => {
  const normalized = trimProjectSuffix(project.trim());
  const segments = normalized.split("/");
  const containsUnsafeCharacter = (segment: string) =>
    segment.includes("\\") ||
    [...segment].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
  if (
    !normalized ||
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || containsUnsafeCharacter(segment),
    )
  ) {
    throw new CliError("INVALID_PROJECT", `Invalid Gerrit project name: ${project}.`, {
      hints: ["Use a project name such as app or team/app."],
    });
  }
  return normalized;
};

/** Builds a credential-free Git clone URL from a configured base and Gerrit project name. */
export const buildCloneUrl = (baseUrl: string, project: string) => {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch (cause) {
    throw new CliError("INVALID_CLONE_BASE_URL", "The configured clone base URL is invalid.", {
      hints: ["Use an absolute SSH, HTTP, or HTTPS URL without a password."],
      cause,
    });
  }
  if (!["ssh:", "https:", "http:"].includes(base.protocol) || base.password) {
    throw new CliError(
      "INVALID_CLONE_BASE_URL",
      "The configured clone base URL is not supported.",
      {
        hints: ["Use an absolute SSH, HTTP, or HTTPS URL without a password."],
      },
    );
  }
  if (base.search || base.hash) {
    throw new CliError(
      "INVALID_CLONE_BASE_URL",
      "The clone base URL cannot contain a query or hash.",
    );
  }

  const encodedProject = normalizeProjectName(project).split("/").map(encodeURIComponent).join("/");
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${encodedProject}`;
  return base.toString().replace(/\/$/, "");
};

/** Removes a Gerrit project path from an existing remote to recover its clone base URL. */
export const deriveCloneBaseUrl = (remoteUrl: string, webUrl?: string) => {
  if (!remoteUrl.includes("://")) {
    const { user, host, port } = parseGerritSshRemote(remoteUrl);
    return `ssh://${encodeURIComponent(user)}@${host}:${port}`;
  }

  const remote = new URL(remoteUrl);
  const project = deriveProjectName(remoteUrl, webUrl);
  const decodedPath = decodeURIComponent(remote.pathname);
  const suffixes = [`/${project}.git`, `/${project}`];
  const suffix = suffixes.find((candidate) => decodedPath.endsWith(candidate));
  if (!suffix) {
    throw new CliError(
      "INVALID_GERRIT_REMOTE",
      "Unable to derive a clone base URL from the remote.",
      {
        hints: [`Remote: ${remoteUrl}`],
      },
    );
  }
  remote.pathname = decodedPath.slice(0, -suffix.length) || "/";
  remote.search = "";
  remote.hash = "";
  return remote.toString().replace(/\/$/, "");
};

/** Extracts the Gerrit project name from an SSH, SCP-like, or HTTP Git remote. */
export const deriveProjectName = (remoteUrl: string, webUrl?: string) => {
  if (!remoteUrl.startsWith("https://") && !remoteUrl.startsWith("http://")) {
    const project = parseGerritSshRemote(remoteUrl).project;
    return trimProjectSuffix(
      remoteUrl.startsWith("ssh://") ? decodeURIComponent(project) : project,
    );
  }

  const remote = new URL(remoteUrl);
  const base = new URL(webUrl ?? deriveWebUrl(remoteUrl));
  let path = decodeURIComponent(remote.pathname).replace(/^\/+|\/+$/g, "");
  const basePath = decodeURIComponent(base.pathname).replace(/^\/+|\/+$/g, "");

  if (basePath && path.startsWith(`${basePath}/`)) {
    path = path.slice(basePath.length + 1);
  }
  if (path.startsWith("a/")) path = path.slice(2);

  return trimProjectSuffix(path);
};

/** Derives the Gerrit repository homepage from the Git remote and browser base URL. */
export const deriveProjectWebUrl = (remoteUrl: string, webUrl?: string) => {
  const base = (webUrl ?? deriveWebUrl(remoteUrl)).replace(/\/$/, "");
  const project = deriveProjectName(remoteUrl, webUrl);
  const encodedProject = project.split("/").map(encodeURIComponent).join("/");
  return `${base}/admin/repos/${encodedProject}`;
};

/** Detects Gerrit-specific local configuration without making a network request. */
export const detectGerritRemote = (
  remoteUrl: string,
  webUrl?: string,
): GerritRemoteDetection | undefined => {
  if (webUrl) return { detected: true, evidence: "configured-web-url" };

  if (remoteUrl.startsWith("ssh://")) {
    const remote = new URL(remoteUrl);
    if (remote.port === "29418") return { detected: true, evidence: "ssh-port" };
    return undefined;
  }

  return undefined;
};

/** Rejects remotes that do not contain enough local evidence to identify Gerrit. */
export const assertGerritRemote = (remoteUrl: string, webUrl?: string) => {
  const detection = detectGerritRemote(remoteUrl, webUrl);
  if (detection) return detection;

  throw new CliError(
    "NOT_A_GERRIT_REPOSITORY",
    "The configured remote is not identifiable as Gerrit.",
    {
      hints: [
        `Remote: ${remoteUrl}`,
        "Use an explicit Gerrit SSH URL with port 29418 or configure webUrl for HTTPS, custom SSH ports, and SCP-like remotes.",
        "Run gerrit doctor to verify live Gerrit SSH connectivity.",
      ],
    },
  );
};
