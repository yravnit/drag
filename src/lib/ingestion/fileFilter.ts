import fs from "fs";
import path from "path";
import ignore, { Ignore } from "ignore";

type SupportedSourceLanguage =
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

type ProjectDocumentLanguage =
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
  // Certificates & Keys
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
  ".der",
  ".kdbx",
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
  ".der",
  ".kdbx",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "cargo.lock",
  "pipfile.lock",
]);

/**
 * Files excluded by exact filename, independent of lockfile or extension rules.
 * AGENTS.md contains agent-specific instructions and should not be indexed.
 */
const EXCLUDED_FILENAMES = new Set(["AGENTS.md"]);

/**
 * Checks whether file content contains private keys or sensitive credentials.
 */
export function isSensitiveContent(content: string): boolean {
  if (!content || typeof content !== "string") {
    return false;
  }

  const privateKeyPattern =
    /(?:^|\r?\n)\s*-----BEGIN(?: [A-Z0-9_-]+)? PRIVATE KEY-----\s*(?:\r?\n|$)/i;
  const pgpPrivateKeyPattern = /(?:^|\r?\n)\s*-----BEGIN PGP PRIVATE KEY BLOCK-----\s*(?:\r?\n|$)/i;
  const certPattern = /(?:^|\r?\n)\s*-----BEGIN CERTIFICATE-----\s*(?:\r?\n|$)/i;

  return (
    privateKeyPattern.test(content) ||
    pgpPrivateKeyPattern.test(content) ||
    certPattern.test(content)
  );
}

/**
 * Checks whether a file path or its content represents a sensitive secret file.
 */
export function isSensitiveFile(relativePath: string, content?: string): boolean {
  const normPath = relativePath.replace(/\\/g, "/");
  const filename = path.basename(normPath).toLowerCase();
  const ext = path.extname(normPath).toLowerCase();

  if (SENSITIVE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (filename === ".env" || filename.startsWith(".env.")) {
    return true;
  }

  if (
    filename === "id_rsa" ||
    filename === "id_rsa.pub" ||
    filename === "id_ed25519" ||
    filename === "id_ed25519.pub" ||
    filename === "id_dsa" ||
    filename === "id_ecdsa"
  ) {
    return true;
  }

  if (
    filename === "credentials.json" ||
    filename === "auth.json" ||
    filename === "token.json" ||
    /^client_secret.*\.json$/i.test(filename) ||
    /^service[-_]account.*\.json$/i.test(filename) ||
    /^service[-_]account.*\.(yaml|yml)$/i.test(filename)
  ) {
    return true;
  }

  if (content && isSensitiveContent(content)) {
    return true;
  }

  return false;
}

/**
 * Returns the language tag for a file path, or null if the file should be skipped.
 */
export function getLanguageForFile(relativePath: string): DiscoveredFile["language"] | null {
  if (isSensitiveFile(relativePath)) {
    return null;
  }

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
    filename === "CODE_OF_CONDUCT.md" ||
    filename === "HANDOFF.md"
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
function isProjectFile(language: DiscoveredFile["language"]): boolean {
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
    // An unreadable directory (permissions, broken symlink, race with a checkout) must skip
    // that subtree rather than reject: discoverRepositoryFiles has no per-directory recovery,
    // so one throw here aborts the entire ingestion run at the caller's await.
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(
        `[fileFilter] Skipping unreadable directory '${relativeDir || "."}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

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

        if (
          LOCKFILES.has(entry.name) ||
          LOCKFILES.has(filename) ||
          EXCLUDED_FILENAMES.has(entry.name) ||
          IGNORED_EXTENSIONS.has(ext) ||
          isSensitiveFile(relPath)
        ) {
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
