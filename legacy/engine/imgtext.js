// Image text with positions, for translating text inside images (signs, manga, screenshots).
import { ocrRegions } from '../vision.js';

export const handlers = {
  // { src } -> [{ text, box: [x1, y1, x2, y2] }] in the image's natural pixels.
  async ocrRegions({ src }) {
    let blob;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } catch (e) {
      throw new Error(`Can't read this image (${e.message}).`);
    }
    return (await ocrRegions(blob)).filter((r) => r.text);
  },
};
