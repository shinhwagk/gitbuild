import { execCommand } from "./lib.ts";
import { RegistryApiCli } from "./registry.ts";

export class ImageCli {
  private readonly hubApiL: RegistryApiCli;
  private readonly buildCmds: Deno.RunOptions[] = [];
  private readonly deleteTasks: { tag: string; name: string }[] = [];
  private readonly pushCmds: Deno.RunOptions[] = [];
  private readonly aliasCmds: Deno.RunOptions[] = [];
  constructor(
    private readonly repo: string,
    private readonly name: string,
    private readonly buildTool: "docker" | "podman",
    private readonly username: string,
    private readonly password: string,
  ) {
    this.hubApiL = new RegistryApiCli(this.name, this.username, this.password);
  }
  async addDelete(...tag: string[]) {
    for (const t of tag) {
      this.deleteTasks.push({ name: this.username + "/" + this.name, tag: t });
    }
  }

  async addBuild(...tag: string[]) {
    for (const t of tag) {
      this.buildCmds.push({
        cmd: [
          this.buildTool,
          "build",
          "-t",
          `${this.repo}/${this.name}:${tag}`,
          ".",
        ],
        cwd: `${this.name}/${t}`,
      });
      this.addPush(t);
    }
  }
  async addPush(tag: string) {
    this.pushCmds.push({
      cmd: [this.buildTool, "push", `${this.repo}/${this.name}:${tag}`],
    });
  }

  async AddAlias(tag: string, ...alias: string[]) {
    for (const a of alias) {
      const cmd = [
        this.buildTool,
        "tag",
        `${this.repo}/${this.name}:${tag}`,
        `${this.repo}/${this.name}:${a}`,
      ];
      this.aliasCmds.push({ cmd });
      this.addPush(a);
    }
  }

  async run() {
    for (const { name, tag } of this.deleteTasks) {
      this.hubApiL.delete(name, tag);
    }
    for (
      const { cmd, cwd } of this.buildCmds.concat(this.aliasCmds).concat(
        this.pushCmds,
      )
    ) {
      execCommand(cmd, cwd);
    }
  }
}
