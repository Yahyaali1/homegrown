// Martin's workflow cases (see rosa.mjs). Seeds with no case here (content-brief, seo-drop: signed-in analytics) can't
// earn their ability on this bench, so they stay off.
import { SHOP } from '../garden-fixtures.mjs';

export default {
  listening: [
    { request: `Group what people say in the reviews on ${SHOP}/reviews into themes, quoting one review per theme with the link.`, expect: ['handle', 'delivery', `${SHOP}/reviews`] },
  ],
  repurpose: [
    { request: `Turn the post at ${SHOP}/blog/moss-care into a LinkedIn post, a post for X and a newsletter section.`, expect: ['march', 'damp'] },
  ],
};
