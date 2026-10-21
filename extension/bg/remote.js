// Stub: optional OpenAI-compatible / Ollama endpoint, off by default. background.js calls
// enabled(), modelName() and generate(id, turns, onToken) -> { text, stats, userText }.
export const handlers = {};
export async function enabled() {
  return false;
}
