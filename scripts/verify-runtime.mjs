import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const archiveArgument = process.argv[2];

if (!archiveArgument) {
  throw new Error("Usage: node scripts/verify-runtime.mjs <package.tgz>");
}

const archivePath = isAbsolute(archiveArgument)
  ? archiveArgument
  : resolve(process.cwd(), archiveArgument);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "gerrit-cli-runtime-"));

const run = async (command, args, cwd) =>
  execute(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

const runAllowFailure = async (command, args, cwd) => {
  try {
    const result = await run(command, args, cwd);
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error !== "object" || error === null) throw error;
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : "",
    };
  }
};

const fail = (message) => {
  throw new Error(`Runtime verification failed on ${process.version}: ${message}`);
};

try {
  const consumerDirectory = join(temporaryDirectory, "consumer");
  const repositoryDirectory = join(temporaryDirectory, "ordinary-git-repository");
  const cacheDirectory = join(temporaryDirectory, "npm-cache");
  await mkdir(consumerDirectory);
  await mkdir(repositoryDirectory);
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "gerrit-cli-runtime-consumer", private: true }, null, 2)}\n`,
  );

  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--engine-strict",
      "--no-audit",
      "--no-fund",
      "--cache",
      cacheDirectory,
      archivePath,
    ],
    consumerDirectory,
  );

  const installedRoot = join(consumerDirectory, "node_modules", "@anys", "gerrit-cli");
  const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  const binaryPath =
    process.platform === "win32"
      ? join(consumerDirectory, "node_modules", ".bin", "gerrit.cmd")
      : join(consumerDirectory, "node_modules", ".bin", "gerrit");

  const { stdout: versionOutput } = await run(binaryPath, ["--version"], consumerDirectory);
  if (versionOutput.trim() !== manifest.version) fail("CLI version does not match the package.");

  const { stdout: helpOutput } = await run(binaryPath, ["--help"], consumerDirectory);
  if (!helpOutput.includes("A safe local Git workflow CLI") || !helpOutput.includes("Commands:")) {
    fail("CLI help contract is incomplete.");
  }

  await run("git", ["init", "--initial-branch=main"], repositoryDirectory);
  await writeFile(join(repositoryDirectory, "README.md"), "runtime compatibility fixture\n");
  await run("git", ["add", "README.md"], repositoryDirectory);
  await run(
    "git",
    [
      "-c",
      "user.name=Runtime verifier",
      "-c",
      "user.email=runtime@example.com",
      "commit",
      "-m",
      "test: create runtime fixture",
    ],
    repositoryDirectory,
  );
  await run(
    "git",
    ["remote", "add", "origin", "https://github.com/example/ordinary-repository.git"],
    repositoryDirectory,
  );

  const status = await runAllowFailure(
    binaryPath,
    ["--json", "-C", repositoryDirectory, "status"],
    consumerDirectory,
  );
  if (status.exitCode !== 1) fail(`non-Gerrit status exited with ${status.exitCode}.`);
  const statusEnvelope = JSON.parse(status.stdout);
  if (statusEnvelope.error?.code !== "NOT_A_GERRIT_REPOSITORY") {
    fail("non-Gerrit status did not return NOT_A_GERRIT_REPOSITORY.");
  }

  const doctor = await runAllowFailure(
    binaryPath,
    ["--json", "-C", repositoryDirectory, "doctor", "--offline"],
    consumerDirectory,
  );
  if (doctor.exitCode !== 1) fail(`non-Gerrit doctor exited with ${doctor.exitCode}.`);
  const doctorEnvelope = JSON.parse(doctor.stdout);
  const gerritCheck = doctorEnvelope.data?.checks?.find(({ name }) => name === "gerrit");
  if (doctorEnvelope.command !== "doctor" || gerritCheck?.ok !== false) {
    fail("doctor did not report the Gerrit diagnostic.");
  }

  console.log(
    `Verified ${manifest.name}@${manifest.version} from ${basename(archivePath)} on ${process.version}.`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
