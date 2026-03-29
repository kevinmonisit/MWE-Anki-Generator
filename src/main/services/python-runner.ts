import path from 'path';
import { spawn } from 'child_process';

export interface PythonResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runPythonScript(
  venvName: string,
  scriptName: string,
  args: string[] = [],
  stdin?: string
): Promise<PythonResult> {
  return new Promise((resolve) => {
    const venvPython = path.join(__dirname, '..', '..', '..', '..', venvName, 'bin', 'python3.13');
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', scriptName);

    const proc = spawn(venvPython, [scriptPath, ...args], {
      cwd: path.join(__dirname, '..', '..', '..', '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    proc.on('error', (err: Error) => {
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}
