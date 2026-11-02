// Known apps (ADR-17): remote MCP servers the Connect form can be filled in from, and the web hosts that tell which
// app is open. Data only; the person checks the URL against the docs link and confirms. No client ids, no OAuth apps.
import { fuzzy } from './reading.ts';
import { hostOf } from './text.ts';
import { onSites } from './garden/policy.ts';
import type { ConnectorFacts } from './mcp.ts';

export interface App { name: string; url: string; docs: string; hosts: string[] }

const APPS: App[] = [
  { name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', docs: 'https://github.com/github/github-mcp-server', hosts: ['github.com'] },
  { name: 'Linear', url: 'https://mcp.linear.app/mcp', docs: 'https://linear.app/docs/mcp', hosts: ['linear.app'] },
  { name: 'Notion', url: 'https://mcp.notion.com/mcp', docs: 'https://developers.notion.com/docs/mcp', hosts: ['notion.so', 'notion.com'] },
  { name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', docs: 'https://docs.sentry.io/product/sentry-mcp/', hosts: ['sentry.io'] },
  { name: 'HubSpot', url: 'https://mcp.hubspot.com/', docs: 'https://developers.hubspot.com/mcp', hosts: ['app.hubspot.com', 'hubspot.com'] },
  { name: 'Stripe', url: 'https://mcp.stripe.com/', docs: 'https://docs.stripe.com/mcp', hosts: ['dashboard.stripe.com'] },
  { name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp', docs: 'https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/', hosts: ['atlassian.net'] },
  { name: 'Intercom', url: 'https://mcp.intercom.com/mcp', docs: 'https://developers.intercom.com/docs/guides/mcp', hosts: ['app.intercom.com'] },
  { name: 'Hugging Face', url: 'https://huggingface.co/mcp', docs: 'https://huggingface.co/settings/mcp', hosts: ['huggingface.co'] },
  { name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', docs: 'https://developers.cloudflare.com/agents/model-context-protocol/', hosts: ['dash.cloudflare.com'] },
];

/** "connect <name>" in chat: the best known app for the name, or null. */
export function appNamed(q: string, apps: App[] = APPS): App | null {
  const scored = apps.map((a) => ({ a, m: fuzzy(a.name, q.trim()) })).filter((x) => x.m && q.trim());
  return scored.sort((x, y) => y.m!.score - x.m!.score)[0]?.a ?? null;
}

/**
 * Which app the tab shows: a connected one by its hosts, then a known one, then the page's own name (its
 * `og:site_name` or `application-name`, page text: shown, never used). null: none.
 */
export function appOpen(url: string, meta: string, connectors: ConnectorFacts[], apps: App[] = APPS): { name: string; connector?: string; app?: App } | null {
  const host = hostOf(url);
  if (!host) return null;
  const c = connectors.find((x) => onSites(host, x.hosts));
  if (c) return { name: c.name, connector: c.id };
  const a = apps.find((x) => onSites(host, x.hosts));
  if (a) return { name: a.name, app: a };
  const name = meta.replace(/\s+/g, ' ').trim().slice(0, 40);
  return name ? { name } : null;
}
