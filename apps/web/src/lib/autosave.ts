/** Serialises full-record writes and retains the latest draft while a write is in flight. */
export class AutosaveQueue<T> {
  private pending: { value: T; signature: string } | null = null;
  private running = false;
  private failed = false;
  private last: string;
  constructor(
    private version: number,
    initial: T,
    private readonly write: (value: T, version: number) => Promise<number>,
    private readonly changed: (status: "saving" | "saved" | "error", error?: unknown) => void,
  ) {
    this.last = JSON.stringify(initial);
  }
  enqueue(value: T) {
    if (this.failed) return;
    const signature = JSON.stringify(value);
    this.pending = { value, signature };
    void this.drain();
  }
  private async drain() {
    if (this.running || this.failed) return;
    this.running = true;
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        if (next.signature === this.last) continue;
        this.changed("saving");
        this.version = await this.write(next.value, this.version);
        this.last = next.signature;
      }
      this.changed("saved");
    } catch (error) {
      this.failed = true;
      this.changed("error", error);
    } finally {
      this.running = false;
    }
  }
}
