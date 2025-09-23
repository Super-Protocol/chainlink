import { SingleFlight } from './single-flight.decorator';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

class TestService {
  public calls: number = 0;

  @SingleFlight()
  async work(key: string, delayMs = 50): Promise<string> {
    this.calls += 1;
    await sleep(delayMs);
    return `done:${key}`;
  }

  @SingleFlight((n: number) => `k:${n % 2}`)
  async customKey(n: number, delayMs = 50): Promise<string> {
    this.calls += 1;
    await sleep(delayMs);
    return `v:${n}`;
  }
}

describe('SingleFlight decorator', () => {
  test('deduplicates concurrent calls with identical args', async () => {
    const svc = new TestService();

    const p1 = svc.work('A', 80);
    const p2 = svc.work('A', 80); // overlapping, same key
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('done:A');
    expect(r2).toBe('done:A');
    expect(svc.calls).toBe(1);
  });

  test('does not deduplicate different args', async () => {
    const svc = new TestService();

    const p1 = svc.work('A', 60);
    const p2 = svc.work('B', 60);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('done:A');
    expect(r2).toBe('done:B');
    expect(svc.calls).toBe(2);
  });

  test('second call after first completes triggers a new execution', async () => {
    const svc = new TestService();

    const r1 = await svc.work('A', 30);
    const r2 = await svc.work('A', 30);

    expect(r1).toBe('done:A');
    expect(r2).toBe('done:A');
    expect(svc.calls).toBe(2);
  });

  test('custom key resolver groups by provided key', async () => {
    const svc = new TestService();

    const p1 = svc.customKey(1, 70); // key k:1
    const p2 = svc.customKey(3, 70); // key k:1 -> dedupe
    const p3 = svc.customKey(2, 70); // key k:0 -> separate

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toMatch(/^v:/);
    expect(r2).toMatch(/^v:/);
    expect(r3).toMatch(/^v:/);
    expect(svc.calls).toBe(2);
  });

  test('promises are cleared from the map after completion (no memory leak)', async () => {
    const svc = new TestService();

    for (let i = 0; i < 3; i++) {
      const [a, b, c] = await Promise.all([
        svc.work('X', 20),
        svc.work('X', 20),
        svc.work('X', 20),
      ]);
      expect(a).toBe('done:X');
      expect(b).toBe('done:X');
      expect(c).toBe('done:X');
    }

    expect(svc.calls).toBe(3);
  });
});
