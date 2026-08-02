import fs from "fs";
import path from "path";
import ignore, { Ignore } from "ignore";

export type SupportedSourceLanguage =
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

export type ProjectDocumentLanguage =
  | "markdown"
  | "json"
  | "yaml"
  | "toml"
  | "dockerfile"
  | "text"
  | "config";

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
  category: "source" | "project";
  language: SupportedSourceLanguage | ProjectDocumentLanguage;
}

export interface DiscoverOptions {
  extraIgnorePatterns?: string[];
}

const SOURCE_LANGUAGES = new Set<string>([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "csharp",
  "cpp",
  "c",
  "php",
]);

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "venv",
  ".venv",
  "env",
  ".env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".docusaurus",
  "dist",
  "build",
  "out",
  ".vscode",
  ".idea",
  ".vs",
  "coverage",
  ".output",
  ".vercel",
  "target",
  "bin",
  "obj",
]);

const IGNORED_EXTENSIONS = new Set([
  // Source maps
  ".map",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".webp",
  ".bmp",
  ".tiff",
  ".psd",
  // Archives
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".bz2",
  ".tgz",
  // Binaries & Executables
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pyc",
  ".pyo",
  ".pyd",
  ".class",
  ".o",
  ".obj",
  // Media & Documents
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "cargo.lock",
  "pipfile.lock",
  "AGENTS.md",
]);

/**
 * Returns the language tag for a file path, or null if the file should be skipped.
 */
export function getLanguageForFile(relativePath: string): DiscoveredFile["language"] | null {
  const normPath = relativePath.replace(/\\/g, "/");
  const filename = path.basename(normPath);
  const ext = path.extname(normPath).toLowerCase();

  // Source files
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".jsx") return "jsx";
  if (ext === ".py") return "python";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  if (ext === ".java") return "java";
  if (ext === ".kt" || ext === ".kts") return "kotlin";
  if (ext === ".cs") return "csharp";
  if (ext === ".cpp" || ext === ".hpp" || ext === ".cc" || ext === ".cxx") return "cpp";
  if (ext === ".c" || ext === ".h") return "c";
  if (ext === ".php") return "php";

  // Always-ingest project / config files
  if (
    filename === "README.md" ||
    filename === "CONTRIBUTING.md" ||
    filename === "SECURITY.md" ||
    filename === "CODE_OF_CONDUCT.md"
  ) {
    return "markdown";
  }
  if (filename === "LICENSE" || filename === "LICENSE.md" || filename === "LICENSE.txt") {
    return "text";
  }
  if (filename === "package.json" || filename === "tsconfig.json") return "json";
  if (filename === "pyproject.toml") return "toml";
  if (filename === "requirements.txt") return "text";
  if (
    filename === "Dockerfile" ||
    filename === "docker-compose.yml" ||
    filename === "docker-compose.yaml" ||
    filename === "compose.yaml" ||
    filename === "docker-compose.override.yml"
  ) {
    return "dockerfile";
  }
  if (filename === "Makefile" || filename === ".editorconfig") return "config";
  if (normPath.startsWith(".github/workflows/") && (ext === ".yml" || ext === ".yaml"))
    return "yaml";

  return null;
}

/**
 * Returns true for project/config files (non-source language tag).
 */
export function isProjectFile(language: DiscoveredFile["language"]): boolean {
  return !SOURCE_LANGUAGES.has(language);
}

/**
 * Recursively discover files in workspace deterministically (sorted paths).
 * Reads .gitignore and accepts additional custom ignore patterns.
 */
export async function discoverRepositoryFiles(
  workspacePath: string,
  options?: DiscoverOptions,
): Promise<DiscoveredFile[]> {
  const discovered: DiscoveredFile[] = [];
  const ig: Ignore = ignore();

  // Load .gitignore if present in workspace
  const gitignorePath = path.join(workspacePath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = await fs.promises.readFile(gitignorePath, "utf-8");
      ig.add(gitignoreContent);
    } catch {
      // Ignore gitignore read failures
    }
  }

  // Add custom user-supplied ignore patterns
  if (options?.extraIgnorePatterns && options.extraIgnorePatterns.length > 0) {
    ig.add(options.extraIgnorePatterns);
  }

  async function traverse(currentDir: string, relativeDir: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    // Deterministic sorting (alphabetical)
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip ignored or hidden dirs, but always descend into .github
        if (
          (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) &&
          entry.name !== ".github"
        ) {
          continue;
        }

        // Check gitignore / custom ignore rules
        if (ig.ignores(relPath + "/")) {
          continue;
        }

        await traverse(fullPath, relPath);
      } else if (entry.isFile()) {
        const filename = entry.name.toLowerCase();
        const ext = path.extname(filename);

        if (LOCKFILES.has(entry.name) || LOCKFILES.has(filename) || IGNORED_EXTENSIONS.has(ext)) {
          continue;
        }

        // Check gitignore / custom ignore rules
        if (ig.ignores(relPath)) {
          continue;
        }

        const language = getLanguageForFile(relPath);
        if (!language) continue;

        discovered.push({
          relativePath: relPath,
          absolutePath: fullPath,
          category: isProjectFile(language) ? "project" : "source",
          language,
        });
      }
    }
  }

  await traverse(workspacePath, "");
  return discovered;
}
