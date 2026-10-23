// Chrome web APIs that TypeScript's DOM types don't include yet.
interface FileSystemFileHandle {
  /** Renames the file in place (Chrome 110+; used to finish a download atomically). */
  move(newName: string): Promise<void>;
}
