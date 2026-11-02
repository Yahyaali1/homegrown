// Every setting in one place (docs/architecture.md): its type, its default, and for switches a label. Stored
// values (chrome.storage.sync) are merged over the defaults; a value of the wrong type falls back to the default
// instead of breaking a feature. Tasks have their own module (shared/actions.ts).
import { MODELS, TASKS, type TaskId } from './model.ts';
import { DEPTH_MODELS, IMAGE_MODELS, type DepthModel, type ImageModel } from './imagegen.ts';

export type Theme = 'system' | 'light' | 'dark';

/** On/off features, as Settings lists them. */
export const SWITCHES = {
  toolbar: { label: 'Toolbar on selected text', default: true },
  fab: { label: 'The ❀ button on pages', default: true },
  ghostText: { label: 'Suggest the rest of a sentence as you type', default: false },
  gistMargins: { label: 'Gist margins on long articles', default: false },
  autoAltText: { label: 'Describe images that have no alt text', default: false },
  searchAnswers: { label: 'Answer above search results', default: true },
  linkPreview: { label: 'Preview a link before opening it', default: true },
  useVoice: { label: 'Voice input and read-aloud', default: true },
  replyButtons: { label: 'Reply suggestions in mail and chat', default: true },
  priceChip: { label: 'Price memory on product pages', default: true },
  shoppingSense: { label: 'Look for the same product cheaper elsewhere', default: false },
  linksInActiveTab: { label: 'Open answer links in the active tab when it is on the same site', default: true },
  meetingOffer: { label: 'Offer to record calls on Meet, Zoom and Teams', default: true },
  plaza: { label: 'Companion Plaza on new tabs (replaces any other new-tab page)', default: false },
  plazaHistory: { label: 'Let Plaza talk about pages you visited', default: false },
} as const satisfies Record<string, { label: string; default: boolean }>;
export type SwitchKey = keyof typeof SWITCHES;

export type Settings = { [K in SwitchKey]: boolean } & {
  theme: Theme;
  /** Language for translations; '' means the browser's. */
  translateTo: string;
  /** Language for live captions; '' means translateTo. */
  captionLang: string;
  voiceLang: string;
  /** Stop recording after a pause in speech. */
  voiceAutoStop: boolean;
  voiceSilenceMs: number;
  voiceAutoSend: boolean;
  speechVoice: string;
  speechRate: number;
  /** Hostnames where the in-page UI stays off. */
  disabledSites: string[];
  /** Values for {name} placeholders in task prompts. */
  taskVars: Record<string, string>;
  /** The model chosen per task; '' or missing means whichever is loaded. */
  taskModels: Partial<Record<TaskId, string>>;
  /** The model for Create image. */
  imageModel: ImageModel;
  /** The depth model for Animate image (living photos). */
  depthModel: DepthModel;
};

export const DEFAULTS: Settings = {
  ...(Object.fromEntries(Object.entries(SWITCHES).map(([k, v]) => [k, v.default])) as { [K in SwitchKey]: boolean }),
  theme: 'system',
  translateTo: '',
  captionLang: '',
  voiceLang: '',
  voiceAutoStop: true,
  voiceSilenceMs: 1500,
  voiceAutoSend: false,
  speechVoice: '',
  speechRate: 1,
  disabledSites: [],
  taskVars: {},
  taskModels: {},
  imageModel: 'janus',
  depthModel: 'small',
};

const stringMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};

/** Stored values over the defaults, each checked against its default's type. */
export function parseSettings(raw: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = raw[key];
    if (v === undefined) continue;
    if (key === 'theme') out[key] = v === 'light' || v === 'dark' || v === 'system' ? v : def;
    else if (key === 'disabledSites') out[key] = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : def;
    else if (key === 'taskVars') out[key] = stringMap(v);
    else if (key === 'taskModels') out[key] = Object.fromEntries(Object.entries(stringMap(v)).filter(([t]) => t in TASKS));
    else if (key === 'imageModel') out[key] = typeof v === 'string' && v in IMAGE_MODELS ? v : def;
    else if (key === 'depthModel') out[key] = typeof v === 'string' && v in DEPTH_MODELS ? v : def;
    else if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[key] = v;
  }
  return out as Settings;
}

// ---- changing a setting by asking in Chat: the model proposes, code checks, the person confirms ----

export interface SettingChoice { id: string; label: string; values: string[] | null; current: string }

/** Everything Chat may change, with the values each accepts (null = any language name). */
export function chatSettings(s: Settings, downloadedModels: string[]): SettingChoice[] {
  return [
    { id: 'theme', label: 'Theme', values: ['system', 'light', 'dark'], current: s.theme },
    { id: 'translateTo', label: 'Translate into', values: null, current: s.translateTo },
    ...Object.entries(TASKS).map(([task, label]) => ({ id: `model.${task}`, label: `Model for ${label.toLowerCase()}`, values: ['automatic', ...downloadedModels], current: s.taskModels[task as TaskId] || 'automatic' })),
    { id: 'imageModel', label: 'Model for creating images', values: Object.keys(IMAGE_MODELS), current: s.imageModel },
    { id: 'depthModel', label: 'Model for animating images', values: Object.keys(DEPTH_MODELS), current: s.depthModel },
    ...Object.entries(SWITCHES).map(([key, sw]) => ({ id: key, label: sw.label, values: ['on', 'off'], current: s[key as SwitchKey] ? 'on' : 'off' })),
  ];
}

/** The model's pick, accepted only when it names a real setting and an allowed value. */
export function checkChoice(choices: SettingChoice[], pick: unknown): { choice: SettingChoice; value: string } | null {
  if (!pick || typeof pick !== 'object') return null;
  const { setting, value } = pick as { setting?: unknown; value?: unknown };
  const choice = choices.find((c) => c.id === setting);
  if (!choice) return null;
  const v = choice.values ? choice.values.find((x) => x.toLowerCase() === String(value).toLowerCase()) : String(value ?? '').trim();
  return v ? { choice, value: v } : null;
}

/** The storage change that applies a checked choice. */
export function changeFor(s: Settings, id: string, value: string): Record<string, unknown> {
  if (id.startsWith('model.')) return { taskModels: { ...s.taskModels, [id.slice(6)]: value === 'automatic' ? '' : value } };
  if (id in SWITCHES) return { [id]: value === 'on' };
  return { [id]: value };
}

/** Words a settings request uses: only such a message is worth asking the model about. */
export const mayBeSetting = (text: string): boolean => /\b(set|change|switch|use|turn|enable|disable|theme|dark|light|translate|model)\b/i.test(text);

/** The routing instruction: the model maps a message to one setting and an allowed value, or to none. */
export function settingPrompt(choices: SettingChoice[], text: string): string {
  const list = choices.map((c) => `- ${c.id}: ${c.label} (${c.values ? c.values.join(', ') : 'any language'}; now ${c.current || 'not set'})`).join('\n');
  const models = MODELS.map((m) => `${m.id}: ${m.note}`).join(' ');
  return `You route messages for the Homegrown browser extension. If the message asks to change one of these settings, reply {"setting": "<id>", "value": "<one allowed value>"}. If it is anything else (a question, a request, chat), reply {"setting": null}. JSON only.\nSettings:\n${list}\nModels: ${models}\nMessage: "${text}"`;
}
