export function hasErrorName(error: unknown, name: string): boolean {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && error.name === name) return true;
  return "cause" in error && error.cause !== error && hasErrorName(error.cause, name);
}
export class ConflictError extends Error {
  constructor() {
    super("This record changed in another tab. Reload before saving.");
    this.name = "ConflictError";
  }
}
