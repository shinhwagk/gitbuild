import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.74.0/io/bufio.ts";
import { existsSync } from "https://deno.land/std@0.74.0/fs/exists.ts";

type GitFileContentStatus = "+" | "-";

const diffHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface ExecResult {
  success: boolean;
  stdout: {
    lines: string[];
  };
  stderr: {
    lines: string[];
  };
}

function readerToLines(r: Deno.Reader) {
  const ls = [];
  for await (const l of readLines(r)) {
    ls.push(l);
  }
  return ls;
}

async function execCmd(cmd: string[], cwd?: string): Promise<ExecResult> {
  const proc = Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
    cwd,
  });

  return {
    success: (await proc.status()).code === 0,
    stdout: { lines: readerToLines(proc.stdout) },
    stderr: { lines: readerToLines(proc.stderr) },
  };
}

// async function procOutput(
//   proc: Deno.Process<{ cmd: string[]; stdout: "piped"; stderr: "piped" }>,
// ) {
//   const stdout = [];
//   const stderr = [];
//   for await (const l of readLines(proc.stdout as Deno.Reader)) {
//     stdout.push(l);
//   }
//   for await (const l of readLines(proc.stderr as Deno.Reader)) {
//     stderr.push(l);
//   }
//   return { code: (await proc.status()).code, stdout, stderr };
// }

function procConsole(
  er: ExecResult,
) {
  er.stdout.lines.forEach((s) => console.log("stdout: " + s));
  er.stderr.lines.forEach((s) => console.log("stderr: " + s));
}

interface IRegistry {
  login(): Promise<void>;
  delete(org: string, name: string, tag: string): Promise<void>;
}

class RegistryDockerIO implements IRegistry {
  token: string | undefined = undefined;
  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}
  async login(): Promise<void> {
    console.log(this.username, this.password);
    if (this.token) return;
    const x = await fetch("https://hub.docker.com/v2/users/login/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });
    // console.log(x.status, await x.text());
    if (x.status === 200) {
      this.token = (await x.json())["token"];
    } else {
      this.token = undefined;
    }
  }
  async delete(org: string, name: string, tag: string): Promise<void> {
    if (this.token) {
      const x = await fetch(
        `https://hub.docker.com/v2/repositories/${org}/${name}/tags/${tag}/`,
        { method: "DELETE", headers: { Authorization: `JWT ${this.token}` } },
      );
      if (x.status in [204, 200]) {
        return;
      }
      console.log(x.status, await x.text());
    }
    // throw new Error( + " " + await x.text());
  }
}

interface GitDiffConfig {
  root: string;
  sha: string;
  path: string;
}

async function GitDiffFilesByPath(
  c: GitDiffConfig,
): Promise<string[]> {
  const cmd = `git log --pretty= -1 -p --name-status ${c.sha} -- ${c.path}`
    .split(" ");
  const proc = await execCmd(cmd, c.root);
  const files: string[] = [];
  if (!proc.success) {
    return [];
  }
  for (const line of proc.stdout.lines) {
    if (line.length === 0) {
      continue;
    }
    const cols = line.split("\t");
    switch (cols[0]) {
      case "R100":
        files.push(cols[1]);
        files.push(cols[2]);
        break;
      case "D":
        files.push(cols[1]);
        break;
      case "A":
        files.push(cols[1]);
        break;
      case "M":
        files.push(cols[1]);
        break;
      default:
        throw new Error("file status unkown: " + line);
    }
  }
  return files;
}

async function GitDiffContentByFile(
  c: GitDiffConfig,
): Promise<{ status: GitFileContentStatus; content: string }[]> {
  const cmd = `git log --pretty= -1 -p ${c.sha} -- ${c.path}`.split(" ");
  const rs: { status: GitFileContentStatus; content: string }[] = [];
  let isChange = false;
  const proc = await execCmd(cmd, c.root);
  if (!proc.success) {
    return [];
  }
  for (const line of proc.stdout.lines) {
    if (line.length === 0) {
      continue;
    }
    if (diffHeaderRe.test(line)) {
      isChange = true;
    }
    // filter content changes
    if (isChange && /^[+|-](?![+|-]{2})/.test(line)) {
      const status = line.substr(0, 1) as GitFileContentStatus;
      const content = line.substr(1);
      rs.push({ status, content });
    }
  }
  return rs;
}

function checkTagDirExist(name: string, tag: string): boolean {
  return existsSync(path.join(name, tag));
}

async function readTagAliasesIfExist(
  tag: string,
): Promise<string[]> {
  const aliases: string[] = [];
  if (existsSync(AliasesTagFile(tag))) {
    const f = Deno.openSync(AliasesTagFile(tag));
    for await (const alias of readLines(f)) {
      if (alias.length >= 1) {
        aliases.push(alias.trim());
      }
    }
    f.close();
  }
  return aliases;
}

type TagAction = {
  builds: Set<string>;
  deletes: Set<string>;
  aliases: Map<string, Set<string>>;
};

async function analyseChangeFiles(
  changeFiles: string[],
): Promise<TagAction> {
  const buildTags = new Set<string>();
  const deleteTags = new Set<string>();
  const aliasesTags: Map<string, Set<string>> = new Map();

  const latestTag = existsSync(LatestTagFile)
    ? Deno.readTextFileSync(LatestTagFile)
      .trim()
    : "";

  console.log(changeFiles);
  const tagsChange = new Set(
    changeFiles.map((f) => f.split("/"))
      .filter((sf) => sf.length >= 3)
      .filter((sf) => sf[2] !== "tags")
      .map((sf) => sf[1]),
  );
  const aliasesChange = new Set(
    changeFiles
      .map((f) => f.split("/"))
      .filter((sf) => sf.length >= 3)
      .filter((sf) => sf[2] === "tags")
      .map((sf) => sf[1]),
  );
  for (const tag of tagsChange) {
    if (checkTagDirExist(ImageName, tag)) {
      buildTags.add(tag);
      const appendLatestTag = latestTag === tag ? ["latest"] : [];
      for (
        const alias of (await readTagAliasesIfExist(tag)).concat(
          appendLatestTag,
        )
      ) {
        if (!aliasesTags.has(tag)) {
          aliasesTags.set(tag, new Set());
        }
        aliasesTags.get(tag)?.add(alias);
      }
    } else {
      deleteTags.add(tag);
    }
  }
  for (const tag of aliasesChange) {
    for (
      const { status, content: alias } of (await GitDiffContentByFile(
        {
          root: GitRoot,
          sha: GitSha,
          path: path.join(ImageName, tag, "tags"),
        },
      ))
    ) {
      if (status === "-") {
        deleteTags.add(alias);
      } else {
        if (!aliasesTags.has(tag)) {
          aliasesTags.set(tag, new Set());
        }
        aliasesTags.get(tag)?.add(alias);
      }
    }
  }
  return { builds: buildTags, deletes: deleteTags, aliases: aliasesTags };
}

async function deleteImage(
  registry: string,
  username: string,
  name: string,
  tag: string,
) {
  let api: IRegistry | undefined = undefined;
  if (Registry === "docker.io") {
    api = new RegistryDockerIO(ImageOwner, RegPass);
  }
  await api?.login();
  await api?.delete(ImageOwner!, name, tag);
}

async function ImageCliLogin(
  registry: "docker.io" | "quay.io",
  username: string,
  password: string,
): Promise<void> {
  const cmd =
    `${ImageBuildTool} login ${registry} -u ${username} --password ${password}`
      .split(" ");
  console.log(cmd);
  const p = await execCmd(cmd);
  if (p.success) {
    console.log("login success.");
  } else {
    p.stderr.lines.forEach(console.log);
  }
}

async function ImageCliRemoveImage(
  registry: "docker.io" | "quay.io",
  username: string,
  password: string,
): Promise<void> {
  const cmd =
    `${ImageCliLogin} login ${registry} -u ${username} --password ${password}`
      .split(" ");
  await execCmd(cmd);
}

async function ImageCli(args: string[]) {
  const p = await execCmd([ImageBuildTool].concat(args));
  if (p.success) {
    console.log(args.join(" "));
  } else {
    p.stderr.lines.forEach(console.log);
  }
}

async function ImageCliBuild(tag: string) {
  const cmd = [
    "buildx",
    "build",
    "-t",
    `${Registry}/${ImageOwner}/${ImageName}:${tag}`,
    ".",
  ];
  await ImageCli(cmd);
}

async function ImageCliPush(tag: string) {
  const cmd = [
    "push",
    `${Registry}/${ImageOwner}/${ImageName}:${tag}`,
  ];
  await ImageCli(cmd);
}

async function ImageCliPull(tag: string) {
  const cmd = [
    "pull",
    `${Registry}/${ImageOwner}/${ImageName}:${tag}`,
  ];
  await ImageCli(cmd);
}

async function ImageCliTag(tag: string, alias: string) {
  const cmd = [
    "tag",
    `${Registry}/${ImageOwner}/${ImageName}:${tag}`,
    `${Registry}/${ImageOwner}/${ImageName}:${alias}`,
  ];
  await ImageCli(cmd);
}

const GitRoot = Deno.args[0];
const GitSha = Deno.args[1] || "HEAD";
const ImageName = Deno.args[2];
const Registry: "docker.io" | "quay.io" = Deno.env.get("Registry") as
  | "docker.io"
  | "quay.io"; // docker.io or quay.io
const ImageOwner = Deno.env.get("image_owner") || "";
const ImageBuildTool = "docker";

const LatestTagFile = path.join(GitRoot, ImageName, "latest");

const AliasesTagFile = (tag: string) =>
  path.join(GitRoot, ImageName, tag, "tags");

async function main() {
  const files = await GitDiffFilesByPath(
    { root: GitRoot, sha: GitSha, path: ImageName },
  );
  const { builds, aliases, deletes } = await analyseChangeFiles(files);
  console.log("delete", deletes);
  console.log("build", builds);
  console.log("aliaes", aliases);

  for (const tag of deletes) {
    deleteImage(Registry, ImageOwner!, ImageName, tag);
  }
  if (builds.size + aliases.size === 0) {
    return;
  }
  await ImageCliLogin(Registry, ImageOwner!, RegPass!);
  for (const tag of builds) {
    await ImageCliBuild(tag);
    await ImageCliPush(tag);
  }
  for (const [tag, alias] of aliases.entries()) {
    await ImageCliPull(tag);
    for (const a of alias) {
      await ImageCliTag(tag, a);
      await ImageCliPush(a);
    }
  }
}

// run
await main();
