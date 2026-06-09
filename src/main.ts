import './style.css';
import './extra.css';
import {
	DEMO_CURVE,
	diffieHellman,
	discreteLogAttack,
	ecdh,
} from './engine.ts';
import { mountApp } from './ui.ts';

// Dev-only self-test. Surfaces engine correctness in the console so the
// deployed build stays quiet but the dev environment shouts on regression.
if (import.meta.env.DEV) {
	console.group('crypto-lab-key-exchange: engine self-test');
	const dh = diffieHellman(23, 5, 6, 15);
	console.log('DH(23, 5, 6, 15) — agree:', dh.agree, '· shared:', dh.sharedFromAlice);
	const recovered = discreteLogAttack(5, dh.A, 23);
	console.log('discrete-log attack recovered a =', recovered, '(real a = 6)');
	const ec = ecdh(DEMO_CURVE, 3, 9);
	console.log('ECDH on demo curve — agree:', ec.agree);
	console.groupEnd();
}

mountApp(document.querySelector<HTMLDivElement>('#app')!);

(function initThemeToggle() {
	const button = document.getElementById('theme-toggle') as HTMLButtonElement | null;
	if (!button) return;

	function apply(theme: string): void {
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('theme', theme);
		const isDark = theme === 'dark';
		button!.textContent = isDark ? '\u{1F319}' : '☀️';
		button!.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
	}

	const current = document.documentElement.getAttribute('data-theme') ?? 'dark';
	apply(current);

	button.addEventListener('click', () => {
		const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
		apply(next);
	});
})();
