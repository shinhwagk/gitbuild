import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.74.0/io/bufio.ts";
import { existsSync } from "https://deno.land/std@0.74.0/fs/exists.ts";

type GitFileContentStatus = "+" | "-";

const diffHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function execCommand(cmd: string[], cwd?: string) {
  return Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
    cwd,
  });
}

async function procOutputLines(
  proc: Deno.Process<{ cmd: string[]; stdout: "piped"; stderr: "piped" }>,
) {
  const output = [];
  if ((await proc.status()).code === 0) {
    for await (const l of readLines(proc.stdout as Deno.Reader)) {
      output.push(l);
    }
  } else {
    for await (const l of readLines(proc.stderr as Deno.Reader)) {
      console.log(l);
    }
  }
  return output;
}

async function procConsole(
  proc: Deno.Process<{ cmd: string[]; stdout: "piped"; stderr: "piped" }>,
) {
  (await procOutputLines(proc)).forEach(console.log);
}

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
  const cmd = `git log --pretty= -1 -p --name-only ${c.sha} -- ${c.path}`
    .split(" ");
  const proc = execCommand(cmd, c.root);
  const files = (await procOutputLines(proc)).filter((l) => l.length >= 1);
  console.log("GitDiffFilesByPath", files);
  return files;
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

function deleteImage(
  registry: string,
  username: string,
  name: string,
  tag: string,
) {
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
  procConsole(execCommand(cmd, `${GitRoot}/${ImageName}/${tag}`));
}

async function ImageCliPush(tag: string) {
  const cmd = [
    ImageBuildTool,
    "push",
    `${Registry}/${RegUser}/${ImageName}:${tag}`,
  ];
  procConsole(execCommand(cmd));
}

async function ImageCliTag(tag: string, alias: string) {
  const cmd = [
    ImageBuildTool,
    "tag",
    `${Registry}/${RegUser}/${ImageName}:${tag}`,
    `${Registry}/${RegUser}/${ImageName}:${alias}`,
  ];
  procConsole(execCommand(cmd));
}

const GitRoot = Deno.args[0];
const GitSha = Deno.args[2] || "HEAD";
const ImageName = Deno.args[1];
const Registry: "docker.io" | "quay.io" = Deno.env.get("Registry") as
  | "docker.io"
  | "quay.io"; // docker.io or quay.io
const RegUser = Deno.env.get("RegistryUsername") || "";
const RegPass = Deno.env.get("RegistryPasswrod") || "";
const ImageBuildTool: "docker" | "podman" = "docker";

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

  // for (const tag of deletes) {
  //   deleteImage(Registry, RegUser!, ImageName, tag);
  // }
  // ImageCliLogin(Registry, RegUser!, RegPass!);
  for (const tag of builds) {
    await ImageCliBuild(tag);
    // await ImageCliPush(tag);
  }
  // for (const [tag, alias] of aliases.entries()) {
  //   for (const a of alias) {
  //     await ImageCliTag(tag, a);
  //     await ImageCliPush(a);
  //   }
  // }
}

console.log(Deno.cwd());
// run
await main();
