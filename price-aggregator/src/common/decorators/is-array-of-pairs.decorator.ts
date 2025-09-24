import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

export function IsArrayOfPairs(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isArrayOfPairs',
      validator: {
        validate: (value: unknown): boolean => {
          if (!Array.isArray(value)) return false;

          return value.every((pair) => {
            if (!Array.isArray(pair)) return false;
            if (pair.length !== 2) return false;

            return pair.every((currency) => {
              if (typeof currency !== 'string') return false;
              if (currency.length < 1 || currency.length > 50) return false;
              return true;
            });
          });
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be an array of pairs, where each pair is an array of two strings (1-50 characters each)`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
