import { bootOwnerPage, renderOwnerPlaceholder } from './boot';

void bootOwnerPage().then((ctx) => renderOwnerPlaceholder('Edit', ctx));
