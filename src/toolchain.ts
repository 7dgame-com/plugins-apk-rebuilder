import { execFileSync, spawnSync } from 'node:child_process';
import {
  APKTOOL_PATH,
  APKSIGNER_PATH,
  JAVA_HOME,
  JAVA_PATH,
  KEYTOOL_PATH,
  ZIPALIGN_PATH,
} from './config';

function run(command: string, args: string[], allowedExitCodes: Set<number> = new Set()): { ok: boolean; detail: string } {
  const env = { ...process.env, JAVA_HOME };
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
  });
  const detail = `${result.stdout || result.stderr || 'ok'}`.trim().split(/\r?\n/)[0] || 'ok';
  if (result.status === 0 || allowedExitCodes.has(result.status || 0)) {
    return { ok: true, detail };
  }
  return { ok: false, detail };
}

export function runCommand(command: string, args: string[]): void {
  execFileSync(command, args, {
    env: { ...process.env, JAVA_HOME },
    stdio: 'inherit',
  });
}

export function getToolchainStatus(): Record<string, unknown> {
  const apktool = APKTOOL_PATH.endsWith('.jar')
    ? run(JAVA_PATH, ['-jar', APKTOOL_PATH, '--version'])
    : run(APKTOOL_PATH, ['--version']);
  let zipalign = run(ZIPALIGN_PATH, ['--version'], new Set([2]));
  if (!zipalign.ok) {
    zipalign = { ok: true, detail: `optional fallback enabled (${zipalign.detail})` };
  }

  return {
    tools: {
      apktool: { command: APKTOOL_PATH, ...apktool },
      zipalign: { command: ZIPALIGN_PATH, ...zipalign },
      apksigner: { command: APKSIGNER_PATH, ...run(APKSIGNER_PATH, ['--version'], new Set([1, 2])) },
      keytool: { command: KEYTOOL_PATH, ...run(KEYTOOL_PATH, ['-help']) },
      java: { command: JAVA_PATH, ...run(JAVA_PATH, ['-version']) },
    },
  };
}

export function assertToolchainAvailable(): void {
  const status = getToolchainStatus() as {
    tools: Record<string, { ok: boolean; detail?: string }>;
  };
  const missing: string[] = [];
  const required = ['apktool', 'apksigner', 'keytool', 'java'];
  for (const name of required) {
    const tool = status.tools?.[name];
    if (!tool || !tool.ok) {
      missing.push(`${name}${tool?.detail ? ` (${tool.detail})` : ''}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Toolchain unavailable: ${missing.join(', ')}`);
  }
}
