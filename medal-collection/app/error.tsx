'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <section className="empty-state" style={{ minHeight: '80vh' }}>
        <h1>A small stumble.</h1>
        <p>We couldn’t open this page. Please try again.</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
        <a href="/" className="button secondary">
          Back to Medal Shelf
        </a>
      </section>
    </main>
  );
}
