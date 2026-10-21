// Replayable §4.1c mutations. Source is restored in finally after every run.
// A kill requires: green control, non-empty source diff, successful build,
// moved production-bundle hash, the named test red, then restored hash + green.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { assertNormalExit, validateNamedRun } from './mutation-report.mjs';

const mutations = JSON.parse(readFileSync(new URL('../mutations/ledger.json', import.meta.url), 'utf8'));
const requested = process.argv.slice(2).join(' ');
const selected = requested ? mutations.filter((mutation) => mutation.name === requested) : mutations;
if (selected.length === 0) throw new Error(`unknown mutation: ${requested}`);

function run(command, args, timeout = 300_000) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
		timeout,
		maxBuffer: 16 * 1024 * 1024,
	});
	assertNormalExit(result, `${command} ${args.join(' ')}`);
	return { ...result, code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function build() {
	const result = run('npm', ['run', 'build'], 90_000);
	if (result.code !== 0) throw new Error(`DOES NOT BUILD\n${result.output}`);
}

function bundleHash() {
	const hash = createHash('sha256');
	for (const file of readdirSync('dist/assets').filter((name) => name.endsWith('.js')).sort()) {
		hash.update(file);
		hash.update(readFileSync(`dist/assets/${file}`));
	}
	return hash.digest('hex');
}

function owningTest(mutation, shouldPass) {
	const result = run('npx', [
		'--no-install',
		'playwright',
		'test',
		'e2e/claims.spec.ts',
		'--grep',
		`${mutation.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
		'--workers=1',
		'--retries=0',
		'--reporter=json',
	]);
	try {
		validateNamedRun(result, mutation.test, shouldPass);
	} catch (error) {
		throw new Error(`${error.message}\n${result.output}`);
	}
	return result;
}

function sourceDiffIsNonEmpty(file) {
	const result = run('git', ['diff', '--exit-code', '--', file], 30_000);
	return result.code === 1 && result.output.trim().length > 0;
}

mkdirSync('.qa-artifacts/mutations', { recursive: true });
if (run('git', ['status', '--porcelain']).output.trim() !== '') {
	throw new Error('Mutation run requires a clean committed worktree');
}
const records = [];

for (const mutation of selected) {
	const original = readFileSync(mutation.file, 'utf8');
	if (original.split(mutation.anchor).length !== 2) {
		throw new Error(`${mutation.name}: anchor must occur exactly once`);
	}

	build();
	const baselineHash = bundleHash();
	owningTest(mutation, true);

	let record;
	try {
		const changed = original.replace(mutation.anchor, mutation.replacement);
		if (changed === original) throw new Error(`${mutation.name}: EMPTY source patch`);
		writeFileSync(mutation.file, changed);
		if (!sourceDiffIsNonEmpty(mutation.file)) throw new Error(`${mutation.name}: source diff was EMPTY`);

		build();
		const mutatedHash = bundleHash();
		if (mutatedHash === baselineHash) throw new Error(`${mutation.name}: production bundle hash DID NOT MOVE`);

		const observed = owningTest(mutation, false);
		writeFileSync(`.qa-artifacts/mutations/${mutation.name.replaceAll(' ', '-')}.log`, observed.output);
		record = {
			...mutation,
			baselinePassed: true,
			sourceDiffNonEmpty: true,
			buildPassed: true,
			baselineHash,
			mutatedHash,
			bundleHashMoved: true,
			namedTestRed: true,
		};
	} finally {
		writeFileSync(mutation.file, original);
		build();
		if (bundleHash() !== baselineHash) throw new Error(`${mutation.name}: restored bundle hash differs`);
		owningTest(mutation, true);
		if (run('git', ['status', '--porcelain']).output.trim() !== '') {
			throw new Error(`${mutation.name}: source did not return to the committed tree`);
		}
	}
	record.restoredGreen = true;
	records.push(record);
	writeFileSync('.qa-artifacts/mutations/observed.json', `${JSON.stringify(records, null, 2)}\n`);
	console.log(`KILLED and restored: ${mutation.name}`);
}

console.log(`${records.length} of ${selected.length} concrete mutations killed, with passing controls.`);
