<svelte:head>
	<title>OpenSesma — let visitors in without calling the gate</title>
</svelte:head>

<main>
	<section class="hero">
		<div class="wrap">
			<p class="brand">OpenSesma</p>
			<h1>Your visitor gets a code. The guard checks it. Nobody calls anybody.</h1>
			<p class="lede">
				Gate passes for Nigerian estates. Send a code on WhatsApp in two taps; the guard verifies it in seconds, even when the gatehouse has no light or data.
			</p>
			<div class="pass" aria-label="Example gate pass">
				<span class="pass-label">Gate code for 14 Adeyemi Street</span>
				<span class="plate big">4821 9163</span>
				<span class="pass-meta">Chidi Okafor · today until 10 pm · one entry</span>
			</div>
			<div class="cta">
				<a class="btn primary" href="/login">Sign in with your phone</a>
				<a class="btn ghost light" href="/gate">Open the guard console</a>
			</div>
		</div>
	</section>

	<section class="wrap how">
		<h2>How a visit works</h2>
		<ol>
			<li><strong>You invite.</strong> Pick a pass type — guest, delivery, staff, artisan or party — and share it on WhatsApp or SMS.</li>
			<li><strong>They show the code.</strong> A QR on a smartphone or six digits read aloud from any phone.</li>
			<li><strong>The guard taps check-in.</strong> You get notified when they arrive and when they leave.</li>
		</ol>
		<p class="muted">
			Unexpected visitor? The guard sends you a request and you tap “Let in” — no call needed. Estate managers see a full gate log instead of a paper book.
		</p>
		<p class="small muted">Got an invite link? Open it on your phone to join your household.</p>
	</section>
</main>

<style>
	.hero {
		background: var(--gate);
		color: var(--gate-ink);
		padding: 40px 0 48px;
	}
	.brand {
		font-weight: 800;
		letter-spacing: 0.02em;
		margin-bottom: 28px;
		font-size: 1.125rem;
	}
	h1 {
		font-size: clamp(1.75rem, 6vw, 2.5rem);
		max-width: 18ch;
		letter-spacing: -0.02em;
	}
	.lede {
		max-width: 46ch;
		opacity: 0.88;
		font-size: 1.0625rem;
	}
	.pass {
		margin: 28px 0;
		display: grid;
		gap: 8px;
		justify-items: start;
		background: color-mix(in srgb, #000 22%, var(--gate));
		border-radius: var(--r-lg);
		padding: 18px;
		max-width: 360px;
	}
	.pass-label,
	.pass-meta {
		font-size: 0.875rem;
		opacity: 0.85;
	}
	.plate.big {
		font-size: 2.6rem;
		padding: 4px 16px;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.cta .primary {
		background: var(--plate);
		color: var(--plate-ink);
		border-color: var(--plate);
	}
	.light {
		color: var(--gate-ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.how {
		padding-top: 32px;
		padding-bottom: 48px;
	}
	ol {
		padding-left: 1.2em;
		margin: 0 0 16px;
	}
	li {
		margin-bottom: 10px;
		max-width: 60ch;
	}
</style>
