// Checks the Claude Desktop extension's manifest with the official tool, @anthropic-ai/mcpb,
// installed in a temporary folder (never as a dependency of this project): `node scripts/validate-mcpb.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const file = 'dist/mcp/gym-tracker.mcpb';
const scratch = mkdtempSync(join(tmpdir(), 'mcpb-'));
const ext = join(scratch, 'extension');
mkdirSync(join(ext, 'server'), { recursive: true });
for (const [name, bytes] of Object.entries(unzipSync(readFileSync(file)))) {
  if (!name.endsWith('/')) writeFileSync(join(ext, name), bytes);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--prefix', scratch, '--no-save', '--no-audit', '--no-fund', '@anthropic-ai/mcpb@2'], { stdio: 'inherit' });
const bin = join(scratch, 'node_modules', '.bin', process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb');
execFileSync(bin, ['validate', join(ext, 'manifest.json')], { stdio: 'inherit' });
execFileSync(bin, ['info', file], { stdio: 'inherit' });
