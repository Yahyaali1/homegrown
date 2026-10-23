// Tasks: what the in-page toolbar, right-click menu and side panel offer. The live list is chrome.storage.sync
// 'tasks' (seeded from DEFAULT_TASKS), so people edit, delete and add their own. Built to actions.js for pages.
import { parseTasks, type Task } from '../domain/tasks.ts';

export { KINDS, parseTasks, type Task, type TaskKind } from '../domain/tasks.ts';

const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(chrome.i18n.getUILanguage().split('-')[0] ?? 'en') ?? 'English';

export const DEFAULT_TASKS: Task[] = [
  { id: 'summarize', kind: 'text', title: 'Summarize', prompt: 'Summarize the following text in a few key bullet points:' },
  { id: 'explain', kind: 'text', title: 'Explain', prompt: 'Explain the following text in simple terms:' },
  { id: 'translate', kind: 'text', title: `Translate to ${language}`, prompt: `Translate the following text to ${language}. Reply with the translation only:` },
  { id: 'rewrite', kind: 'text', title: 'Rewrite', prompt: 'Rewrite the following text so it is clearer and more concise:' },
  { id: 'page-summary', kind: 'page', title: 'Summarize this page', prompt: 'Summarize this web page in a few key bullet points:' },
  { id: 'page-takeaways', kind: 'page', title: 'Key takeaways', prompt: 'List the three most important takeaways from this web page:' },
  { id: 'describe', kind: 'image', title: 'Describe image', prompt: 'Describe this image.' },
  { id: 'extract', kind: 'image', title: 'Extract text from image', prompt: 'Extract all the text in this image. Reply with the text only.' },
];

export async function getTasks(): Promise<Task[]> {
  return parseTasks((await chrome.storage.sync.get('tasks')).tasks) ?? DEFAULT_TASKS;
}

// Gallery's Prompt Lab templates (ui/llmsingleturn/PromptTemplateConfigs.kt).
export interface PromptTemplate { id: string; title: string; option?: string; options?: string[]; build(input: string, option: string): string }
export const PROMPT_LAB: PromptTemplate[] = [
  { id: 'free', title: 'Free form', build: (input) => input },
  {
    id: 'tone', title: 'Rewrite tone', option: 'Tone',
    options: ['Formal', 'Casual', 'Friendly', 'Polite', 'Enthusiastic', 'Concise'],
    build: (input, o) => `Rewrite the following text using a ${o.toLowerCase()} tone: ${input}`,
  },
  {
    id: 'summary', title: 'Summarize text', option: 'Style',
    options: ['Key bullet points', 'Short paragraph', 'Concise summary', 'Headline / title', 'One-sentence summary'],
    build: (input, o) => `Please summarize the following in ${o.toLowerCase()}: ${input}`,
  },
  {
    id: 'code', title: 'Code snippet', option: 'Language',
    options: ['JavaScript', 'TypeScript', 'Python', 'Kotlin', 'Swift', 'Java', 'C++'],
    build: (input, o) => `Write a ${o} code snippet to ${input}`,
  },
];
