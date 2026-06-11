import { spawn } from 'node:child_process';
import { config } from '../config.js';
import type { ResticEnvResult } from './env-builder.js';
import { ResticCommand } from './commands.js';

export interface ExecutionCallbacks {
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

export async function executeRestic(
  command: ResticCommand,
  envResult: ResticEnvResult,
  callbacks: ExecutionCallbacks,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  const env = {
    ...process.env,
    ...envResult.env,
  };

  const startTime = Date.now();
  let stdoutBuf = '';
  let stderrBuf = '';

  return new Promise((resolve) => {
    const proc = spawn(config.resticBinary, command.args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let killed = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }, command.timeoutMs);

    signal.addEventListener('abort', () => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 3000);
    });

    let stdoutRemainder = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutRemainder + chunk.toString();
      const lines = text.split('\n');
      stdoutRemainder = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          stdoutBuf += line + '\n';
          callbacks.onStdout(line);
        }
      }
    });

    let stderrRemainder = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = stderrRemainder + chunk.toString();
      const lines = text.split('\n');
      stderrRemainder = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          stderrBuf += line + '\n';
          callbacks.onStderr(line);
        }
      }
    });

    proc.on('close', (code) => {
      cleanup();
      envResult.cleanup();
      if (stdoutRemainder.trim()) {
        stdoutBuf += stdoutRemainder + '\n';
        callbacks.onStdout(stdoutRemainder);
      }
      if (stderrRemainder.trim()) {
        stderrBuf += stderrRemainder + '\n';
        callbacks.onStderr(stderrRemainder);
      }
      resolve({
        exitCode: code ?? 1,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        durationMs: Date.now() - startTime,
        killed,
      });
    });

    proc.on('error', (err) => {
      cleanup();
      envResult.cleanup();
      stderrBuf += err.message + '\n';
      callbacks.onStderr(`Process error: ${err.message}`);
      resolve({
        exitCode: 1,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        durationMs: Date.now() - startTime,
        killed: false,
      });
    });
  });
}
