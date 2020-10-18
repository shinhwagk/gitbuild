import { existsSync } from "https://deno.land/std@0.74.0/fs/mod.ts";
import { GitBuild } from "./gitbuild.ts";

// main
if (
  Deno.args.length === 2 &&
  existsSync(Deno.args[1]) &&
  Deno.statSync(Deno.args[1]).isDirectory
) {
  const gb = new GitBuild(".", Deno.args[0], Deno.args[1]);
  gb.launch();
}
