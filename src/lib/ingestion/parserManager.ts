import Parser from "web-tree-sitter";
import fs from "fs";
import path from "path";

export type SupportedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "kotlin"
  | "csharp"
  | "cpp"
  | "c"
  | "php";

/** Maps normalized language tags to their tree-sitter-wasms filenames. */
const WASM_FILE_NAME_MAP: Record<string, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
  cpp: "tree-sitter-cpp.wasm",
  c: "tree-sitter-c.wasm",
  php: "tree-sitter-php.wasm",
};

let globalInitPromise: Promise<void> | null = null;

export class TreeSitterParserManager {
  private languageCache: Map<string, Parser.Language> = new Map();
  private languageLoadPromises: Map<string, Promise<Parser.Language>> = new Map();

  private async ensureInitialized(): Promise<void> {
    if (!globalInitPromise) {
      globalInitPromise = Parser.init();
    }
    await globalInitPromise;
  }

  /**
   * Normalizes language tags (e.g. jsx -> tsx).
   */
  public normalizeLanguage(language: SupportedLanguage): string {
    if (language === "jsx") return "tsx";
    return language;
  }

  /**
   * Lazily loads and caches the Parser.Language object for a supported language.
   * Loads each grammar exactly once.
   */
  public async getLanguage(language: SupportedLanguage): Promise<Parser.Language> {
    await this.ensureInitialized();

    const normLang = this.normalizeLanguage(language);

    if (this.languageCache.has(normLang)) {
      return this.languageCache.get(normLang)!;
    }

    if (this.languageLoadPromises.has(normLang)) {
      return this.languageLoadPromises.get(normLang)!;
    }

    const loadPromise = (async () => {
      const wasmFileName = WASM_FILE_NAME_MAP[normLang];
      if (!wasmFileName) {
        throw new Error(`Unsupported tree-sitter language grammar: '${language}'`);
      }

      const wasmPath = path.join(
        process.cwd(),
        "node_modules",
        "tree-sitter-wasms",
        "out",
        wasmFileName,
      );

      if (!fs.existsSync(wasmPath)) {
        throw new Error(
          `WASM grammar file not found for language '${language}' at path: ${wasmPath}`,
        );
      }

      const loadedLang = await Parser.Language.load(wasmPath);
      this.languageCache.set(normLang, loadedLang);
      return loadedLang;
    })();

    this.languageLoadPromises.set(normLang, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.languageLoadPromises.delete(normLang);
    }
  }

  /**
   * Helper that executes a parsing task with an isolated, single-use Parser instance.
   * Guarantees parser cleanup via parser.delete() in a finally block.
   * Never shares Parser instances across concurrent tasks.
   *
   * If setLanguage() fails, the parser is deleted immediately to avoid leaking the instance.
   */
  public async withParser<T>(
    language: SupportedLanguage,
    fn: (parser: Parser) => Promise<T> | T,
  ): Promise<T> {
    const langObj = await this.getLanguage(language);
    const parser = new Parser();

    try {
      parser.setLanguage(langObj);
    } catch (err) {
      // If setting the language fails, release the parser immediately before re-throwing.
      try {
        parser.delete();
      } catch {
        // Ignore deletion errors
      }
      throw err;
    }

    try {
      return await fn(parser);
    } finally {
      try {
        parser.delete();
      } catch {
        // Ignore deletion errors
      }
    }
  }

  /**
   * Backward-compatible helper that creates a fresh Parser instance for a single task.
   * Callers should preferably use withParser() to guarantee parser.delete() cleanup.
   */
  public async getParser(language: SupportedLanguage): Promise<Parser> {
    const langObj = await this.getLanguage(language);
    const parser = new Parser();
    parser.setLanguage(langObj);
    return parser;
  }

  /**
   * Clears language caches on shutdown.
   * Calls language.delete() during disposal if the web-tree-sitter version API supports it.
   */
  public dispose(): void {
    for (const langObj of this.languageCache.values()) {
      try {
        // Some web-tree-sitter versions expose delete() on Language at runtime
        // even though the type definitions don't declare it.
        const obj = langObj as unknown as Record<string, unknown>;
        if (typeof obj.delete === "function") {
          obj.delete();
        }
      } catch {
        // Ignore deletion errors if delete API is unavailable or throws
      }
    }
    this.languageCache.clear();
    this.languageLoadPromises.clear();
  }
}
