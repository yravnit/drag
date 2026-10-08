/**
 * Semantic chunker integration tests.
 *
 * These tests use the real Tree-sitter WASM parsers, so they verify the
 * actual AST-driven chunking behaviour without any mocks.
 *
 * They are intentionally coarser-grained than pure unit tests — we assert
 * on the observable shape of chunks (type, name, line ranges, text content)
 * rather than pinning exact line numbers, so they stay stable as minor
 * refactors happen.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TreeSitterParserManager } from '../parserManager';
import { SemanticChunker, type RawChunk } from '../semanticChunker';
import type { DiscoveredFile } from '../fileFilter';

// ─── Shared setup ─────────────────────────────────────────────────────────────

let parserManager: TreeSitterParserManager;
let chunker: SemanticChunker;

beforeAll(async () => {
  parserManager = new TreeSitterParserManager();
  // Eagerly warm up parsers — avoids per-test WASM load overhead
  await parserManager.getParser('typescript');
  await parserManager.getParser('python');
  chunker = new SemanticChunker(parserManager);
});

afterAll(() => {
  parserManager.dispose();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(
  language: DiscoveredFile['language'],
  category: DiscoveredFile['category'] = 'source',
): DiscoveredFile {
  return {
    relativePath: `file.${language}`,
    absolutePath: `/tmp/file.${language}`,
    category,
    language,
  };
}

function chunkTypes(chunks: RawChunk[]) {
  return chunks.map((c) => c.chunkType);
}

// ─── Project file chunking ────────────────────────────────────────────────────

describe('SemanticChunker — project files', () => {
  it('emits a single "document" chunk for markdown', async () => {
    const file = makeFile('markdown', 'project');
    const content = '# Hello\n\nThis is a README.\n';
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe('document');
    expect(chunks[0].text).toBe(content);
    expect(chunks[0].startLine).toBe(1);
  });

  it('emits a single "config" chunk for JSON', async () => {
    const file = makeFile('json', 'project');
    const content = '{"name":"drag","version":"0.1.0"}';
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe('config');
  });

  it('emits a single "config" chunk for YAML', async () => {
    const file = makeFile('yaml', 'project');
    const content = 'name: drag\nversion: 0.1.0\n';
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe('config');
  });

  it('emits a single "config" chunk for TOML', async () => {
    const file = makeFile('toml', 'project');
    const content = '[tool.poetry]\nname = "drag"\n';
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe('config');
  });

  it('emits a single "config" chunk for Dockerfile', async () => {
    const file = makeFile('dockerfile', 'project');
    const content = 'FROM node:20\nWORKDIR /app\n';
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkType).toBe('config');
  });

  it('uses the filename as the symbolName', async () => {
    const file: DiscoveredFile = {
      relativePath: 'docs/README.md',
      absolutePath: '/tmp/docs/README.md',
      category: 'project',
      language: 'markdown',
    };
    const chunks = await chunker.chunkFile(file, '# Doc');
    expect(chunks[0].symbolName).toBe('README.md');
  });
});

// ─── TypeScript chunking ──────────────────────────────────────────────────────

describe('SemanticChunker — TypeScript', () => {
  const file = makeFile('typescript');

  it('chunks a standalone function', async () => {
    const content = `function greet(name: string): string {\n  return \`Hello \${name}\`;\n}\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.chunkType === 'function' && c.symbolName === 'greet')).toBe(true);
  });

  it('chunks an arrow function assigned via const', async () => {
    const content = `const add = (a: number, b: number) => a + b;\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.symbolName === 'add')).toBe(true);
  });

  it('chunks an exported function', async () => {
    const content = `export function compute(): void {\n  console.log('hi');\n}\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.symbolName === 'compute')).toBe(true);
  });

  it('produces a "class" chunk and "method" chunks for a class', async () => {
    const content = `class MyService {\n  doWork(): void {\n    console.log('working');\n  }\n  cleanup(): void {}\n}\n`;
    const chunks = await chunker.chunkFile(file, content);

    const types = new Set(chunkTypes(chunks));
    expect(types.has('class')).toBe(true);
    expect(types.has('method')).toBe(true);

    const classChunk = chunks.find((c) => c.chunkType === 'class');
    expect(classChunk?.symbolName).toBe('MyService');
  });

  it('attaches leading JSDoc comments to the following chunk', async () => {
    const content = `/** Does something. */\nfunction doSomething(): void {}\n`;
    const chunks = await chunker.chunkFile(file, content);

    const fn = chunks.find((c) => c.symbolName === 'doSomething');
    expect(fn).toBeDefined();
    expect(fn!.text).toContain('/** Does something. */');
  });

  it('groups import statements and non-function top-level code into a "module" chunk', async () => {
    const content = `import fs from 'fs';\nimport path from 'path';\n\nconst CONSTANT = 42;\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.chunkType === 'module')).toBe(true);
  });

  it('line numbers are 1-indexed and startLine <= endLine', async () => {
    const content = `function a(): void {}\nfunction b(): void {}\n`;
    const chunks = await chunker.chunkFile(file, content);

    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('chunk text matches the actual source lines', async () => {
    const content = `function hello(): string {\n  return 'hi';\n}\n`;
    const lines = content.split('\n');
    const chunks = await chunker.chunkFile(file, content);

    for (const chunk of chunks) {
      const expected = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n');
      expect(chunk.text).toBe(expected);
    }
  });

  it('handles an empty file without throwing', async () => {
    const chunks = await chunker.chunkFile(file, '');
    expect(Array.isArray(chunks)).toBe(true);
  });
});

// ─── Python chunking ──────────────────────────────────────────────────────────

describe('SemanticChunker — Python', () => {
  const file = makeFile('python');

  it('chunks a top-level function', async () => {
    const content = `def greet(name: str) -> str:\n    return f"Hello {name}"\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.chunkType === 'function' && c.symbolName === 'greet')).toBe(true);
  });

  it('produces a "class" chunk and "method" chunks for a class', async () => {
    const content = `class Animal:\n    def speak(self) -> str:\n        return "..."\n\n    def name(self) -> str:\n        return "Animal"\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.chunkType === 'class' && c.symbolName === 'Animal')).toBe(true);
    expect(chunks.some((c) => c.chunkType === 'method' && c.symbolName === 'speak')).toBe(true);
  });

  it('groups imports into a "module" chunk', async () => {
    const content = `import os\nimport sys\n\nPATH = "/usr"\n`;
    const chunks = await chunker.chunkFile(file, content);

    expect(chunks.some((c) => c.chunkType === 'module')).toBe(true);
  });

  it('line numbers are 1-indexed and startLine <= endLine', async () => {
    const content = `def a():\n    pass\n\ndef b():\n    pass\n`;
    const chunks = await chunker.chunkFile(file, content);

    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });
});

// ─── Large chunk splitting ────────────────────────────────────────────────────

describe('SemanticChunker — large chunk splitting', () => {
  const file = makeFile('typescript');

  it('splits a function exceeding 120 lines into multiple chunks', async () => {
    // Build a function with 130 lines of body statements
    const bodyLines = Array.from({ length: 130 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const content = `function bigFn() {\n${bodyLines}\n}\n`;

    const chunks = await chunker.chunkFile(file, content);

    // The oversized function must not appear as a single monolithic chunk
    const monolith = chunks.find(
      (c) => c.symbolName === 'bigFn' && c.endLine - c.startLine + 1 > 120,
    );
    expect(monolith).toBeUndefined();
  });
});
