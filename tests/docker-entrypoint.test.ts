import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ENTRYPOINT_PATH = path.join(process.cwd(), 'scripts', 'docker-entrypoint.sh');
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-entrypoint-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

// scripts/docker-entrypoint.sh is a POSIX shell script that only ever runs
// inside the Linux-based Docker image; there is no /bin/sh on Windows runners.
describe.skipIf(process.platform === 'win32')('scripts/docker-entrypoint.sh', () => {
  it('runs "npm run generate" before exec-ing the given command', () => {
    const result = spawnSync('sh', [ENTRYPOINT_PATH, 'node', '-e', 'console.log("exec-ok")'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Generated');
    expect(result.stdout).toContain('exec-ok');
  });

  it("propagates the exec-ed command's exit code", () => {
    const result = spawnSync('sh', [ENTRYPOINT_PATH, 'node', '-e', 'process.exit(7)'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    expect(result.status).toBe(7);
  });

  it('stops (set -e) and never execs the command when "npm run generate" fails', () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { generate: 'exit 3' } })
    );

    const result = spawnSync('sh', [ENTRYPOINT_PATH, 'node', '-e', 'console.log("should-not-run")'], {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('should-not-run');
  });
});
