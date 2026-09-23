import { Medal } from 'lucide-react';
export default function NotFound() {
  return (
    <main>
      <section className="empty-state" style={{ minHeight: '80vh' }}>
        <Medal size={45} />
        <h1>This shelf isn’t on display.</h1>
        <p>It may be private, or the address may have changed.</p>
        <a href="/" className="button primary">
          Back to Medal Shelf
        </a>
      </section>
    </main>
  );
}
