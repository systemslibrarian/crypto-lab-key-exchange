export function expectedBobTrials(b: number): number {
	return (2 ** b + 1) / 2;
}

export function expectedEveTrials(count: number, b: number): number {
	return ((count + 1) / 2) * expectedBobTrials(b);
}

function uniformSecondMoment(size: number): number {
	return ((size + 1) * (2 * size + 1)) / 6;
}

/** Variance of X·Y for independent X∼U{1..L}, Y∼U{1..|K|}. */
export function eveTrialVariance(count: number, b: number): number {
	const keySpace = 2 ** b;
	const mean = expectedEveTrials(count, b);
	return uniformSecondMoment(count) * uniformSecondMoment(keySpace) - mean ** 2;
}

/** Six standard errors: derived from the distribution, not a picked percentage. */
export function meanTolerance(count: number, b: number, samples: number): number {
	if (!Number.isInteger(samples) || samples < 1) throw new RangeError('samples must be positive');
	return 6 * Math.sqrt(eveTrialVariance(count, b) / samples);
}
