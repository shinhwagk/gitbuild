import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.74.0/io/bufio.ts";
import { existsSync } from "https://deno.land/std@0.74.0/fs/exists.ts";

import { execCommand } from "./lib.ts";

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

export class Git {
  constructor(private readonly root: string = ".") {}

  async diffFilesByPath(
    sha: string = "HEAD~1",
    path: string,
  ): Promise<GitFileChange[]> {
    const cmd = `git log --pretty= -1 -p --name-status ${sha} -- ${path}`
      .split(" ");
    const rs: GitFileChange[] = [];
    const proc = execCommand(cmd, this.root);
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

  async diffContentByFile(
    sha: string = "HEAD~1",
    file: string,
  ): Promise<{ status: GitFileContentStatus; content: string }[]> {
    // const cmd = ["git", "diff", "-U0"].concat(sha).concat("--").concat(file);
    const cmd = `git log -p -1 --pretty= ${sha} -- ${file}`.split(" ");
    const rs: { status: GitFileContentStatus; content: string }[] = [];
    let isChange = false;
    for await (const line of readLines(execCommand(cmd, this.root).stdout)) {
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
}
