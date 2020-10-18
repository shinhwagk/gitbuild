// import { assertEquals } from "https://deno.land/std@0.74.0/testing/asserts.ts";
// import { Git } from "./main.ts";

// Deno.removeSync("/tmp/test", { recursive: true });
// Deno.mkdirSync("/tmp/test", { recursive: true });
// await ExecCommand(["git", "init"], "/tmp/test");
// writeFile("/tmp/test/file1", "a");
// await ExecCommand(["git", "add", "-A"], "/tmp/test");
// await ExecCommand(["git", "commit", "-m", "'add file1'"], "/tmp/test");

// async function ExecCommand(cmd: string[], cwd?: string) {
//   const p = Deno.run({ cmd, cwd });
//   console.log((await p.status()).code);
// }

// function writeFile(file: string, content: string) {
//   const f = Deno.openSync(file, { write: true, create: true });
//   f.writeSync(new TextEncoder().encode(content));
//   f.close();
// }

// const git = new Git("/tmp/test");
// const changes = await git.diffFilesStatusByPath();
// console.log(changes);
// Deno.test({
//   name: "testing example",
//   fn(): void {
//     assertEquals(changes, [{ gitStatus: "M", gitFile: "file1" }]);
//   },
// });
