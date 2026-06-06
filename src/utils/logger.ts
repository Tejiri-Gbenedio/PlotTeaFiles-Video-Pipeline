import chalk from 'chalk';

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const logger = {
  stage(stage: string, message: string) {
    console.log(`${chalk.bold.cyan(`[${stage}]`)} ${message}`);
  },
  info(message: string) {
    console.log(chalk.gray(message));
  },
  success(message: string) {
    console.log(chalk.green(message));
  },
  warn(message: string) {
    console.warn(chalk.yellow(message));
  },
  error(message: string) {
    console.error(chalk.red(message));
  }
};
