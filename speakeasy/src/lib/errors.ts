/** The text of anything that was thrown. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
