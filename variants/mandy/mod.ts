// Chamber wrapper for the Mandy clone — copy to the clone's root, beside
// server/ and front/. Nothing else in the clone changes except front/sw.js.
//
// The relative path up to Atrium's tree resolves lexically against this file's
// own URL, and Deno does not follow the chambers/ symlink when it does, so
// ../../core/ is Atrium's core/ whether the clone lives inside the repo or is
// symlinked in from elsewhere.
import type { Chamber } from '../../core/types.ts';
import { router } from './server/src/server.ts';

// Hono's fetch takes two further arguments, both optional, so it satisfies the
// one-argument handler Chamber asks for and needs no adapter.
export default {
  domain: '',
  displayName: 'Mandy',
  fetch: router.fetch,
} satisfies Chamber;
