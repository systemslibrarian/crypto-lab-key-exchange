import { expect, test, type Page } from '@playwright/test';

const NEGATIVE_CLAIM = 'Merkle puzzles give only a quadratic work gap: an eavesdropper who spends about L·|K| block-cipher operations recovers the secret. The protocol is not secure in the cryptographic sense.';

function numberFrom(text: string | null): number {
  const parsed = Number((text ?? '').replaceAll(',', '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`not a displayed number: ${text}`);
  return parsed;
}

async function boot(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#puzzle-table-verdict[data-verdict="puzzle-table"]')).toBeVisible();
}

async function solveBob(page: Page): Promise<void> {
  await page.locator('#puzzle-bob').click();
  await expect(page.locator('#puzzle-agreement[data-verdict="puzzle-agreement"]')).toBeVisible();
}

test('noble AES agrees with WebCrypto AES-CBC first blocks for random keys', async ({ page }) => {
  await boot(page);
  const comparisons = await page.evaluate(async () => {
    if (!window.__merkleAesEnc) throw new Error('noble AES test seam is unavailable');
    const results: Array<{ noble: string; webcrypto: string }> = [];
    const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    for (let run = 0; run < 8; run += 1) {
      const key = crypto.getRandomValues(new Uint8Array(16));
      const block = crypto.getRandomValues(new Uint8Array(16));
      const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
      const encrypted = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: new Uint8Array(16) },
        imported,
        block,
      ));
      results.push({
        noble: hex(Uint8Array.from(window.__merkleAesEnc(Array.from(key), Array.from(block)))),
        webcrypto: hex(encrypted.slice(0, 16)),
      });
    }
    return results;
  });
  expect(comparisons).toHaveLength(8);
  for (const comparison of comparisons) expect(comparison.noble).toBe(comparison.webcrypto);
});

test('displayed work formulas equal independently recomputed values', async ({ page }) => {
  await boot(page);
  const b = Number(await page.locator('#puzzle-b-number').inputValue());
  const count = Number(await page.locator('#puzzle-l-number').inputValue());
  const keySpace = 2 ** b;
  const expectedAlice = 3 * count;
  const expectedBob = (keySpace + 1) / 2;
  const expectedEve = ((count + 1) / 2) * ((keySpace + 1) / 2);

  expect(numberFrom(await page.locator('#puzzle-alice-predicted').textContent())).toBe(expectedAlice);
  expect(numberFrom(await page.locator('#puzzle-bob-predicted').textContent())).toBe(expectedBob);
  expect(numberFrom(await page.locator('#puzzle-eve-predicted').textContent())).toBe(expectedEve);
  expect(numberFrom(await page.locator('#puzzle-alice-actual').textContent())).toBe(expectedAlice);

  await expect(page.locator('#puzzle-alice-formula')).toHaveText('3L');
  await expect(page.locator('#puzzle-bob-formula')).toHaveText('(|K| + 1) / 2');
  await expect(page.locator('#puzzle-eve-formula')).toHaveText('((L + 1) / 2) × ((|K| + 1) / 2)');
});

test('salted table rejects shared-prefix reuse; BROKEN appears only in textbook mode', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#puzzle-textbook')).not.toBeChecked();
  await expect(page.locator('#puzzle-table-verdict')).toContainText('table matches 0 puzzles');
  await expect(page.locator('#puzzle-table-verdict')).not.toContainText('BROKEN — one table');

  await page.locator('#puzzle-textbook').check();
  await expect(page.locator('#puzzle-retired')).toBeVisible();
  await page.locator('#puzzle-build').click();
  await expect(page.locator('#puzzle-table-verdict')).toContainText('BROKEN — one table');
  const count = Number(await page.locator('#puzzle-l-number').inputValue());
  await expect(page.locator('#puzzle-table-verdict strong')).toContainText(`solved all ${count.toLocaleString('en-US')} puzzles`);

  await page.locator('#puzzle-textbook').uncheck();
  await page.locator('#puzzle-build').click();
  await expect(page.locator('#puzzle-table-verdict')).toContainText('table matches 0 puzzles');
  await expect(page.locator('#puzzle-table-verdict')).not.toContainText('BROKEN — one table');
});

test('Bob agreement is computed from both rendered secrets', async ({ page }) => {
  await boot(page);
  await solveBob(page);
  await expect(page.locator('#puzzle-agreement')).toHaveClass(/puzzle-verdict--safe/);
  const alice = await page.locator('#puzzle-alice-secret').textContent();
  const bob = await page.locator('#puzzle-bob-secret').textContent();
  expect(alice).toMatch(/^[0-9a-f]{32}$/);
  expect(bob).toBe(alice);
  expect(numberFrom(await page.locator('#puzzle-matching-keys').textContent())).toBe(1);
  await expect(page.locator('#puzzle-agreement-headline')).toContainText('AGREED');

  await page.locator('#puzzle-corrupt-bob').click();
  const changedBob = await page.locator('#puzzle-bob-secret').textContent();
  expect(changedBob).not.toBe(alice);
  await expect(page.locator('#puzzle-agreement-headline')).toHaveText('NOT AGREED — the two 128-bit values differ');
});

test('parameter changes retire claims while a no-op preserves them', async ({ page }) => {
  await boot(page);
  await solveBob(page);
  const original = await page.locator('#puzzle-agreement-headline').textContent();

  await page.locator('#puzzle-b-number').fill('10');
  await expect(page.locator('#puzzle-retired')).toBeHidden();
  await expect(page.locator('#puzzle-agreement-headline')).toHaveText(original ?? '');

  await page.locator('#puzzle-b-number').fill('11');
  await expect(page.locator('#puzzle-retired')).toBeVisible();
  await expect(page.locator('#puzzle-agreement')).not.toHaveAttribute('data-verdict');
  await expect(page.locator('#puzzle-bob')).toBeDisabled();
  await expect(page.locator('#puzzle-retired')).toContainText('Previous results retired');
});

test('Eve counter matches its derived prediction and the payload is transcript-only', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
      const value = message as { type?: string; payload?: unknown };
      if (value?.type === 'run') (window as unknown as { __capturedMerklePayload?: unknown }).__capturedMerklePayload = value.payload;
      return original.call(this, message, transferOrOptions as Transferable[]);
    };
  });
  await boot(page);
  await solveBob(page);
  const b = Number(await page.locator('#puzzle-b-number').inputValue());
  const count = Number(await page.locator('#puzzle-l-number').inputValue());
  const keySpace = 2 ** b;
  const predicted = ((count + 1) / 2) * ((keySpace + 1) / 2);
  const variance = ((count + 1) / 2) * ((keySpace ** 2 - 1) / 12)
    + ((count ** 2 - 1) / 12) * ((keySpace + 1) / 2) ** 2;
  const tolerance = 6 * Math.sqrt(variance);

  await page.locator('#puzzle-eve').click();
  await expect(page.locator('#puzzle-eve-verdict[data-verdict="puzzle-eve"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#puzzle-eve-verdict')).toContainText('RECOVERED BY THE EAVESDROPPER');
  const measured = numberFrom(await page.locator('#puzzle-eve-actual').textContent());
  expect(measured).toBeGreaterThan(0);
  expect(Math.abs(measured - predicted)).toBeLessThanOrEqual(tolerance);
  expect(numberFrom(await page.locator('#puzzle-eve-predicted').textContent())).toBe(predicted);

  const payloadShape = await page.evaluate(() => {
    const payload = (window as unknown as { __capturedMerklePayload: {
      transcript: { puzzles: Array<Record<string, unknown>>; targetIndex: number };
      b: number;
      cap: number;
    } }).__capturedMerklePayload;
    return {
      top: Object.keys(payload).sort(),
      transcript: Object.keys(payload.transcript).sort(),
      puzzle: Object.keys(payload.transcript.puzzles[0] ?? {}).sort(),
      identifiableZeroTags: payload.transcript.puzzles.filter((p) =>
        Array.from(p.c2 as Uint8Array).every((byte, i) => byte === (p.c3 as Uint8Array)[i]),
      ).length,
      serialized: JSON.stringify(payload),
    };
  });
  expect(payloadShape.top).toEqual(['b', 'cap', 'transcript']);
  expect(payloadShape.transcript).toEqual(['puzzles', 'targetIndex']);
  expect(payloadShape.puzzle).toEqual(['c1', 'c2', 'c3', 'prefix']);
  expect(payloadShape.identifiableZeroTags, 'no index ciphertext may expose a puzzle by matching its zero check').toBe(0);
  expect(payloadShape.serialized).not.toMatch(/"(?:u|s|bobChoice|puzzlePosition)"\s*:/);
});

test('negative claim remains visible in the all-green recovery fixture', async ({ page }) => {
  await boot(page);
  await solveBob(page);
  await expect(page.locator('#puzzle-matching-keys')).toHaveText('1');
  await expect(page.locator('#puzzle-table-verdict')).toContainText('table matches 0 puzzles');
  await expect(page.locator('#puzzle-table-verdict')).toHaveClass(/puzzle-verdict--safe/);
  await expect(page.locator('#puzzle-agreement')).toHaveClass(/puzzle-verdict--safe/);
  await page.locator('#puzzle-eve').click();
  await expect(page.locator('#puzzle-eve-verdict[data-verdict="puzzle-eve"]')).toContainText('RECOVERED BY THE EAVESDROPPER', { timeout: 120_000 });
  await expect(page.locator('#puzzle-agreement-headline')).toHaveText('AGREED — AND RECOVERED BY THE EAVESDROPPER');
  await expect(page.locator('#puzzle-negative-claim')).toBeVisible();
  await expect(page.locator('#puzzle-negative-claim')).toHaveText(NEGATIVE_CLAIM);
});

test('Bob publishes a nonzero index and reports both follow-up AES decryptions', async ({ page }) => {
  await boot(page);
  await solveBob(page);
  const index = numberFrom(await page.locator('#puzzle-index').textContent());
  const count = Number(await page.locator('#puzzle-l-number').inputValue());
  expect(index).toBeGreaterThanOrEqual(1);
  expect(index).toBeLessThanOrEqual(count);
  await expect(page.locator('#puzzle-bob-auxiliary')).toHaveText('2');
});

test('numeric puzzle counts stay synchronized with the range control', async ({ page }) => {
  await boot(page);
  await page.locator('#puzzle-l-number').fill('333');
  await expect(page.locator('#puzzle-l-range')).toHaveValue('333');
  await expect(page.locator('#puzzle-l-output')).toHaveText('333');
  await page.locator('#puzzle-build').click();
  await expect(page.locator('#puzzle-alice-actual')).toHaveText('999');
});

test('displayed Eve tolerance follows independent search costs for each solved puzzle', async ({ page }) => {
  await boot(page);
  const count = Number(await page.locator('#puzzle-l-number').inputValue());
  const keySpace = 2 ** Number(await page.locator('#puzzle-b-number').inputValue());
  // Sum conditional moments over all possible puzzle counts. The unit oracle
  // separately enumerates the complete distribution for tiny L and |K|.
  let meanCost = 0;
  let varianceCost = 0;
  for (let cost = 1; cost <= keySpace; cost++) meanCost += cost / keySpace;
  for (let cost = 1; cost <= keySpace; cost++) varianceCost += (cost - meanCost) ** 2 / keySpace;
  const mean = meanCost * (count + 1) / 2;
  let variance = 0;
  for (let solved = 1; solved <= count; solved++) {
    variance += (solved * varianceCost + (solved * meanCost - mean) ** 2) / count;
  }
  const toleranceText = await page.locator('#puzzle-eve-tolerance').textContent();
  const displayed = /±([\d,.]+)/.exec(toleranceText ?? '');
  expect(displayed).not.toBeNull();
  expect(numberFrom(displayed![1])).toBeCloseTo(6 * Math.sqrt(variance), 2);
});

test('selecting Bob again retires the previous Eve recovery', async ({ page }) => {
  await boot(page);
  await solveBob(page);
  await page.locator('#puzzle-eve').click();
  await expect(page.locator('#puzzle-eve-verdict[data-verdict]')).toContainText('RECOVERED BY THE EAVESDROPPER', { timeout: 120_000 });
  await solveBob(page);
  await expect(page.locator('#puzzle-eve-verdict')).not.toHaveAttribute('data-verdict');
  await expect(page.locator('#puzzle-eve-verdict')).toContainText('previous result was retired');
  await expect(page.locator('#puzzle-eve-actual')).toHaveText('—');
  await expect(page.locator('#puzzle-agreement-headline')).not.toContainText('RECOVERED');
});

test('late worker progress cannot overwrite a newer Bob selection', async ({ page }) => {
  await page.addInitScript(() => {
    const records: Array<{ onmessage?: (event: { data: unknown }) => void; message?: { runId: number } }> = [];
    class HeldWorker {
      onmessage?: (event: { data: unknown }) => void;
      message?: { runId: number };
      constructor() { records.push(this); }
      postMessage(message: { type: string; runId: number }) { if (message.type === 'run') this.message = message; }
      terminate() { /* Intentionally retain already-queued callbacks. */ }
    }
    window.Worker = HeldWorker as unknown as typeof Worker;
    (window as unknown as { __lateMerkleProgress: () => void }).__lateMerkleProgress = () => {
      const first = records[0]!;
      first.onmessage?.({ data: { type: 'progress', runId: first.message!.runId, progress: { operations: 4096, puzzlesTried: 8 } } });
    };
  });
  await boot(page);
  await solveBob(page);
  await page.locator('#puzzle-eve').click();
  await solveBob(page);
  const currentStatus = await page.locator('#puzzle-status').textContent();
  await page.evaluate(() => (window as unknown as { __lateMerkleProgress: () => void }).__lateMerkleProgress());
  await expect(page.locator('#puzzle-eve-actual')).toHaveText('—');
  await expect(page.locator('#puzzle-eve')).toBeEnabled();
  await expect(page.locator('#puzzle-status')).toHaveText(currentStatus!);
});

for (const action of ['cancel', 'change parameters'] as const) {
  test(`fallback ${action} stops suspended work and preserves the current verdict`, async ({ page }) => {
    await page.addInitScript(() => {
      const realTimeout = window.setTimeout.bind(window);
      let holding = false;
      const pending: Array<() => void> = [];
      class UnavailableWorker {
        constructor() { holding = true; throw new Error('Worker unavailable in this fixture'); }
      }
      window.Worker = UnavailableWorker as unknown as typeof Worker;
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (holding && (delay ?? 0) === 0 && typeof handler === 'function') {
          pending.push(() => handler(...args));
          return -pending.length;
        }
        return realTimeout(handler, delay, ...args);
      }) as typeof window.setTimeout;
      (window as unknown as { __drainMerkleWork: () => Promise<number> }).__drainMerkleWork = async () => {
        let drained = 0;
        while (pending.length) {
          if (++drained > 100) throw new Error('fallback failed to stop within its documented cap');
          pending.shift()!();
          await Promise.resolve();
        }
        await Promise.resolve();
        await Promise.resolve();
        return drained;
      };
    });
    await boot(page);
    await solveBob(page);
    await page.locator('#puzzle-eve').click();
    await expect(page.locator('#puzzle-status')).toContainText('main-thread fallback');
    if (action === 'cancel') await page.locator('#puzzle-cancel').click();
    else await page.locator('#puzzle-b-number').fill('11');
    const verdict = await page.locator('#puzzle-eve-verdict').textContent();
    const currentStatus = await page.locator('#puzzle-status').textContent();
    const drained = await page.evaluate(() => (window as unknown as { __drainMerkleWork: () => Promise<number> }).__drainMerkleWork());
    expect(drained, 'cancelled fallback must stop before starting another AES chunk').toBe(1);
    await expect(page.locator('#puzzle-eve-verdict')).toHaveText(verdict!);
    await expect(page.locator('#puzzle-status')).toHaveText(currentStatus!);
    await expect(page.locator('#puzzle-cancel')).toBeDisabled();
    await expect(page.locator('#puzzle-eve-actual')).toHaveText(action === 'cancel' ? '0' : '—');
  });
}

test('real-scale exponent is recomputed from the displayed expected-half formula', async ({ page }) => {
  await boot(page);
  const scale = 2 ** 30;
  const expected = ((scale + 1) / 2) ** 2;
  expect(Math.floor(Math.log2(expected))).toBe(58);
  const exponents = await page.locator('.puzzle-scale-card h3 sup').allTextContents();
  expect(exponents.map(Number)).toEqual([30, Math.floor(Math.log2(expected))]);
});
