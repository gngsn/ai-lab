import { getPorts } from '@composition/index';
import { renderDeck } from '@features/present/present-runtime';
import { QueryParams } from '@ui/constants';

const params = new URLSearchParams(location.search);
const deckId = params.get(QueryParams.deck) ?? '';

void start();

async function start(): Promise<void> {
  const ports = getPorts();
  await ports.auth.requireLogin({ redirectTo: location.href });

  const deck = await ports.deckStore.get(deckId);
  if (!deck) {
    document.body.textContent = 'Deck not found or access denied.';
    return;
  }
  const slides = await ports.slideStore.listByDeck(deckId);

  renderDeck(
    { frameHtml: deck.frameHtml, title: deck.title, slides },
    {
      print: params.get(QueryParams.print) === '1',
      fallback: params.get('nofallback') !== '1',
      startSection: params.get(QueryParams.section) ?? params.get(QueryParams.slide),
      syncRoom: params.get(QueryParams.sync),
      realtime: ports.realtime,
    },
  );
}
