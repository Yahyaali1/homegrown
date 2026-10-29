// The in-page UI, built to content.js: the core first, then each feature in the order the toolbar lists them
// (ADR-13). Nothing installs when a live copy already runs in this frame.
import { start } from './core.ts';
import * as writing from './features/writing.ts';
import * as ghost from './features/ghost.ts';
import * as replies from './features/replies.ts';
import * as jargon from './features/jargon.ts';
import * as forms from './features/forms.ts';
import * as youtube from './features/youtube.ts';
import * as reading from './features/reading.ts';
import * as translate from './features/translate.ts';
import * as scrollscrape from './features/scrollscrape.ts';
import * as images from './features/images.ts';
import * as search from './features/search.ts';
import * as links from './features/links.ts';
import * as tabs from './features/tabs.ts';
import * as memory from './features/memory.ts';
import * as voice from './features/voice.ts';
import * as livecaptions from './features/livecaptions.ts';
import * as missions from './features/missions.ts';
import * as palette from './features/palette.ts';

const FEATURES: { install(): void }[] = [writing, ghost, replies, jargon, forms, youtube, reading, translate, scrollscrape, images, search, links, tabs, memory, voice, livecaptions, missions, palette];

if (start()) {
  for (const f of FEATURES) {
    try {
      f.install();
    } catch (e) {
      console.warn('Homegrown: a page feature failed to start', e); // one broken feature must not take down the rest
    }
  }
}
