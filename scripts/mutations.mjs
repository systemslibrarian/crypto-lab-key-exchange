// Replayable §4.1c mutations. Source is restored in finally after every run.
// A kill requires: green control, non-empty source diff, successful build,
// moved production-bundle hash, the named test red, then restored hash + green.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const mutations = JSON.parse(readFileSync(new URL('../mutations/ledger.json', import.meta.url), 'utf8'));
const requested = process.argv.slice(2).join(' ');
const selected = requested ? mutations.filter((mutation) => mutation.name === requested) : mutations;
if (selected.length === 0) throw new Error(`unknown mutation: ${requested}`);

function run(command, args, timeout = 300_000) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		env: { ...process.env, CI: '1' },
		timeout,
		maxBuffer: 16 * 1024 * 1024,
	});
	return {
		code: result.status,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
		error: result.error,
	};
}

function build() {
	const result = run('npm', ['run', 'build'], 90_000);
	if (result.code !== 0) throw new Error(`DOES NOT BUILD\n${result.output}`);
}

function bundleHash() {
	const hash = createHash('sha256');
	for (const file of readdirSync('dist/assets').filter((name) => /\.(?:js|css)$/.test(name)).sort()) {
		hash.update(file);
		hash.update(readFileSync(`dist/assets/${file}`));
	}
	return hash.digest('hex');
}

function owningTest(mutation) {
	return run('npx', [
		'playwright',
		'test',
		'e2e/claims.spec.ts',
		'--grep',
		mutation.test,
		'--workers=1',
		'--retries=0',
	]);
}

function sourceDiffIsNonEmpty(file) {
	const result = run('git', ['diff', '--exit-code', '--', file], 30_000);
	return result.code === 1 && result.output.trim().length > 0;
}

mkdirSync('.qa-artifacts/mutations', { recursive: true });
const records = [];

for (const mutation of selected) {
	const original = readFileSync(mutation.file, 'utf8');
	if (original.split(mutation.anchor).length !== 2) {
		throw new Error(`${mutation.name}: anchor must occur exactly once`);
	}

	build();
	const baselineHash = bundleHash();
	const baseline = owningTest(mutation);
	if (baseline.code !== 0) throw new Error(`${mutation.name}: baseline test was not green\n${baseline.output}`);

	let record;
	try {
		const changed = original.replace(mutation.anchor, mutation.replacement);
		if (changed === original) throw new Error(`${mutation.name}: EMPTY source patch`);
		writeFileSync(mutation.file, changed);
		if (!sourceDiffIsNonEmpty(mutation.file)) throw new Error(`${mutation.name}: source diff was EMPTY`);

		build();
		const mutatedHash = bundleHash();
		if (mutatedHash === baselineHash) throw new Error(`${mutation.name}: production bundle hash DID NOT MOVE`);

		const observed = owningTest(mutation);
		if (observed.code === 0) throw new Error(`${mutation.name}: mutation SURVIVED`);
		if (observed.error) throw observed.error;
		if (/DOES NOT BUILD|Process from config.webServer|ERR_CONNECTION_REFUSED|error TS\d|No tests found/i.test(observed.output)) {
			throw new Error(`${mutation.name}: red was infrastructure/build, not the named claim\n${observed.output}`);
		}
		if (!observed.output.includes(mutation.test)) {
			throw new Error(`${mutation.name}: red output did not name owning test “${mutation.test}”\n${observed.output}`);
		}
		if (!/expect\(|Expected:|toHaveText|toContainText|toBeVisible|TimeoutError/.test(observed.output)) {
			throw new Error(`${mutation.name}: failure did not name an asserted finding\n${observed.output}`);
		}
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
	}

	const restored = owningTest(mutation);
	if (restored.code !== 0) throw new Error(`${mutation.name}: restored test is not green\n${restored.output}`);
	record.restoredGreen = true;
	records.push(record);
	writeFileSync('.qa-artifacts/mutations/observed.json', `${JSON.stringify(records, null, 2)}\n`);
	console.log(`KILLED and restored: ${mutation.name}`);
}

console.log(`${records.length} of ${selected.length} concrete mutations killed, with passing controls.`);
