import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Real presence check — actually spawns the binary rather than trusting a stored flag. */
export async function isCliAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 5000 });
    return true;
  } catch (err) {
    // A non-zero exit (e.g. an unrecognized --version flag) still proves the binary
    // exists and ran — only ENOENT means it's genuinely missing.
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
