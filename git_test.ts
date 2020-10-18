import { assertEquals } from "https://deno.land/std@0.74.0/testing/asserts.ts";

import { Git } from "./git.ts";

// Deno.removeSync("/tmp/test", { recursive: true });
// Deno.mkdirSync("/tmp/test", { recursive: true });
// await ExecCommand(["git", "init"], "/tmp/test");
// writeFile("/tmp/test/file1", "a");
// await ExecCommand(["git", "add", "-A"], "/tmp/test");
// await ExecCommand(["git", "commit", "-m", "'add file1'"], "/tmp/test");

async function ExecCommand(cmd: string[], cwd?: string) {
  const p = Deno.run({ cmd, cwd });
  console.log((await p.status()).code);
}

function writeFile(file: string, content: string) {
  const f = Deno.openSync(file, { write: true, create: true });
  f.writeSync(new TextEncoder().encode(content));
  f.close();
}

const git = new Git("/tmp/test");
const filesChnage = await git.diffFilesByPath("HEAD", ".");
Deno.test({
  name: "diffFilesByPath",
  fn(): void {
    assertEquals(filesChnage, [{ status: "M", file: "file1" }]);
  },
});

const contentChange = await git.diffContentByFile("HEAD", "file1");

Deno.test({
  name: "diffContentByFile",
  fn(): void {
    assertEquals(contentChange, [{ status: "+", content: "a" }]);
  },
});
