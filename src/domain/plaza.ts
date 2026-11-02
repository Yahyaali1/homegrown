// Companion Plaza: one line a day per gardener, from its own notes and recent run answers only;
// the person's history titles join only with the `plazaHistory` setting on. Data-only prompt; the reply is shown as text.
import { defang } from './text.ts';

export const PLAZA_PROMPT = 'Write one short, calm line (at most 20 words) that this companion could say to the person today, based only on the data. Plain text, no quotes, no greeting, no exclamation marks.';

export function plazaThink(name: string, o: { notes: string[]; answers: string[]; history: string[] | null }): { prompt: string; data: string } {
  const part = (title: string, xs: string[], cap: number) => (xs.length ? [`${title}:`, ...xs.slice(0, cap).map((x) => `- ${defang(x).replace(/\s+/g, ' ').slice(0, 300)}`)] : []);
  const data = [
    `Companion: ${defang(name)}`,
    ...part('Its notes', o.notes, 10),
    ...part('Its recent answers', o.answers, 3),
    ...(o.history ? part('Pages the person visited', o.history, 20) : []),
  ].join('\n');
  return { prompt: PLAZA_PROMPT, data };
}

/** The model's reply as one line of text, or '' when nothing usable came back. */
export const plazaLine = (text: string): string => (text.split('\n').map((l) => l.trim().replace(/^["“']|["”']$/g, '')).find(Boolean) ?? '').slice(0, 160);

/** Today's key for the once-a-day lines, in the person's local time. */
export const plazaDay = (now: Date): string => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
