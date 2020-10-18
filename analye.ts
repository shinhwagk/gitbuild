import * as path from "https://deno.land/std@0.74.0/path/mod.ts";
import { readLines } from "https://deno.land/std@0.74.0/io/bufio.ts";
import { existsSync } from "https://deno.land/std@0.74.0/fs/exists.ts";

import { Git } from "./git.ts";

export class AnalyseTags {
  private readonly buildTags = new Set<string>();
  private readonly deleteTags = new Set<string>();
  private readonly aliasesTags: Map<string, string[]> = new Map();

  constructor(
    private readonly git: Git,
    private readonly name: string,
    private readonly sha: string,
  ) {
  }
  private async filterAffectedTags() {
    for (
      const { status: gitStatus, file: gitFile } of await this.git
        .diffFilesByPath(
          this.sha,
          this.name,
        )
    ) {
      const sf = gitFile.split("/");
      if (sf.length >= 3) {
        const tag = sf[1];
        if (["D"].includes(gitStatus) && this.checkTagDirExist(tag)) {
          this.buildTags.add(tag);
        } else {
          this.deleteTags.add(tag);
        }
        if (
          ["M"].includes(gitStatus) &&
          gitFile != path.join(this.name, tag, "tags") &&
          this.checkTagDirExist(tag)
        ) {
          this.buildTags.add(tag);
        }
      }
    }
  }

  private checkTagDirExist(tag: string): boolean {
    return existsSync(path.join(this.name, tag));
  }

  private async readTagAliases(tag: string): Promise<string[]> {
    const aliases: string[] = [];
    if (existsSync(path.join(this.name, tag, "tags"))) {
      const f = Deno.openSync(path.join(this.name, tag, "tags"));
      for await (const alias of readLines(f)) {
        aliases.push(alias);
      }
      f.close();
    }
    return aliases;
  }

  private async getRemoveAliasesFromTag(tag: string): Promise<string[]> {
    const tagFile = path.join(this.name, tag, "tags");
    const tags = [];
    for (
      const { status, content } of await this.git.diffContentByFile(
        this.sha,
        tagFile,
      )
    ) {
      if (status === "-") {
        tags.push(content);
      }
    }
    return tags;
  }

  public async classifyTags(): Promise<void> {
    await this.filterAffectedTags();
    for (const tag of this.buildTags) {
      for (const alias of await this.getRemoveAliasesFromTag(tag)) {
        this.deleteTags.add(alias);
      }
      for (const alias of await this.readTagAliases(tag)) {
        if (!this.aliasesTags.has(tag)) {
          this.aliasesTags.set(tag, []);
        }
        this.aliasesTags.get(tag)?.push(alias);
      }
    }
    for (const tag of this.deleteTags) {
      for (const alias of await this.getRemoveAliasesFromTag(tag)) {
        this.deleteTags.add(alias);
      }
    }
  }
  public async getProcessedTags() {
    await this.filterAffectedTags();
    await this.classifyTags();
    return {
      buildTags: this.buildTags,
      deletesTags: this.deleteTags,
      aliasesTags: this.aliasesTags,
    };
  }
}
