# @jitl/cli

Straightforward and type-safe command-line argument parsing with subcommands.

## Example

```typescript
import { createCLICommand, validate, logger, runThenExitIfMain, runCommand } from '@jitl/cli'

export const command = createCLICommand({
  description: `Say hello`,
  flags: {
    name: {
      description: `What name should we greet?`,
      validate: validate.string(),
    },
    exuberant: {
      description: `Are we excited?`,
      validate: validate.boolean(),
      default: () => false,
    },
  },
  async run({ name, exuberant }) {
    logger.log(`Hello, ${name}. Nice to see you today${exuberant ? '!' : '.'}`)
  },
})

runThenExitIfMain(module, (name, argv) => runCommand(name, command, argv))
```

## Motivation

[oclif]: https://github.com/oclif/oclif

1. **Type-safe without stuttering.**
   While existing libraries offer typings via `@types/...` packages, few infer
   the arguments of the `run()` function of a command from the parameters.

   The parameters of the `run(flags, args, rest)` function are completely inferred
   from the runtime type specification, so your CLI command declarations are
   succinct and readable.

1. **Library, not a framework.**
   Existing Typescript frameworks like [oclif][] force a specific setup, and
   contain many layers of abstraction between invocation and your `run()`
   function.
   
   This package offers flexibility through composition, rather than a
   complex "plug-ins" or "hooks" interface.

1. **Usable conventions.**
   Many command-line frameworks follow typical Unix conventions, which are
   suitable for experts, but provide a poor user experience for casual CLI
   users. 

   - Prefer long (GNU-style) named flags like `--bool` | `--value given-value`.
     Removes mental burden of argument order, and makes reading your shell history
     more clear.

     Positional arguments are still available for glob-related use-cases.

   - Prompt users for missing required arguments.
     Don't kick the user and force them to read the help.

1. **Bike-shedding.**
   There are many command-line frameworks out there. It's easy to be
   opinionated about the "mistakes" (choices) a CLI framework makes.

   Because this package is short, has a flat dependency graph, and favors
   composition over hooks/plugins/inheritance, it's easy to replace, wrap,
   extend, smoosh, and make it your own.

## Dependencies

This package only imports its dependencies when they are needed for a specific purpose.

- `chalk`: imported when displaying help output. Used to bold text, which has a nice
  appearance.
  
- `table`: imported when displaying help output. Used to format the table of
  flags, etc.

- `fs-extra`: imported when loading a directory of subcommands. Used to scan a
  directory for subcommand files. For better performance and type-safety, but
  also more boilerplate, consider manually constructing a `CommandLoaders`
  object.

- `inquirer`: imported when a user fails to provide a required argument. Used
  to interactively prompt the user for the needed value.

In short, this package never imports a dependency on the happy path to run a
fully-specified command.

## Documentation

For now, you'll need to read the code.

## Known Deficiencies 

- Design modifications for the `Command` interface to allow nesting subcommands
  easily without custom code.
- The current `validate: Validator<T>` interface is not introspectable at runtime,
  which limits the usefulness and accuracy of help messages for an argument.
  All we can show to guide the user is the default value.
- Tests. Ah, tests.
- Documentation. It should be auto-generated from TSDoc comments in the source.
- Examples for subcommands.
