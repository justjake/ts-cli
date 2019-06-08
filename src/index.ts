/* =============================================================================

	Typesafe command framework around optimist and inquirer.

============================================================================= */

import * as validate from "./validate"

const logger = console

export class CommandLineError extends Error {
  type = "CommandLineError"
  details: unknown

  constructor(message: string, details: unknown) {
    super(message)
    this.details = details
    const parent = Error as any
    if (parent.captureStackTrace) {
      // v8 only, see https://github.com/microsoft/TypeScript/issues/3926
      parent.captureStackTrace(this, CommandLineError)
    } else {
      // Non-v8; eg for ChackraCore
      this.stack = new Error().stack
    }
  }
}

// Re-export these to simplify life for command implementers.
// We will probably also need them if we were to open-source the CLI framework.
// Re-exporting these also indicates that an async `await import(...)` of one of these
// dependencies is a futile attempt at optimization.
export { validate, logger }

export type MinimistArgv = {
	_: (string | number)[]
	[key: string]: unknown
}

interface PromptArgs {
	/**
	 * Inquirer, a node module for asking questions.
	 * @see https://www.npmjs.com/package/inquirer
	 */
	inquirer: typeof import("inquirer")
	/**
	 * An inqirer prompt function.
	 * Usage: `await prompt([question])`
	 */
	prompt: import("inquirer").PromptModule
	/**
	 * A inquirer question automatically constructed by the framework.
	 * This is what the framework would do if you weren't implementing a custom prompt
	 * function.
	 */
	question: import("inquirer").Question
}

/**
 * Describes a command-line option
 */
export interface Flag<T> {
	/**
	 * Shown in help text
	 */
	description: string
	/**
	 * The value matching this flag in optimist's argv must satisfy this validator.
	 */
	validate: validate.Validator<T>
	/**
	 * Create a default value, if one is not given by the user
	 */
	default?: () => T | Promise<T>
	/**
	 * Customize how to prompt the user for a value, if one is not given.
	 */
	prompt?: (args: PromptArgs) => Promise<T>
	/**
	 * Parse user input. Doesn't need to be perfectly typed; because it will be
	 * validated with validate anyways.
	 *
	 * If you can't parse it, either throw an error or return a value that fails
	 * validation
	 */
	parse?: (input: boolean | string | number) => T | Promise<T>
}

/**
 * Describes a positional command-line parameter.
 * For arguments with defaults, use a flag instead.
 */
export interface Arg<T> {
	name: string
	description: string
	/**
	 * The value matching this flag in optimist's argv must satisfy this validator.
	 */
	validate: validate.Validator<T>
	/**
	 * Customize how to prompt the user for a value, if one is not given.
	 */
	prompt?: (args: PromptArgs) => Promise<T>
	/**
	 * Parses user input. Doesn't need to be perfectly typed; because it will be
	 * validated with validate anyways.
	 *
	 * If you can't parse it, either throw an error or return a value that fails
	 * validation
	 */
	parse?: (input: boolean | string | number) => Promise<T>
}

/**
 * If interactive() returns false, don't try to prompt the user in any way.
 */
export function interactive(): boolean {
	return Boolean(process.stderr.isTTY)
}

const inspect = (x: any) => JSON.stringify(x, null, "  ")

export type Flagable = { [key: string]: any }
export type FlagMap<T extends Flagable> = { [K in keyof T]: Flag<T[K]> }
export type ArgArray<T extends any[]> = { [I in keyof T]: Arg<T[I]> }

export type ArgResult<A> = A extends Arg<infer T> ? T : never
export type ArgResults<A> = A extends ArgArray<infer T> ? T : never
export type FlagResults<A> = A extends FlagMap<infer T> ? T : never

export function createArg<T>(arg: Arg<T>): Arg<T> {
	return arg
}

export function createFlagMap<T extends Flagable>(fs: FlagMap<T>): FlagMap<T> {
	return fs
}
export function createArgArray<T extends any[]>(
	argArray: ArgArray<T>
): ArgArray<T> {
	return argArray
}

export async function parseFlag<T>(
	name: string,
	flag: Flag<T>,
	argv: MinimistArgv
): Promise<T> {
	const givenValue = argv[name]

	// Easy case: provided
	if (name in argv) {
		return await tryParseValue(`--${name}`, flag, givenValue)
	}

	if (flag.default) {
		const defaulted = await flag.default()
		if (flag.validate(defaulted)) {
			return defaulted
		} else {
			throw new CommandLineError(
				`--${name}: BUG: the default value was invalid: ${inspect(defaulted)}`,
				defaulted
			)
		}
	}

	return await tryPrompt(`--${name}`, flag)
}

async function tryParseValue<T>(
	name: string,
	flag: Arg<T> | Flag<T>,
	value: any
): Promise<T> {
	let finalValue = value
	if (flag.parse) {
		try {
			finalValue = await flag.parse(value)
		} catch (error) {
			throw new CommandLineError(
				`${name}: cannot parse ${inspect(value)}: ${error.message}`,
				value
			)
		}
	}

	if (!flag.validate(finalValue)) {
		throw new CommandLineError(
			`${name}: invalid value: ${inspect(finalValue)})`,
			finalValue
		)
	}

	return finalValue
}

// Copied from Minimist
function isNumber(x: any) {
	return (
		typeof x === "number" ||
		/^0x[0-9a-f]+$/i.test(x.toString()) ||
		/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(x.toString())
	)
}

// A rough estimate of Minimist's behavior
function defaultParser(value: any) {
	if (isNumber(value)) {
		return Number(value)
	}
	if (value === "true") {
		return true
	}
	if (value === "false") {
		return false
	}
	return value
}

async function tryPrompt<T>(name: string, flag: Arg<T> | Flag<T>): Promise<T> {
	if (!interactive()) {
		throw new CommandLineError(
			`${name}: Required but not given (and cannot prompt in non-iteractive mode)`,
			name
		)
	}

	const inquirer = await import("inquirer")
	const prompt = inquirer.createPromptModule()

	const message = `${name}: ${flag.description}`
	const filter = flag.parse ? flag.parse : defaultParser
	const validate = async (input: string) =>
		flag.validate((await filter(input)) as T)
			? true
			: `${name}: Invalid value ${inspect(input)}, try again.`

	const question = {
		name: "value",
    type: "input",
		message,
		filter,
		validate,
	} as const

	let value: T
	if (flag.prompt) {
		value = await flag.prompt({ inquirer, prompt, question })
	} else {
		value = (await prompt<{ value: T }>([question])).value
	}

	// One more round of validation for good measure,
	// since we might not trust inquirer to do the right thing.
	if (flag.validate(value)) {
		return value
	}

	throw new CommandLineError(
		`${name}: prompting returned invalid value: ${inspect(value)}`,
		value
	)
}

export async function parseArg<T>(
	index: number,
	arg: Arg<T>,
	argv: any[]
): Promise<T> {
	const name = `arg ${index + 1} (${arg.name})`
	const givenValue = argv[index]

	// Easy case: provided
	if (index in argv) {
		return await tryParseValue(name, arg, givenValue)
	}

	// Required, but not provided: prompt
	return await tryPrompt(name, arg)
}

export async function parseFlagMap<T extends Flagable>(
	flagSet: FlagMap<T>,
	argv: MinimistArgv
): Promise<T> {
	const allFlagNames = Object.keys(flagSet) as Array<keyof FlagMap<T>>
	const givenFlagNames = Object.keys(argv).filter(
		name => name !== "_" && name !== "$0"
	)
	const unknownFlags = givenFlagNames.filter(
		name => !allFlagNames.includes(name)
	)

	if (unknownFlags.length > 0) {
		throw new CommandLineError(
			`Unknown flags given: ${unknownFlags
				.map(name => `--${name}`)
				.join(", ")}`,
			unknownFlags
		)
	}

	const nonDefaultableFlagNames = allFlagNames.filter(
		name => !flagSet[name].default
	)

	const defaultableFlagNames = allFlagNames.filter(
		name => flagSet[name].default
	)

	const result = {} as T

	// Defaults. Shouldn't be any errors, but better to get those out of the
	// way before prompting.
	for (const name of defaultableFlagNames) {
		result[name] = await parseFlag(name as string, flagSet[name], argv)
	}

	// Prompt user for ungiven flags
	for (const name of nonDefaultableFlagNames) {
		result[name] = await parseFlag(name as string, flagSet[name], argv)
	}

	return result
}

export async function parseArgsArray<T extends any[]>(
	argsArray: ArgArray<T>,
	argv: MinimistArgv
): Promise<T> {
	const givenArgs = argv._
	if (argsArray.length < argsArray.length) {
		throw new CommandLineError(
			`Expected at most ${argsArray.length} args, but received ${
				givenArgs.length
			}: ${argv._.map(inspect).join(", ")}`,
			givenArgs
		)
	}
	const results: T = [] as any
	for (let i = 0; i < argsArray.length; i++) {
		results[i] = await parseArg(i, argsArray[i], givenArgs)
	}
	return results
}

export async function parseRest<T>(
	restType: Arg<T>,
	givenArgs: any[]
): Promise<T[]> {
	if (givenArgs.length === 0) {
		return givenArgs
	}

	const results: T[] = []
	for (let i = 0; i < givenArgs.length; i++) {
		results.push(
			await tryParseValue(`Rest arg ${i + 1}`, restType, givenArgs[i])
		)
	}

	return results
}

/**
 * A command with optional flags.
 */
export interface FlagsCommand<Flags> {
	description: string
	flags: FlagMap<Flags>
	run: (flags: Flags) => Promise<void>
}

/**
 * A command with positional arguments and optional flags.
 * Use positional arguments when handling cases like multi file input.
 * Otherwise, prefer using flags.
 */
export interface ArgsCommand<Flags extends Flagable, Args extends any[], Rest> {
	description: string
	flags: FlagMap<Flags>
	args: ArgArray<Args>
	rest: Arg<Rest>
	run: (flags: Flags, args: Args, rest: Rest[]) => Promise<void>
}

export type Command<Flags extends Flagable, Args extends any[], Rest> =
	| FlagsCommand<Flags>
	| ArgsCommand<Flags, Args, Rest>

/**
 * Create a command with positional arguments. Prefer to use only flags, unless
 * you're handling variadic arguments, like one-or-more files.
 */
export function createCLICommand<
	Flags extends Flagable,
	Args extends any[],
	Rest
>(args: {
	description: string
	flags: FlagMap<Flags>
	args: ArgArray<Args>
	rest: Arg<Rest>
	run: (flags: Flags, args: Args, rest: Rest[]) => Promise<void>
}): ArgsCommand<Flags, Args, Rest>
/**
 * Create a command with optional flags.
 */
export function createCLICommand<Flags extends Flagable>(args: {
	description: string
	flags: FlagMap<Flags>
	run: (flags: Flags) => Promise<void>
}): FlagsCommand<Flags>
export function createCLICommand(args: any): any {
	return args
}

const leftWidth = 40
async function renderCompactTable(data: string[][]): Promise<string> {
	const { table, getBorderCharacters } = await import("table")
	const [, ...rows] = data

	// Shenanigans required to have multi-line descriptions.
	const finalRows: string[][] = []
	for (const row of rows) {
		const columnLines = row.map(column => column.split("\n").filter(Boolean))
		const maxLineLength = columnLines
			.map(c => c.length)
			.sort((a, b) => b - a)[0]
		for (let line = 0; line < maxLineLength; line++) {
			finalRows.push(columnLines.map(lines => lines[line] || ""))
		}
	}

	return table(
		[/* header.map(heading => chalk.bold(heading)), */ ...finalRows],
		{
			border: getBorderCharacters("void"),
			drawHorizontalLine: () => false,
			columns: {
				0: {
					paddingRight: 3,
					paddingLeft: 2,
					width: leftWidth,
				},
			},
		}
	).trimRight()
}

// Formatting.
function renderOptional(name: string) {
	return `[${name}]`
}

function renderVar(name: string) {
	return `<${name}>`
}

export async function getCommandUsage<Flags extends Flagable, Args extends any[], Rest>(
	name: string,
	command: Command<Flags, Args, Rest>
): Promise<string> {
	const { default: chalk } = await import("chalk")
	const lines = [chalk.bold(`${name}`), "", command.description.trim()]
	const usage = [name]
	const flagNameAndFlag = Object.entries(command.flags as Record<
		string,
		Flag<any>
	>)
	let omittedOptionInUsage = false
	for (const [flagName, flag] of flagNameAndFlag) {
		const optional = Boolean(flag.default || flag.prompt)
		const display = `--${flagName}=${renderVar(flagName)}`
		if (!optional) {
			usage.push(display)
			continue
		}
		if (optional && flagNameAndFlag.length < 5) {
			usage.push(renderOptional(display))
			continue
		}
		omittedOptionInUsage = true
	}
	if (omittedOptionInUsage) {
		usage.push(renderOptional("flags"))
	}

	if ("args" in command) {
		for (const arg of command.args) {
			if (arg.prompt) {
				usage.push(renderOptional(renderVar(arg.name)))
			} else {
				usage.push(renderVar(arg.name))
			}
		}
	}
	if ("rest" in command) {
		usage.push(renderOptional("--"))
		usage.push(renderOptional(`${renderVar(command.rest.name)} ...`))
	}
	lines.push("")
	lines.push("Usage:")
	lines.push("  " + usage.join(" "))

	if ("args" in command || "rest" in command) {
		lines.push("", "Arguments:")
		const rows: Array<Array<string>> = []
		rows.push(["Arg", "Description"].map(x => chalk.bold(x)))
		rows.push(
			...command.args.map((arg, index) => [
				`(${index}) ${arg.name}`,
				arg.description,
			])
		)

		if ("rest" in command) {
			rows.push([`${command.rest.name} ...`, command.rest.description])
		}

		lines.push(await renderCompactTable(rows))
	}

	if (Object.keys(command.flags).length > 0) {
		lines.push("", "Flags:")
		const rows: Array<Array<string>> = []
		rows.push(["Flag", "Description", "Default"].map(x => chalk.bold(x)))

		for (name in command.flags) {
			const flag = command.flags[name]
			rows.push([
				`--${name}`,
				flag.description,
				flag.default ? `${inspect(await flag.default())}` : "Prompts.",
			])
		}
		lines.push(await renderCompactTable(rows))
		lines.push("")
	}

	return lines.join("\n")
}

export function wantsHelp(argv: MinimistArgv): boolean {
	return Boolean(argv.help || argv.h || argv["?"])
}

export async function runCommand<Flags, Args extends any[], Rest>(
	name: string,
	command: Command<Flags, Args, Rest>,
	argv: MinimistArgv
) {
	if (wantsHelp(argv)) {
		logger.log(await getCommandUsage(name, command))
		return
	}

	if ("args" in command && "rest" in command) {
		const args = await parseArgsArray<Args>(command.args, argv)
		const rest = await parseRest(command.rest, argv._.slice(args.length))
		const flags = await parseFlagMap(command.flags, argv)
		await command.run(flags, args, rest)
	} else {
		if (argv._.length > 0) {
			throw new CommandLineError(
				`Expected 0 args, but given ${argv._.length}: ${argv._.map(
					inspect
				).join(", ")}`,
				argv._
			)
		}
		const flags = await parseFlagMap(command.flags, argv)
		await command.run(flags)
	}
}

export type CommandLoaders = {
	[name: string]: () => Promise<Command<Flagable, any[], any>>
}

export async function createCommandLoadersFromDirectory(
	dir: string
): Promise<CommandLoaders> {
	const path = await import("path")
	const fs = await import("fs-extra")
	const files = await fs.readdir(dir)
	const importableFiles = await files.filter(filename =>
		filename.match(/^[a-z].*\.(t|j)sx?$/)
	)
	const result: CommandLoaders = {}
	for (const filename of importableFiles) {
		const name = path.basename(filename, path.extname(filename))
		const fullPath = path.join(dir, filename)
		const loader = async () =>
			(await import(fullPath)).default as Command<any, any, any>
		result[name] = loader
	}
	return result
}

export async function loadCommand(
	commandName: string,
	loaders: CommandLoaders
): Promise<Command<any, any, any>> {
	const loader = loaders[commandName]
	if (!loader) {
		throw new CommandLineError(`Command not found: ${commandName}`, commandName)
	}
	return await loader()
}

export async function loadAllCommands(
	loaders: CommandLoaders
): Promise<Record<string, Command<Flagable, any[], any>>> {
	const result: Record<string, Command<Flagable, any[], any>> = {}
	await Promise.all(
		Object.entries(loaders).map(async ([name, loader]) => {
			result[name] = await loader()
		})
	)
	return result
}

export async function getCommandLoadersUsage(
	name: string,
	commandLoaders: CommandLoaders
): Promise<string> {
	const lines: string[] = []

	const { default: chalk } = await import("chalk")
	lines.push(chalk.bold(name))
	lines.push("")
	lines.push("Usage:")
	lines.push(
		await renderCompactTable([
			["Usage", ""],
			[
				`${name} ${renderVar("command")} ${renderOptional(
					"options"
				)} ${renderOptional("args")}`,
				`Run ${renderVar("command")}`,
			],
			[
				`${name} help ${renderVar("command")}
${name} ${renderVar("command")} --help`,
				`Show help for ${renderVar("command")}`,
			],
		])
	)

	lines.push("")
	lines.push("Commands:")

	const allCommands = await loadAllCommands(commandLoaders)
	const rows: Array<Array<string>> = []
	rows.push(["Command", "Description"])
	for (const [commandName, command] of Object.entries(allCommands)) {
		const firstLine = command.description.trim().split("\n")[0]
		rows.push([commandName, firstLine])
	}
	lines.push(await renderCompactTable(rows))
	return lines.join("\n")
}

/**
 * Try to load subcommands from a directory of commands.
 * If a command is not found, display all commands.
 */
export async function runLoaders(
	name: string,
	commandLoaders: CommandLoaders,
	argv: MinimistArgv
) {
	const [commandName, ...args] = argv._
	const childArgv = {
		...argv,
		_: args,
	}

	if (
		commandName === undefined ||
		commandName === "help" ||
		(wantsHelp(argv) && !commandName)
	) {
		const wantHelpAbout = args[0].toString()

		if (wantHelpAbout) {
			const command = await loadCommand(wantHelpAbout, commandLoaders)
			return await runCommand(`${name} ${wantHelpAbout}`, command, {
				_: [],
				help: true,
			})
		}

		// Ok, either `name help` or just `name`: show all the commands
		const usage = await getCommandLoadersUsage(name, commandLoaders)
		logger.log(usage)
		return
	}

	// Not doing help? Swell! Just run the command
	const command = await loadCommand(commandName.toString(), commandLoaders)
	return await runCommand(`${name} ${commandName}`, command, childArgv)
}

/**
 * Create a flag or arg that prompts to select from a list of
 * possible values.
 */
export function createChoiceFlag<T extends string>(flag: {
	name: string
	description: string
	choices: T[]
}) {
	const { name, description, choices } = flag
	const choicesList = `Choose from:\n${choices.map(x => `  ${x}`).join("\n")}`
	return {
		name,
		description: `${description}\n${choicesList}`,
		validate: validate.oneOf(...choices),
		prompt: async (promptArgs: PromptArgs) => {
			const { prompt } = promptArgs
			const result = await prompt<{ value: T }>([
				{
					type: "list",
					name: "value",
					// Use original description because we don't want to see choicesList twice.
					message: description,
					// Don't need parse or validate because choices are correct by
					// construction.
					choices,
				},
			])
			return result.value
		},
	}
}

/**
 * Shortcut to create a flag that defaults to false
 */
export function createDefaultFalseFlag(
	args: { description: string } & Partial<Flag<boolean>>
): Flag<boolean> {
	return {
		validate: validate.boolean(),
		default: () => false,
		...args,
	}
}

/**
 * If `module` is the NodeJS entrypoint:
 *
 * Wait for `main` to finish, then exit 0.
 * Note that this does not wait for the event loop to drain;
 * it is suited to commands that run to completion.
 *
 * For processes that must outlive `main`, see `startIfMain`.
 */
export async function runThenExitIfMain(
	module: NodeJS.Module,
	main: (name: string, argv: MinimistArgv) => Promise<void>
) {
	await startIfMain(module, async (name, argv) => {
		await main(name, argv)
		setTimeout(() => process.exit(0))
	})
}

/**
 * If `module` is the NodeJS entrypoint:
 * Call `main` and exit if it throws an error.
 */
export async function startIfMain(
	module: NodeJS.Module,
	main: (name: string, argv: MinimistArgv) => Promise<void>
) {
	if (module !== require.main) {
		return
	}

	const filenameParts = module.filename.split("/")
	const name = filenameParts[filenameParts.length - 1] || "(unknown command)"
	const minimist = await import("minimist")
	const argv = minimist(process.argv)
	try {
		await main(name, argv)
	} catch (error) {
		// Hide stacktraces for CommandLineError
		if (error.type === "CommandLineError") {
			logger.error(error.message)
			setTimeout(() => process.exit(2))
			return
		}
		logger.error(error)
		setTimeout(() => process.exit(1))
	}
}

/**
 * Turn parsed flags back into string arguments
 *
 * Note: this is not sound. Just a best guess.
 */
export function unparseFlags<T extends Flagable>(flagMap: FlagMap<T>, flags: T): string[] {
	const results: string[] = []
	for (const key of Object.keys(flagMap)) {
		if (flags[key] === true) {
			results.push(`--${key}`)
			continue
		}

		if (flags[key]) {
			results.push(`--${key}=${JSON.stringify(flags[key])}`)
			continue
		}
	}
	return results
}
