import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "LICENSE",
  "README.md",
  "docs/README.zh-CN.md",
  "dist/cli.js",
  "package.json",
];
const forbiddenPrefixes = [".github/", "scripts/", "skills/", "src/", "tests/"];

const fail = (message) => {
  throw new Error(`Package verification failed: ${message}`);
};

const parseOutputDirectory = () => {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1) return undefined;

  const value = process.argv[outputIndex + 1];
  if (!value) fail("--output requires a directory.");
  return resolve(repositoryRoot, value);
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const prepareOutputDirectory = async (requestedDirectory, temporaryDirectory) => {
  const directory = requestedDirectory ?? join(temporaryDirectory, "artifacts");
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    fail(`output directory must be empty: ${directory}`);
  }
  return directory;
};

const run = async (command, args, cwd) =>
  execute(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

const requestedOutputDirectory = parseOutputDirectory();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "gerrit-cli-package-"));

try {
  const outputDirectory = await prepareOutputDirectory(
    requestedOutputDirectory,
    temporaryDirectory,
  );
  const cacheDirectory = join(temporaryDirectory, "npm-cache");
  const sourceManifest = await readJson(join(repositoryRoot, "package.json"));
  const { stdout: packOutput } = await run(
    "npm",
    [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      outputDirectory,
      "--cache",
      cacheDirectory,
    ],
    repositoryRoot,
  );
  const packResults = JSON.parse(packOutput);
  if (!Array.isArray(packResults) || packResults.length !== 1) {
    fail("npm pack must produce exactly one archive.");
  }

  const [packResult] = packResults;
  if (
    typeof packResult !== "object" ||
    packResult === null ||
    typeof packResult.filename !== "string" ||
    !Array.isArray(packResult.files)
  ) {
    fail("npm pack returned an unexpected JSON contract.");
  }

  const filePaths = new Set(packResult.files.map(({ path }) => path));
  for (const path of requiredFiles) {
    if (!filePaths.has(path)) fail(`missing required file: ${path}`);
  }
  for (const path of filePaths) {
    if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) {
      fail(`repository-only file leaked into the package: ${path}`);
    }
  }

  const cliEntry = packResult.files.find(({ path }) => path === "dist/cli.js");
  if (!cliEntry || typeof cliEntry.mode !== "number" || (cliEntry.mode & 0o111) === 0) {
    fail("dist/cli.js is not executable in the archive.");
  }

  const archivePath = join(outputDirectory, packResult.filename);
  await access(archivePath);

  const consumerDirectory = join(temporaryDirectory, "consumer");
  await mkdir(consumerDirectory);
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "gerrit-cli-package-consumer", private: true }, null, 2)}\n`,
  );
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      cacheDirectory,
      archivePath,
    ],
    consumerDirectory,
  );

  const installedRoot = join(consumerDirectory, "node_modules", "@anys", "gerrit-cli");
  const installedManifest = await readJson(join(installedRoot, "package.json"));
  for (const field of ["name", "version", "license"]) {
    if (installedManifest[field] !== sourceManifest[field]) {
      fail(`installed ${field} does not match package.json.`);
    }
  }
  if (installedManifest.bin?.gerrit !== "dist/cli.js") {
    fail("installed binary mapping is invalid.");
  }
  if (installedManifest.engines?.node !== ">=14.17.0") {
    fail("installed Node.js requirement is invalid.");
  }

  const packageReadme = await readFile(join(installedRoot, "README.md"), "utf8");
  if (!packageReadme.includes("Full documentation") || !packageReadme.includes("简体中文")) {
    fail("the npm README must link to the English and Chinese documentation.");
  }
  const license = await readFile(join(installedRoot, "LICENSE"), "utf8");
  if (!license.startsWith("MIT License")) fail("the packed license is not MIT.");

  const binaryPath =
    process.platform === "win32"
      ? join(consumerDirectory, "node_modules", ".bin", "gerrit.cmd")
      : join(consumerDirectory, "node_modules", ".bin", "gerrit");
  await access(binaryPath);
  if (process.platform !== "win32") {
    const binary = await stat(binaryPath);
    if ((binary.mode & 0o111) === 0) fail("the installed binary shim is not executable.");
  }

  const { stdout: versionOutput } = await run(binaryPath, ["--version"], consumerDirectory);
  if (versionOutput.trim() !== sourceManifest.version) {
    fail("the installed CLI version does not match package.json.");
  }
  const { stdout: helpOutput } = await run(binaryPath, ["--help"], consumerDirectory);
  if (!helpOutput.includes("A safe local Git workflow CLI") || !helpOutput.includes("Commands:")) {
    fail("the installed CLI help contract is incomplete.");
  }

  console.log(
    `Verified ${sourceManifest.name}@${sourceManifest.version}: ${packResult.files.length} files, ` +
      `${packResult.size} packed bytes, fresh install and CLI smoke passed.`,
  );
  if (requestedOutputDirectory) console.log(`Release artifact: ${archivePath}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
