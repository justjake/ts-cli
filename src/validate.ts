/* =============================================================================

	Extremely basic validation system.
  For more complex use-cases, consider wrapping a runtime typing library like
  io-ts (https://github.com/gcanti/io-ts) or
  Structural (https://github.com/reissbaker/structural)

============================================================================= */

export type Validator<T> = (value: T) => boolean

export const string = (): Validator<string> => (value: string) => typeof value === 'string'
export const number = (): Validator<number> => (value: number) => typeof value === 'number'
export const boolean = (): Validator<boolean> => (value: boolean) => typeof value === 'boolean'

export function oneOf<T>(...options: Array<T>): Validator<T> {
	return function(value: T) {
		return options.some(option => value === option)
	}
}

export function optional<T>(fn: Validator<T & {}>): Validator<T | undefined> {
	return function(value: T | undefined) {
		if (value === undefined) {
			return true
		} else {
			return fn(value)
		}
	}
}
