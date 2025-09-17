import {
  TLiteral,
  TNumber,
  TString,
  TTransform,
  TUnion,
  Type,
} from '@sinclair/typebox';

export const booleanFromString = (
  defaultValue = 'false',
  options?: { description?: string },
): TTransform<TString, boolean> =>
  Type.Transform(
    Type.String({
      default: defaultValue,
      ...(options?.description && { description: options.description }),
    }),
  )
    .Decode((val) => val === 'true' || val === '1' || val === 'yes')
    .Encode((val) => (val ? 'true' : 'false'));

export const numberFromString = (
  defaultValue: number,
  options?: { description?: string },
): TTransform<TUnion<[TString, TNumber]>, number> =>
  Type.Transform(
    Type.Union([Type.String(), Type.Number()], {
      default: defaultValue,
      ...(options?.description && { description: options.description }),
    }),
  )
    .Decode((value) => {
      if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          throw new Error(`Invalid number value: ${value}`);
        }
        return parsed;
      }
      return value;
    })
    .Encode((value) => value);

export const variantsSchema = <T extends readonly string[]>(
  values: T,
  options?: {
    default?: T[number];
    description?: string;
    examples?: string[];
  },
): TUnion<TLiteral<T[number]>[]> =>
  Type.Union(
    values.map((value) => Type.Literal(value)),
    {
      ...(options?.default && { default: options.default }),
      ...(options?.description && { description: options.description }),
      ...(options?.examples && { examples: options.examples }),
    },
  );

export const portFromString = (
  defaultValue = 3000,
  options?: { description?: string },
): TTransform<TUnion<[TString, TNumber]>, number> =>
  Type.Transform(
    Type.Union([Type.String(), Type.Number()], {
      default: defaultValue,
      ...(options?.description && { description: options.description }),
    }),
  )
    .Decode((v) => {
      const n = typeof v === 'string' ? Number(v.trim()) : v;
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port: ${v}`);
      }
      return n;
    })
    .Encode((n) => n);

export const positiveNumberFromString = (
  defaultValue: number,
  options?: { description?: string },
): TTransform<TUnion<[TString, TNumber]>, number> =>
  Type.Transform(
    Type.Union([Type.String(), Type.Number()], {
      default: defaultValue,
      ...(options?.description && { description: options.description }),
    }),
  )
    .Decode((value) => {
      const n = typeof value === 'string' ? Number(value.trim()) : value;
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Invalid positive number: ${value}`);
      }
      return n;
    })
    .Encode((value) => value);
