// Martin's workflow cases (see rosa.mjs). Signed-in analytics and Search Console are fixture pages standing in for the
// logged-in reads on his sites.
import { SHOP } from '../garden-fixtures.mjs';

export default {
  listening: [
    { request: `Group what people say in the reviews on ${SHOP}/reviews into themes, quoting one review per theme with the link.`, expect: ['handle', 'delivery', `${SHOP}/reviews`] },
    { request: `Group what people say on ${SHOP}/forum into themes, quoting one post per theme with the link.`, expect: ['rust', '11.25', `${SHOP}/forum`] },
  ],
  repurpose: [
    { request: `Turn the post at ${SHOP}/blog/moss-care into a LinkedIn post, a post for X and a newsletter section.`, expect: ['march', 'damp'] },
    { request: `Turn the post at ${SHOP}/blog/ferns into a LinkedIn post, a post for X and a newsletter section.`, expect: ['shade', 'twice'] },
  ],
  'seo-drop': [
    { request: `Why did my search traffic drop? Read ${SHOP}/search-console.`, expect: ['moss-care', '1200', '300', 'snippet'] },
    { request: `Which queries lost clicks and why? Read ${SHOP}/search-console/queries.`, expect: ['trowel price', '500', '120', 'redirect'] },
  ],
  'content-brief': [
    { request: `Read my analytics at ${SHOP}/analytics, then my two best posts ${SHOP}/blog/moss-care and ${SHOP}/blog/ferns, and write a content brief with three ideas.`, expect: ['moss', 'fern', '5,400'] },
    { request: `Read my August analytics at ${SHOP}/analytics/august, then ${SHOP}/blog/ferns and ${SHOP}/blog/moss-care, and write a content brief with three ideas.`, expect: ['fern', 'moss', '2,800'] },
  ],
};
