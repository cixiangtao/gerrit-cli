import { readFile } from "node:fs/promises";

const releaseVersion = process.env.RELEASE_VERSION;
const releaseRef = process.env.GITHUB_REF;
const repository = process.env.GITHUB_REPOSITORY;
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

if (repository !== "cixiangtao/gerrit-flow") {
  throw new Error(`Refusing release from unexpected repository: ${repository ?? "unknown"}`);
}
if (releaseRef !== "refs/heads/main") {
  throw new Error(`Releases must be dispatched from main, received: ${releaseRef ?? "unknown"}`);
}
if (!releaseVersion || !/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
  throw new Error("RELEASE_VERSION must be a stable semantic version such as 0.1.0.");
}
if (manifest.version !== releaseVersion) {
  throw new Error(
    `Release input ${releaseVersion} does not match package.json version ${manifest.version}.`,
  );
}

console.log(`Validated release ${manifest.name}@${releaseVersion} from ${releaseRef}.`);
