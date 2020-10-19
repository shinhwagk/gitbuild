import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.74.0/io/bufio.ts";
import { existsSync } from "https://deno.land/std@0.74.0/fs/exists.ts";

function execCommand(cmd: string[] | [URL, ...string[]], cwd?: string) {
  return Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
    cwd,
  });
}

export type GitFileContentStatus = "+" | "-";
export type GitFileChangeStatus = "M" | "D";
export type GitFileChange = { status: GitFileChangeStatus; file: string };

const diffHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
// class ShellCommand {
//   execCommand(cmd: string[], cwd?: string) {
//     Deno.run({
//       cmd,
//       stdout: "piped",
//       stderr: "piped",
//       cwd,
//     });
//     return this;
//   }
// }
interface IRegistry {
  login(): void;
  delete(org: string, name: string, tag: string): void;
}

class RegistryDockerIO implements IRegistry {
  token: string | undefined = undefined;
  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}
  async login(): Promise<void> {
    const x = await fetch("https://hub.docker.com/v2/users/login/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "",
        password: "",
      }),
    });
    if (x.status === 200) {
      this.token = await x.text();
      return;
    } else {
      this.token = undefined;
    }
    throw new Error(await x.text());
  }
  async delete(org: string, name: string, tag: string): Promise<void> {
    if (this.token !== undefined) {
      const x = await fetch(
        `https://hub.docker.com/v2/repositories/${org}/${name}/tags/${tag}/`,
        { method: "DELETE", headers: { Authorization: `JWT ${this.token}` } },
      );
      if (x.status in [204, 200]) {
        return;
      }
    }
    throw new Error(x.status + " " + await x.text());
  }
}

interface GitDiffConfig {
  root: string;
  sha: string;
  path: string;
}

async function GitDiffFilesByPath(
  c: GitDiffConfig,
): Promise<GitFileChange[]> {
  const cmd = `git log --pretty= -1 -p --name-status ${c.sha} -- ${c.path}`
    .split(" ");
  const rs: GitFileChange[] = [];
  const proc = execCommand(cmd, c.root);
  if ((await proc.status()).code !== 0) {
    throw new Error("diffFilesByPath error");
  }
  for await (const line of readLines(proc.stdout)) {
    if (line.length === 0) {
      continue;
    }
    const cols = line.split("\t");
    switch (cols[0]) {
      case "R100":
        rs.push({ status: "D", file: cols[1] });
        rs.push({ status: "M", file: cols[2] });
        break;
      case "D":
        rs.push({ status: "D", file: cols[1] });
        break;
      case "A":
        rs.push({ status: "M", file: cols[1] });
        break;
      case "M":
        rs.push({ status: "M", file: cols[1] });
        break;
      default:
        throw new Error("file status: " + cols[0] + " unkonw");
    }
  }
  return rs;
}

async function GitDiffContentByFile(
  c: GitDiffConfig,
): Promise<{ status: GitFileContentStatus; content: string }[]> {
  const cmd = `git log -p -1 --pretty= ${c.sha} -- ${c.path}`.split(" ");
  const rs: { status: GitFileContentStatus; content: string }[] = [];
  let isChange = false;
  for await (const line of readLines(execCommand(cmd, c.root).stdout)) {
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

// export class AnalyseTags {
//   private readonly buildTags = new Set<string>();
//   private readonly deleteTags = new Set<string>();
//   private readonly aliasesTags: Map<string, string[]> = new Map();

//   constructor(
//     private readonly git: Git,
//     private readonly name: string,
//     private readonly sha: string,
//   ) {
//   }
async function filterAffectedTags(changeFiles: GitFileChange[]) {
}

function checkTagDirExist(name: string, tag: string): boolean {
  return existsSync(path.join(name, tag));
}

async function readTagAliasesIfExist(
  name: string,
  tag: string,
): Promise<string[]> {
  const aliases: string[] = [];
  if (existsSync(AliasesTagFile(tag))) {
    const f = Deno.openSync(AliasesTagFile(tag));
    for await (const alias of readLines(f)) {
      aliases.push(alias.trim());
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
  changeFiles: GitFileChange[],
): Promise<TagAction> {
  const buildTags = new Set<string>();
  const deleteTags = new Set<string>();
  const aliasesTags: Map<string, Set<string>> = new Map();

  const latestTag = Deno.readTextFileSync(LatestTagFile)
    .trim();
  for (
    const { file: gitFile } of changeFiles
  ) {
    const [name, tag] = gitFile.split("/");
    if (buildTags.has(tag) || deleteTags.has(tag)) {
      continue;
    }
    if (
      checkTagDirExist(name, tag)
    ) {
      if (
        gitFile !== AliasesTagFile(tag)
      ) {
        buildTags.add(tag);
      }
      const appendLatestTag = (latestTag === tag) ? ["latest"] : [];
      for (
        const alias of (await readTagAliasesIfExist(name, tag)).concat(
          appendLatestTag,
        )
      ) {
        if (aliasesTags.has(tag)) {
          aliasesTags.get(tag)?.add(alias);
        } else {
          aliasesTags.set(tag, new Set());
        }
      }
    } else {
      // delete tag with that aliases and latest
      deleteTags.add(tag);
      if (latestTag === tag) {
        deleteTags.add("latest");
      }
      for (
        const alias of (await GitDiffContentByFile(
          {
            root: GitRoot,
            sha: GitSha,
            path: AliasesTagFile(tag),
          },
        )).filter((d) => d.status === "-").map((d) => d.content)
      ) {
        deleteTags.add(alias);
      }
    }
  }
  return { builds: buildTags, deletes: deleteTags, aliases: aliasesTags };
}
const GitRoot = Deno.args[0];
const ImageName = Deno.args[1];
const GitSha = Deno.args[2];
const Registry: "docker.io" | "quay.io" = Deno.env.get("Registry") as
  | "docker.io"
  | "quay.io"; // docker.io or quay.io
const RegUser = Deno.env.get("RegistryUsername");
const RegPass = Deno.env.get("RegistryPasswrod");
const ImageBuildTool = "docker";

function deleteImage(name: string, tag: string) {
  let api: IRegistry | undefined = undefined;
  if (Registry === "docker.io") {
    api = new RegistryDockerIO("", "");
  }
  api?.login();
  api?.delete(RegUser!, name, tag);
}

async function ImageCliLogin(
  registry: "docker.io" | "quay.io",
  username: string,
  password: string,
): Promise<void> {
  const cmd =
    `${ImageCliLogin} login ${registry} -u ${username} --password ${password}`
      .split(" ");
  execCommand(cmd);
}
async function ImageCliRemoveImage(
  registry: "docker.io" | "quay.io",
  username: string,
  password: string,
): Promise<void> {
  const cmd =
    `${ImageCliLogin} login ${registry} -u ${username} --password ${password}`
      .split(" ");
  execCommand(cmd);
}

async function ImageCliBuild(tag: string) {
  const cmd = [
    ImageBuildTool,
    "build",
    "-t",
    `${Registry}/${RegUser}/${ImageName}:${tag}`,
    ".",
  ];
  execCommand(cmd, `${GitRoot}/${ImageName}/${tag}`);
}

async function ImageCliPush(tag: string) {
  const cmd = [
    ImageBuildTool,
    "push",
    `${Registry}/${RegUser}/${ImageName}:${tag}`,
  ];
  execCommand(cmd);
}

async function ImageCliTag(tag: string, alias: string) {
  const cmd = [
    ImageBuildTool,
    "tag",
    `${Registry}/${RegUser}/${ImageName}:${tag}`,
    `${Registry}/${RegUser}/${ImageName}:${alias}`,
  ];
  execCommand(cmd);
}

const LatestTagFile = path.join(GitRoot, ImageName, "latest");
const AliasesTagFile = (tag: string) =>
  path.join(GitRoot, ImageName, tag, "tags");

async function main() {
  const files = await GitDiffFilesByPath(
    { root: GitRoot, sha: GitSha, path: ImageName },
  );
  const { builds, aliases, deletes } = await analyseChangeFiles(files);

  for (const tag of deletes) {
    deleteImage(Registry, RegUser!);
  }
  ImageCliLogin(Registry, RegUser!, RegPass!);
  for (const tag of builds) {
    await ImageCliBuild(tag);
    await ImageCliPush(tag);
  }
  for (const [tag, alias] of aliases.entries()) {
    for (const a of alias) {
      await ImageCliTag(tag, a);
      await ImageCliPush(a);
    }
  }
}
