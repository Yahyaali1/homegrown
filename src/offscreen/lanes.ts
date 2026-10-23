// One GPU, one generation at a time. Requests wait in two lanes: 'user' (what someone just asked for) always goes
// before 'background' (missions, gists, page translation, monitors), so a question waits behind at most the one call
// already running, never behind a whole mission.
export type Lane = 'user' | 'background';

interface Waiting { job: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }

export class Lanes {
  readonly #waiting: Record<Lane, Waiting[]> = { user: [], background: [] };
  #running = false;

  schedule<T>(job: () => Promise<T>, lane: Lane = 'user'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#waiting[lane].push({ job, resolve: resolve as (v: unknown) => void, reject });
      void this.#drain();
    });
  }

  get state() {
    return { running: this.#running, user: this.#waiting.user.length, background: this.#waiting.background.length };
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    const next = this.#waiting.user.shift() ?? this.#waiting.background.shift();
    if (!next) return;
    this.#running = true;
    try {
      next.resolve(await next.job());
    } catch (e) {
      next.reject(e);
    } finally {
      this.#running = false;
      void this.#drain();
    }
  }
}
