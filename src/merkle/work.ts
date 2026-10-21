export function expectedBobTrials(b: number): number {
	return (2 ** b + 1) / 2;
}

export function expectedEveTrials(count: number, b: number): number {
	return ((count + 1) / 2) * expectedBobTrials(b);
}

/**
 * Eve pays an independent U{1..|K|} search cost for each of J puzzles,
 * where J∼U{1..L}. Total variance of that random sum is
 * E[J] Var[cost] + Var[J] E[cost]², rather than the variance of J·cost.
 */
export function eveTrialVariance(count: number, b: number): number {
	const keySpace = 2 ** b;
	const meanCost = expectedBobTrials(b);
	return ((count + 1) / 2) * ((keySpace ** 2 - 1) / 12)
		+ ((count ** 2 - 1) / 12) * meanCost ** 2;
}

/** Six standard errors: derived from the distribution, not a picked percentage. */
export function meanTolerance(count: number, b: number, samples: number): number {
	if (!Number.isInteger(samples) || samples < 1) throw new RangeError('samples must be positive');
	return 6 * Math.sqrt(eveTrialVariance(count, b) / samples);
}
