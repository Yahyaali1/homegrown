// Renders demo/art.html's drawings to PNG for the demo site (images the image reader can read).
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: 1 });
await p.goto(new URL('art.html', import.meta.url).href);
for (const id of ['bee', 'headphones']) await p.locator(`#${id}`).screenshot({ path: new URL(`site/${id}.png`, import.meta.url).pathname });
await b.close();
