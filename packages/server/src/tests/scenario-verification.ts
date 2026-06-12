import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkExecutionWindow, checkPathBoundary, checkStorageQuota, measureDirectorySize } from '../scheduler/plan-executor.js';
import { applyConflictStrategy, rollbackJournal, type JournalEntry } from '../services/restore-service.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'test-'));
}

// =============================================================================
// Test 1: Execution Window
// =============================================================================

function testExecutionWindowBlocking(): void {
  const currentHour = new Date().getHours();

  // A cron with a different hour should block
  const differentHour = (currentHour + 12) % 24;
  const cronDifferent = `0 ${differentHour} * * *`;
  const error1 = checkExecutionWindow(cronDifferent);
  assert(error1 !== null, `Should block when hour is ${differentHour} but current is ${currentHour}`);
  assert(error1!.includes('outside execution window'), `Error should mention 'outside execution window': ${error1}`);

  // A cron with wildcard hour should allow
  const cronWildcard = '0 * * * *';
  const error2 = checkExecutionWindow(cronWildcard);
  assert(error2 === null, `Should allow wildcard hour, got: ${error2}`);

  // A cron matching the current hour should allow
  const cronMatch = `0 ${currentHour} * * *`;
  const error3 = checkExecutionWindow(cronMatch);
  assert(error3 === null, `Should allow matching hour, got: ${error3}`);

  // A range that excludes current hour should block
  const rangeStart = (currentHour + 4) % 24;
  const rangeEnd = (currentHour + 8) % 24;
  if (rangeStart < rangeEnd) {
    const cronRange = `0 ${rangeStart}-${rangeEnd} * * *`;
    const error4 = checkExecutionWindow(cronRange);
    assert(error4 !== null, `Should block range ${rangeStart}-${rangeEnd} when current is ${currentHour}`);
  }

  // Comma-separated hours excluding current should block
  const h1 = (currentHour + 3) % 24;
  const h2 = (currentHour + 6) % 24;
  const cronComma = `0 ${h1},${h2} * * *`;
  const error5 = checkExecutionWindow(cronComma);
  assert(error5 !== null, `Should block comma hours [${h1},${h2}] when current is ${currentHour}`);
  assert(error5!.includes('outside allowed hours'), `Should mention 'outside allowed hours': ${error5}`);
}

// =============================================================================
// Test 2: Permission Boundary
// =============================================================================

function testPermissionBoundary(): void {
  const tmpBase = makeTempDir();
  const allowedDir = join(tmpBase, 'allowed');
  const outsideDir = join(tmpBase, 'outside');
  mkdirSync(allowedDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  // Path within boundary should pass
  const err1 = checkPathBoundary([allowedDir], [allowedDir]);
  assert(err1 === null, `Path within boundary should pass, got: ${err1}`);

  // Subdirectory within allowed should pass
  const subDir = join(allowedDir, 'sub');
  mkdirSync(subDir);
  const err2 = checkPathBoundary([subDir], [allowedDir]);
  assert(err2 === null, `Subdirectory within boundary should pass, got: ${err2}`);

  // Path outside boundary should fail
  const err3 = checkPathBoundary([outsideDir], [allowedDir]);
  assert(err3 !== null, `Path outside boundary should fail`);
  assert(err3!.includes('outside allowed boundaries'), `Should mention boundaries: ${err3}`);
  assert(err3!.includes(outsideDir), `Should mention the offending path: ${err3}`);

  // Null allowedBasePaths (no restriction) should pass anything
  const err4 = checkPathBoundary([outsideDir], null);
  assert(err4 === null, `Null boundary should allow anything, got: ${err4}`);

  // Empty array should also allow anything
  const err5 = checkPathBoundary([outsideDir], []);
  assert(err5 === null, `Empty boundary should allow anything, got: ${err5}`);

  // Non-existent path should fail with permission message
  const err6 = checkPathBoundary(['/nonexistent-path-xyz-12345'], ['/']);
  assert(err6 !== null, `Non-existent path should fail`);
  assert(err6!.includes('Cannot read path'), `Should mention readable: ${err6}`);

  rmSync(tmpBase, { recursive: true, force: true });
}

// =============================================================================
// Test 3: Storage Quota
// =============================================================================

function testStorageQuota(): void {
  const tmpDir = makeTempDir();

  // Create nested structure: 3 levels, 5 files each of 100 bytes
  for (let d = 0; d < 3; d++) {
    const dir = join(tmpDir, `level${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 5; f++) {
      writeFileSync(join(dir, `file${f}.txt`), 'x'.repeat(100));
    }
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    for (let f = 0; f < 5; f++) {
      writeFileSync(join(sub, `nested${f}.txt`), 'y'.repeat(200));
    }
  }
  // Total: 15 files of 100 bytes + 15 files of 200 bytes = 30 files, 4500 bytes

  // measureDirectorySize should give accurate counts
  const measured = measureDirectorySize(tmpDir);
  assert(measured.files === 30, `Expected 30 files, got ${measured.files}`);
  assert(measured.bytes === 4500, `Expected 4500 bytes, got ${measured.bytes}`);
  assert(measured.partial === false, `Should not be partial`);

  // checkStorageQuota should reject when over limit
  const err1 = checkStorageQuota([tmpDir], 1000, null);
  assert(err1 !== null, `Should reject 4500 bytes when quota is 1000`);
  assert(err1!.includes('exceeds quota'), `Should mention exceeds: ${err1}`);

  // checkStorageQuota should reject when file count exceeded
  const err2 = checkStorageQuota([tmpDir], null, 10);
  assert(err2 !== null, `Should reject 30 files when limit is 10`);
  assert(err2!.includes('exceeds limit'), `Should mention exceeds: ${err2}`);

  // Should pass when within limits
  const err3 = checkStorageQuota([tmpDir], 10000, 100);
  assert(err3 === null, `Should pass within limits, got: ${err3}`);

  rmSync(tmpDir, { recursive: true, force: true });
}

// =============================================================================
// Test 4: Restore Rollback
// =============================================================================

function testRestoreRollback(): void {
  const sourceDir = makeTempDir();
  const targetDir = makeTempDir();

  // Create source files (simulating what restic restored to temp)
  writeFileSync(join(sourceDir, 'a.txt'), 'new-content-a');
  writeFileSync(join(sourceDir, 'b.txt'), 'new-content-b');
  writeFileSync(join(sourceDir, 'c.txt'), 'new-content-c');
  // Create a subdir that will contain the file that triggers failure
  mkdirSync(join(sourceDir, 'blocked'));
  writeFileSync(join(sourceDir, 'blocked', 'nope.txt'), 'should-fail');

  // Create pre-existing files in target
  writeFileSync(join(targetDir, 'a.txt'), 'original-a');
  writeFileSync(join(targetDir, 'b.txt'), 'original-b');

  // Record original state
  const originalA = readFileSync(join(targetDir, 'a.txt'), 'utf-8');
  const originalB = readFileSync(join(targetDir, 'b.txt'), 'utf-8');

  // Create a 'blocked' dir in target that is read-only — copyFileSync will fail with EACCES
  // But EACCES is caught and skipped. Instead, we'll trigger ENOSPC by patching.
  // Better approach: create a file in source that targets a path where the parent is a file (not dir)
  // which will make mkdirSync fail.
  writeFileSync(join(targetDir, 'blocked'), 'i-am-a-file-not-a-dir');

  // Now walkAndCopy will try to mkdirSync(targetDir + '/blocked') but it's a file,
  // which will throw ENOTDIR
  let threw = false;
  try {
    applyConflictStrategy(sourceDir, targetDir, 'rename');
  } catch (err: any) {
    threw = true;
  }

  assert(threw, 'Should have thrown an error');

  // Verify target directory is back to original state
  const afterA = readFileSync(join(targetDir, 'a.txt'), 'utf-8');
  const afterB = readFileSync(join(targetDir, 'b.txt'), 'utf-8');
  assert(afterA === originalA, `a.txt should be restored to original, got: "${afterA}"`);
  assert(afterB === originalB, `b.txt should be restored to original, got: "${afterB}"`);

  // Files that were newly created (c.txt) should have been removed
  assert(!existsSync(join(targetDir, 'c.txt')), 'c.txt should have been rolled back (removed)');

  // .bak files should have been moved back
  assert(!existsSync(join(targetDir, 'a.txt.bak')), 'a.txt.bak should have been rolled back');
  assert(!existsSync(join(targetDir, 'b.txt.bak')), 'b.txt.bak should have been rolled back');

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
}

// =============================================================================
// Test 5: Rollback with symlinks
// =============================================================================

function testRollbackWithSymlinks(): void {
  const sourceDir = makeTempDir();
  const targetDir = makeTempDir();

  // Source has a file and a symlink
  writeFileSync(join(sourceDir, 'real.txt'), 'content');
  symlinkSync('/nonexistent-target', join(sourceDir, 'link.txt'));
  // Create a subdir with a file that will trigger failure
  mkdirSync(join(sourceDir, 'blocked'));
  writeFileSync(join(sourceDir, 'blocked', 'nope.txt'), 'data');

  // Target has pre-existing file
  writeFileSync(join(targetDir, 'real.txt'), 'original-real');

  // Create a file named 'blocked' in target to conflict with source's directory
  writeFileSync(join(targetDir, 'blocked'), 'i-am-a-file');

  let threw = false;
  try {
    applyConflictStrategy(sourceDir, targetDir, 'rename');
  } catch {
    threw = true;
  }

  assert(threw, 'Should have thrown');
  const afterReal = readFileSync(join(targetDir, 'real.txt'), 'utf-8');
  assert(afterReal === 'original-real', `real.txt should be original, got: "${afterReal}"`);
  assert(!existsSync(join(targetDir, 'link.txt')), 'symlink should be rolled back');

  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
}

// =============================================================================
// Runner
// =============================================================================

const tests: [string, () => void][] = [
  ['Execution window blocks both scheduled and manual', testExecutionWindowBlocking],
  ['Permission boundary rejects unauthorized paths', testPermissionBoundary],
  ['Storage quota accurately measures and blocks', testStorageQuota],
  ['Restore rollback restores target on failure', testRestoreRollback],
  ['Restore rollback handles symlinks', testRollbackWithSymlinks],
];

console.log('Running scenario verification tests...\n');

for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
