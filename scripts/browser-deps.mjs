// The CLI and the test API must load the same Playwright instance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve('@playwright/test/package.json'));
const cli = require.resolve('playwright/package.json');
const runner = testRequire.resolve('playwright/package.json');
assert.equal(cli, runner, 'Browser CLI and @playwright/test resolve different Playwright installations; use npm ci without transient installs.');
console.log(`Browser runner dependency verified: Playwright ${require(cli).version}`);
