/**
 * Generates a stable string key from method arguments.
 * Falls back to a deterministic string representation if JSON serialization fails.
 */
const defaultKey = (args: unknown[]): string => {
  try {
    return JSON.stringify(args);
  } catch {
    return `args_${args.length}_${args.map((arg, i) => `${i}:${typeof arg}`).join('_')}`;
  }
};

/**
 * SingleFlight decorator for method deduplication.
 * Prevents parallel execution of the same method with the same arguments.
 *
 * @param keyResolver - Optional function to generate cache key from method arguments
 * @returns Method decorator
 */
export function SingleFlight<
  Args extends unknown[],
  Result,
  KArgs extends Args = Args,
>(keyResolver?: (...args: KArgs) => string | number | symbol) {
  return <TThis>(
    target: TThis,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(...args: Args) => Promise<Result>>,
  ): void | TypedPropertyDescriptor<(...args: Args) => Promise<Result>> => {
    const original = descriptor.value;
    const statesSymbol = Symbol(
      `__single_flight_${String(propertyKey)}_states`,
    );

    const wrapped = function (
      this: Record<symbol, unknown>,
      ...args: Args
    ): Promise<Result> {
      let states = this[statesSymbol] as
        | Map<string | number | symbol, Promise<Result>>
        | undefined;

      if (!states) {
        states = new Map<string | number | symbol, Promise<Result>>();
        this[statesSymbol] = states as unknown;
      }

      const key = keyResolver
        ? keyResolver(...(args as KArgs))
        : defaultKey(args as unknown[]);

      if (states.has(key)) {
        return states.get(key)!;
      }

      const promise = Promise.resolve()
        .then(() => original.apply(this, args))
        .finally(() => {
          states!.delete(key);
        });

      states.set(key, promise);
      return promise;
    };

    descriptor.value = wrapped;
  };
}
