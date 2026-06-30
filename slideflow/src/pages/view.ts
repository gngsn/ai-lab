import { getPorts } from '@composition/index';
import { renderDeck } from '@features/present/present-runtime';
import { QueryParams } from '@ui/constants';

const params = new URLSearchParams(location.search);
const deckId = params.get(QueryParams.deck) ?? '';
const token = params.get(QueryParams.token) ?? '';

void start();

async function start(): Promise<void> {
  const ports = getPorts();
  const deck = await ports.shareRead.getDeck(deckId, token);
  if (!deck) {
    document.body.textContent = 'This share link is invalid or has been revoked.';
    return;
  }
  const slides = await ports.shareRead.getSlides(deckId, token);

  renderDeck(
    { frameHtml: deck.frameHtml, title: deck.title, slides },
    {
      shared: true,
      fallback: params.get('nofallback') !== '1',
    },
  );
}
