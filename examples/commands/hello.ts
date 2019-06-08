import { createCLICommand, validate, logger, runThenExitIfMain, runCommand } from '../../src'

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
