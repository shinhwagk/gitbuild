export function execCommand(cmd: string[] | [URL, ...string[]], cwd?: string) {
  return Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
    cwd,
  });
}
