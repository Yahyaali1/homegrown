// Chrome web APIs that TypeScript's DOM types don't include yet.
interface FileSystemFileHandle {
  /** Renames the file in place (Chrome 110+; used to finish a download atomically). */
  move(newName: string): Promise<void>;
}

// Chrome's built-in AI translation (Chrome 138+). Only what Homegrown uses.
interface TranslatorInstance { translate(text: string): Promise<string> }
interface CreateMonitor { addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void }
declare const Translator: {
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: CreateMonitor) => void }): Promise<TranslatorInstance>;
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
};
declare const LanguageDetector: { create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }> };
