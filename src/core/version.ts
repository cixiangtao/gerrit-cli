import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";

const PACKAGE_NAME = "@anys/gerrit-cli";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org/";
const REQUEST_TIMEOUT_MS = 1_500;
const MAX_RESPONSE_BYTES = 64 * 1024;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
}

export type LatestVersionProvider = () => Promise<string | null>;

const parseVersion = (version: string): ParsedVersion | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;

  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
};

const comparePrerelease = (latest: string, current: string) => {
  const latestIdentifiers = latest.split(".");
  const currentIdentifiers = current.split(".");
  const length = Math.max(latestIdentifiers.length, currentIdentifiers.length);

  for (let index = 0; index < length; index += 1) {
    const latestIdentifier = latestIdentifiers[index];
    const currentIdentifier = currentIdentifiers[index];
    if (latestIdentifier === undefined) return -1;
    if (currentIdentifier === undefined) return 1;
    if (latestIdentifier === currentIdentifier) continue;

    const latestNumeric = /^\d+$/.test(latestIdentifier);
    const currentNumeric = /^\d+$/.test(currentIdentifier);
    if (latestNumeric && currentNumeric) {
      return Number(latestIdentifier) > Number(currentIdentifier) ? 1 : -1;
    }
    if (latestNumeric !== currentNumeric) return latestNumeric ? -1 : 1;
    return latestIdentifier > currentIdentifier ? 1 : -1;
  }

  return 0;
};

/** Compares registry and local package versions without accepting non-semver values. */
export const isNewerVersion = (latestVersion: string, currentVersion: string) => {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);
  if (!latest || !current) return false;

  for (const key of ["major", "minor", "patch"] as const) {
    if (latest[key] !== current[key]) return latest[key] > current[key];
  }

  if (latest.prerelease === null) return current.prerelease !== null;
  if (current.prerelease === null) return false;
  return comparePrerelease(latest.prerelease, current.prerelease) > 0;
};

/** Reads npm's latest dist-tag directly so every CLI invocation can check for an update. */
export const fetchLatestVersion = (
  registryUrl = process.env.npm_config_registry ?? DEFAULT_REGISTRY_URL,
): Promise<string | null> => {
  let endpoint: URL;
  try {
    endpoint = new URL(`${encodeURIComponent(PACKAGE_NAME)}/latest`, registryUrl);
  } catch {
    return Promise.resolve(null);
  }

  const get =
    endpoint.protocol === "http:" ? httpGet : endpoint.protocol === "https:" ? httpsGet : null;
  if (!get) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (version: string | null) => {
      if (settled) return;
      settled = true;
      resolve(version);
    };

    const request = get(
      endpoint,
      {
        headers: {
          accept: "application/json",
          "user-agent": `${PACKAGE_NAME} update-check`,
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(null);
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
            request.destroy();
            finish(null);
          }
        });
        response.on("end", () => {
          try {
            const manifest: unknown = JSON.parse(body);
            const version =
              typeof manifest === "object" &&
              manifest !== null &&
              "version" in manifest &&
              typeof manifest.version === "string"
                ? manifest.version
                : null;
            finish(version);
          } catch {
            finish(null);
          }
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      finish(null);
    });
    request.on("error", () => finish(null));
  });
};

/** Returns update metadata only when the registry version is newer than the running package. */
export const checkForUpdate = async (
  currentVersion: string,
  getLatestVersion: LatestVersionProvider = fetchLatestVersion,
): Promise<UpdateInfo | null> => {
  try {
    const latestVersion = await getLatestVersion();
    return latestVersion && isNewerVersion(latestVersion, currentVersion)
      ? { currentVersion, latestVersion }
      : null;
  } catch {
    return null;
  }
};

export const formatUpdateNotice = ({ currentVersion, latestVersion }: UpdateInfo) =>
  `A newer Gerrit CLI version is available: ${currentVersion} -> ${latestVersion}. ` +
  `Upgrade @anys/gerrit-cli to the latest version.`;
