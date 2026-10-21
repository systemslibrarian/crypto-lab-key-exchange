import { eveBruteForce, type EvePayload, type EveResult } from './eve-core.ts';

type RunMessage = { type: 'run'; runId: number; payload: EvePayload };
type CancelMessage = { type: 'cancel'; runId: number };

const cancelled = new Set<number>();
const workerScope = self as unknown as {
	postMessage(message: unknown): void;
	onmessage: ((event: MessageEvent<RunMessage | CancelMessage>) => void) | null;
};

workerScope.onmessage = (event) => {
	const message = event.data;
	if (message.type === 'cancel') {
		cancelled.add(message.runId);
		return;
	}
	const { runId, payload } = message;
	void eveBruteForce(payload, {
		isCancelled: () => cancelled.has(runId),
		onProgress: (progress) => workerScope.postMessage({ type: 'progress', runId, progress }),
	}).then((result: EveResult) => {
		workerScope.postMessage({ type: 'result', runId, result });
		cancelled.delete(runId);
	}).catch((error: unknown) => {
		workerScope.postMessage({
			type: 'error',
			runId,
			message: error instanceof Error ? error.message : String(error),
		});
		cancelled.delete(runId);
	});
};

// [extension] point: add a quantum-eavesdropper cost line using Grover search
// per independent puzzle; see the related crypto-lab-grover lesson.
