// radar-4 — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with the radar-4 model in
// lib/radar4.ts + lib/build.ts, and writes the output directory the
// gate reads: board.json, data.js, a copy of dashboard/ and
// screenshots/, and dossier.json built with the vendored make.fun
// library.
//
// Run it outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardProblem, dataScript, parseSnap } from './lib/build.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar-4: no snapshot at ${inputFile} — pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnap(readFileSync(inputFile, 'utf8'));
const { board, payload } = buildRadar(snap);
const problem = boardProblem(board, snap);
if (problem !== null) {
  process.stderr.write(`radar-4: refusing to write a board the gate rejects: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(payload));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const done: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    done.push(name);
  }
  return done;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar-4: screenshots/ holds ${shots.length} image(s); hand in 3: board, detail, filtered\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`radar-4: screenshots/${name} is not a plain dossier image name\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `radar-4: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows (${payload.early_size} early, ${payload.live_shown} of ${payload.live_total} live shown)\n` +
    `radar-4: LOO median |log error| ${payload.validation.loo.med_abs_log_err.toFixed(4)} (baseline ${payload.baseline.loo.med_abs_log_err.toFixed(4)}), walk-forward pooled ${payload.validation.walk_forward.pooled.med_abs_log_err.toFixed(4)} (baseline ${payload.baseline.walk_forward.pooled.med_abs_log_err.toFixed(4)})\n` +
    `radar-4: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shots.length}) and dossier.json\n`,
);
