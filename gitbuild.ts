import { AnalyseTags } from "./analye.ts";
import { Git } from "./git.ts";
import { ImageCli } from "./image.ts";

export class GitBuild {
  private readonly imgCli;
  private readonly aigf;
  private readonly git: Git;
  constructor(gitRoot: string, sha: string, buildPath: string) {
    this.git = new Git(gitRoot);
    this.aigf = new AnalyseTags(this.git, buildPath, sha);
    this.imgCli = new ImageCli("quay.io", buildPath, "podman", "", "");
  }
  async launch(): Promise<void> {
    const { buildTags, deletesTags, aliasesTags } = await this.aigf
      .getProcessedTags();
    for (const tag of deletesTags) {
      this.imgCli.addDelete(tag);
    }
    for (const tag of buildTags) {
      this.imgCli.addBuild(tag);
    }
    for (const [tag, aliases] of aliasesTags.entries()) {
      this.imgCli.AddAlias(tag, ...aliases);
    }
    await this.imgCli.run();
  }
}
