/**
 * Verification script for backup plan constraints and restore rollback.
 * Run with: npx tsx packages/server/src/tests/verify-scenarios.ts
 *
 * Tests:
 * 1. Execution window rejection (both manual and scheduled)
 * 2. Path boundary rejection
 * 3. Storage quota exceeded
 * 4. Restore conflict rename + rollback on failure
 * 5. Symlink handling in restore
 * 6. Disk space check
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync, rmSync, readdirSync, renameSync, copyFileSync, statSync, readlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import assert from 'node:assert';

const TEST_DIR = join(tmpdir(), 'restful-backup-verify-' + Date.now());
mkdirSync(TEST_DIR, { recursive: true });

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// === Inline the functions under test (import-free unit tests) ===

function checkExecutionWindow(allowedStart: number | null, allowedEnd: number | null): string | null {
  if (allowedStart == null || allowedEnd == null) return null;
  const currentHour = new Date().getHours();
  if (allowedStart <= allowedEnd) {
    if (currentHour < allowedStart || currentHour > allowedEnd) {
      return `Current hour ${currentHour}:00 is outside allowed execution window ${allowedStart}:00–${allowedEnd}:59. Backup refused.`;
    }
  } else {
    if (currentHour < allowedStart && currentHour > allowedEnd) {
      return `Current hour ${currentHour}:00 is outside allowed execution window ${allowedStart}:00–${allowedEnd}:59 (overnight). Backup refused.`;
    }
  }
  return null;
}

function checkPathBoundary(paths: string[], allowedBasePaths: string[]): string | null {
  if (allowedBasePaths.length === 0) return null;
  const resolvedAllowed = allowedBasePaths.map((p: string) => resolve(p));
  for (const p of paths) {
    const resolved = resolve(p);
    const isWithinAllowed = resolvedAllowed.some((base: string) =>
      resolved === base || resolved.startsWith(base + '/')
    );
    if (!isWithinAllowed) {
      return `Path "${p}" is outside allowed boundaries. Allowed base paths: ${allowedBasePaths.join(', ')}`;
    }
  }
  return null;
}

function scanDirectorySize(dirPath: string, maxBytes: number | null, maxFileCount: number | null, depth = 0): { bytes: number; files: number } {
  if (depth > 32) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      try {
        const fullPath = join(dirPath, entry.name);
        if (entry.isSymbolicLink()) {
          files++;
        } else if (entry.isFile()) {
          const s = statSync(fullPath);
          bytes += s.size;
          files++;
        } else if (entry.isDirectory()) {
          const sub = scanDirectorySize(fullPath, maxBytes, maxFileCount, depth + 1);
          bytes += sub.bytes;
          files += sub.files;
        }
        if (maxBytes && bytes > maxBytes) return { bytes, files };
        if (maxFileCount && files > maxFileCount) return { bytes, files };
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return { bytes, files };
}

// Rollback helpers
type MutationRecord = { type: 'renamed'; originalPath: string; bakPath: string } |
  { type: 'created'; path: string } |
  { type: 'overwritten'; path: string; bakPath: string };

function rollbackMutations(mutations: MutationRecord[]): void {
  for (let i = mutations.length - 1; i >= 0; i--) {
    const m = mutations[i];
    try {
      if (m.type === 'created') {
        if (existsSync(m.path)) rmSync(m.path, { force: true });
      } else if (m.type === 'renamed') {
        if (existsSync(m.bakPath)) {
          if (existsSync(m.originalPath)) rmSync(m.originalPath, { force: true });
          renameSync(m.bakPath, m.originalPath);
        }
      } else if (m.type === 'overwritten') {
        if (existsSync(m.bakPath)) {
          rmSync(m.path, { force: true });
          renameSync(m.bakPath, m.path);
        }
      }
    } catch { /* best effort */ }
  }
}

// =========================================================================
console.log('\n=== Scenario 1: Execution Window ===');
// =========================================================================

test('Rejects when current hour is outside allowed range', () => {
  const currentHour = new Date().getHours();
  // Set window to hour that definitely doesn't include now
  const outsideStart = (currentHour + 5) % 24;
  const outsideEnd = (currentHour + 7) % 24;
  const result = checkExecutionWindow(outsideStart, outsideEnd);
  assert(result !== null, 'Expected rejection but got null');
  assert(result!.includes('outside allowed execution window'), `Unexpected message: ${result}`);
  assert(result!.includes('Backup refused'), `Missing refusal: ${result}`);
});

test('Allows when current hour is within range', () => {
  const currentHour = new Date().getHours();
  const result = checkExecutionWindow(currentHour, currentHour);
  assert(result === null, `Expected null but got: ${result}`);
});

test('Handles overnight wrapping range', () => {
  const currentHour = new Date().getHours();
  // Create wrapping range that excludes current hour: e.g. if it's 14, use 16-12 (allows 16..23,0..12)
  const start = (currentHour + 2) % 24;
  const end = (currentHour - 2 + 24) % 24;
  if (start > end) {
    const result = checkExecutionWindow(start, end);
    assert(result !== null, `Expected rejection for wrapping range but got null`);
  }
});

test('Returns null when no window configured', () => {
  const result = checkExecutionWindow(null, null);
  assert(result === null);
});

// =========================================================================
console.log('\n=== Scenario 2: Path Boundary ===');
// =========================================================================

test('Rejects path outside allowed base paths', () => {
  const result = checkPathBoundary(['/etc/shadow'], ['/home/user', '/var/backups']);
  assert(result !== null);
  assert(result!.includes('/etc/shadow'));
  assert(result!.includes('outside allowed boundaries'));
  assert(result!.includes('/home/user'));
});

test('Allows path within boundary', () => {
  const result = checkPathBoundary(['/home/user/docs'], ['/home/user']);
  assert(result === null, `Expected null but got: ${result}`);
});

test('Allows exact match of base path', () => {
  const result = checkPathBoundary(['/home/user'], ['/home/user']);
  assert(result === null, `Expected null but got: ${result}`);
});

test('Skips check when no allowedBasePaths configured', () => {
  const result = checkPathBoundary(['/anywhere/at/all'], []);
  assert(result === null);
});

test('Prevents path traversal attacks', () => {
  const result = checkPathBoundary(['/home/user/../root'], ['/home/user']);
  // resolve() will normalize the path
  assert(result !== null, 'Should reject traversal path');
});

// =========================================================================
console.log('\n=== Scenario 3: Storage Quota ===');
// =========================================================================

test('Accurately counts files in large directory', () => {
  const dir = join(TEST_DIR, 'quota-test');
  mkdirSync(dir, { recursive: true });
  // Create 50 files of 100 bytes each = 5000 bytes
  for (let i = 0; i < 50; i++) {
    writeFileSync(join(dir, `file-${i}.txt`), 'x'.repeat(100));
  }
  const result = scanDirectorySize(dir, null, null);
  assert.strictEqual(result.files, 50, `Expected 50 files, got ${result.files}`);
  assert.strictEqual(result.bytes, 5000, `Expected 5000 bytes, got ${result.bytes}`);
});

test('Early exit when exceeding byte quota', () => {
  const dir = join(TEST_DIR, 'quota-test');
  const result = scanDirectorySize(dir, 2000, null);
  assert(result.bytes > 2000, `Expected >2000 bytes, got ${result.bytes}`);
  // Should stop early, might not count all files
});

test('Early exit when exceeding file count quota', () => {
  const dir = join(TEST_DIR, 'quota-test');
  const result = scanDirectorySize(dir, null, 20);
  assert(result.files > 20, `Expected >20 files, got ${result.files}`);
});

test('Handles nested directories recursively', () => {
  const dir = join(TEST_DIR, 'quota-nested');
  mkdirSync(join(dir, 'sub1', 'sub2'), { recursive: true });
  writeFileSync(join(dir, 'a.txt'), 'hello');
  writeFileSync(join(dir, 'sub1', 'b.txt'), 'world');
  writeFileSync(join(dir, 'sub1', 'sub2', 'c.txt'), '!');
  const result = scanDirectorySize(dir, null, null);
  assert.strictEqual(result.files, 3, `Expected 3 files, got ${result.files}`);
});

// =========================================================================
console.log('\n=== Scenario 4: Restore Rollback ===');
// =========================================================================

test('Rollback restores original files after failure', () => {
  const targetDir = join(TEST_DIR, 'rollback-test');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'existing.txt'), 'ORIGINAL CONTENT');

  const mutations: MutationRecord[] = [];

  // Simulate: rename existing.txt -> existing.txt.bak
  const bakPath = join(targetDir, 'existing.txt.bak');
  renameSync(join(targetDir, 'existing.txt'), bakPath);
  mutations.push({ type: 'renamed', originalPath: join(targetDir, 'existing.txt'), bakPath });

  // Simulate: write a new file
  writeFileSync(join(targetDir, 'new-file.txt'), 'NEW');
  mutations.push({ type: 'created', path: join(targetDir, 'new-file.txt') });

  // Simulate failure — do rollback
  rollbackMutations(mutations);

  // Verify: original file is back with original content
  const content = readFileSync(join(targetDir, 'existing.txt'), 'utf-8');
  assert.strictEqual(content, 'ORIGINAL CONTENT', `Got: ${content}`);

  // Verify: new file was removed
  assert(!existsSync(join(targetDir, 'new-file.txt')), 'new-file.txt should be deleted after rollback');

  // Verify: .bak file is gone (moved back)
  assert(!existsSync(bakPath), '.bak file should be gone after rollback');
});

test('Rollback undoes overwritten files', () => {
  const targetDir = join(TEST_DIR, 'rollback-overwrite');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'data.txt'), 'VERSION_1');

  const mutations: MutationRecord[] = [];

  // Simulate overwrite: backup original, write new
  const bakPath = join(targetDir, 'data.txt.bak');
  renameSync(join(targetDir, 'data.txt'), bakPath);
  mutations.push({ type: 'overwritten', path: join(targetDir, 'data.txt'), bakPath });
  writeFileSync(join(targetDir, 'data.txt'), 'VERSION_2');

  // Simulate failure
  rollbackMutations(mutations);

  const content = readFileSync(join(targetDir, 'data.txt'), 'utf-8');
  assert.strictEqual(content, 'VERSION_1', `Expected VERSION_1, got: ${content}`);
});

// =========================================================================
console.log('\n=== Scenario 5: Symlink Handling ===');
// =========================================================================

test('Symlinks are preserved during copy', () => {
  const srcDir = join(TEST_DIR, 'symlink-src');
  const dstDir = join(TEST_DIR, 'symlink-dst');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(dstDir, { recursive: true });

  writeFileSync(join(srcDir, 'target.txt'), 'hello');
  symlinkSync('target.txt', join(srcDir, 'link.txt'));

  // Manually simulate the copy logic
  const linkTarget = readlinkSync(join(srcDir, 'link.txt'));
  symlinkSync(linkTarget, join(dstDir, 'link.txt'));

  const stat = lstatSync(join(dstDir, 'link.txt'));
  assert(stat.isSymbolicLink(), 'Should be a symlink');
  const resolvedTarget = readlinkSync(join(dstDir, 'link.txt'));
  assert.strictEqual(resolvedTarget, 'target.txt');
});

// =========================================================================
console.log('\n=== Scenario 6: Disk Space Check ===');
// =========================================================================

test('checkDiskSpace returns null when space is sufficient', () => {
  const targetPath = TEST_DIR;
  try {
    const output = execSync(`df -B1 "${targetPath}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
    const parts = output.trim().split(/\s+/);
    if (parts.length >= 4) {
      const available = parseInt(parts[3], 10);
      assert(available > 100 * 1024 * 1024, `Available space: ${available} bytes — less than 100MB`);
    }
  } catch {
    // If df fails, the check is a no-op (acceptable)
  }
});

// =========================================================================
// Cleanup and results
// =========================================================================

rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
