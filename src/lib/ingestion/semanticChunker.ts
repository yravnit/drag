import Parser from "web-tree-sitter";
import { DiscoveredFile } from "./fileFilter";
import { TreeSitterParserManager, SupportedLanguage } from "./parserManager";

export interface RawChunk {
  chunkType: "function" | "class" | "method" | "module" | "document" | "config";
  symbolName: string | null;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  text: string;
  language: string;
}

const MAX_CHUNK_LINES = 120;
const MAX_CHUNK_CHARS = 4000;

const SOURCE_LANGUAGES = new Set([
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

const GENERIC_FUNCTION_NODES = new Set([
  "function_declaration",
  "function_definition",
  "method_declaration",
  "method_definition",
  "function_item",
  "constructor_declaration",
  "destructor_declaration",
]);

const GENERIC_CLASS_NODES = new Set([
  "class_declaration",
  "class_specifier",
  "struct_specifier",
  "struct_item",
  "type_declaration",
  "interface_declaration",
  "trait_item",
  "enum_declaration",
  "enum_item",
  "impl_item",
  "namespace_definition",
]);

export class SemanticChunker {
  private parserManager: TreeSitterParserManager;

  constructor(parserManager: TreeSitterParserManager) {
    this.parserManager = parserManager;
  }

  public async chunkFile(file: DiscoveredFile, content: string): Promise<RawChunk[]> {
    if (file.category === "project" || !SOURCE_LANGUAGES.has(file.language)) {
      return [this.chunkProjectFile(file, content)];
    }

    const lang = file.language as SupportedLanguage;

    // Use withParser to guarantee isolated parser instance per file and automatic disposal via try/finally
    return await this.parserManager.withParser(lang, (parser) => {
      const tree = parser.parse(content);

      // parser.parse() can return null when parsing fails or times out
      if (!tree) {
        console.warn(
          `[SemanticChunker] parser.parse() returned null for file: ${file.relativePath}. Using fallback module chunk.`,
        );
        const lines = content.split("\n");
        return [
          {
            chunkType: "module" as const,
            symbolName: null,
            startLine: 1,
            endLine: Math.max(1, lines.length),
            text: content,
            language: file.language,
          },
        ];
      }

      try {
        const lines = content.split("\n");

        if (lang === "python") {
          return this.chunkPythonAST(tree.rootNode, lines, file.language);
        } else if (["typescript", "tsx", "javascript", "jsx"].includes(lang)) {
          return this.chunkJsTsAST(tree.rootNode, lines, file.language);
        } else {
          return this.chunkGenericAST(tree.rootNode, lines, file.language);
        }
      } finally {
        try {
          tree.delete();
        } catch {
          // Ignore tree disposal errors
        }
      }
    });
  }

  private chunkProjectFile(file: DiscoveredFile, content: string): RawChunk {
    const lines = content.split("\n");
    const isConfig = ["json", "yaml", "toml", "dockerfile", "config"].includes(file.language);

    return {
      chunkType: isConfig ? "config" : "document",
      symbolName: file.relativePath.split("/").pop() || file.relativePath,
      startLine: 1,
      endLine: Math.max(1, lines.length),
      text: content,
      language: file.language,
    };
  }

  /**
   * Semantic chunking for JS/TS/TSX/JSX files
   */
  private chunkJsTsAST(rootNode: Parser.SyntaxNode, lines: string[], language: string): RawChunk[] {
    const chunks: RawChunk[] = [];
    const children = this.getChildren(rootNode);

    let pendingModuleNodes: Parser.SyntaxNode[] = [];

    const flushModuleChunk = () => {
      if (pendingModuleNodes.length === 0) return;

      const nonCommentNodes = pendingModuleNodes.filter((n) => n.type !== "comment");
      if (nonCommentNodes.length === 0) {
        pendingModuleNodes = [];
        return;
      }

      const firstNode = pendingModuleNodes[0];
      const lastNode = pendingModuleNodes[pendingModuleNodes.length - 1];

      const startLine = firstNode.startPosition.row + 1;
      const endLine = lastNode.endPosition.row + 1;
      const text = lines.slice(startLine - 1, endLine).join("\n");

      if (text.trim().length > 0) {
        chunks.push({
          chunkType: "module",
          symbolName: null,
          startLine,
          endLine,
          text,
          language,
        });
      }

      pendingModuleNodes = [];
    };

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const unwrapped = this.unwrapExport(node);
      const isFunc = this.isJsTsFunction(unwrapped);
      const isCls = this.isJsTsClass(unwrapped);

      if (isFunc || isCls) {
        flushModuleChunk();
        const leadingComments = this.getLeadingComments(children, i);

        if (isFunc) {
          const funcChunks = this.processJsTsFunction(unwrapped, lines, leadingComments, language);
          chunks.push(...funcChunks);
        } else if (isCls) {
          const classChunks = this.processJsTsClass(unwrapped, lines, leadingComments, language);
          chunks.push(...classChunks);
        }
      } else {
        pendingModuleNodes.push(node);
      }
    }

    flushModuleChunk();
    return chunks;
  }

  private processJsTsFunction(
    node: Parser.SyntaxNode,
    lines: string[],
    leadingComments: Parser.SyntaxNode[],
    language: string,
    isMethod = false,
  ): RawChunk[] {
    const symbolName = this.extractJsTsSymbolName(node);
    const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
    const startLine = startNode.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const text = lines.slice(startLine - 1, endLine).join("\n");

    const chunkType: RawChunk["chunkType"] = isMethod ? "method" : "function";

    if (endLine - startLine + 1 > MAX_CHUNK_LINES || text.length > MAX_CHUNK_CHARS) {
      return this.splitLargeBlock(node, lines, leadingComments, chunkType, symbolName, language);
    }

    return [
      {
        chunkType,
        symbolName,
        startLine,
        endLine,
        text,
        language,
      },
    ];
  }

  private processJsTsClass(
    node: Parser.SyntaxNode,
    lines: string[],
    leadingComments: Parser.SyntaxNode[],
    language: string,
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const symbolName = this.extractJsTsSymbolName(node);
    const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
    const startLine = startNode.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const text = lines.slice(startLine - 1, endLine).join("\n");

    chunks.push({
      chunkType: "class",
      symbolName,
      startLine,
      endLine,
      text,
      language,
    });

    const bodyNode = node.children.find((c) => c.type === "class_body");
    if (bodyNode) {
      const bodyChildren = this.getChildren(bodyNode);
      for (let i = 0; i < bodyChildren.length; i++) {
        const child = bodyChildren[i];
        if (child.type === "method_definition" || child.type === "abstract_method_signature") {
          const methodComments = this.getLeadingComments(bodyChildren, i);
          const methodChunks = this.processJsTsFunction(
            child,
            lines,
            methodComments,
            language,
            true,
          );
          chunks.push(...methodChunks);
        }
      }
    }

    return chunks;
  }

  /**
   * Semantic chunking for Python files
   */
  private chunkPythonAST(
    rootNode: Parser.SyntaxNode,
    lines: string[],
    language: string,
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const children = this.getChildren(rootNode);

    let pendingModuleNodes: Parser.SyntaxNode[] = [];

    const flushModuleChunk = () => {
      if (pendingModuleNodes.length === 0) return;

      const nonCommentNodes = pendingModuleNodes.filter((n) => n.type !== "comment");
      if (nonCommentNodes.length === 0) {
        pendingModuleNodes = [];
        return;
      }

      const firstNode = pendingModuleNodes[0];
      const lastNode = pendingModuleNodes[pendingModuleNodes.length - 1];

      const startLine = firstNode.startPosition.row + 1;
      const endLine = lastNode.endPosition.row + 1;
      const text = lines.slice(startLine - 1, endLine).join("\n");

      if (text.trim().length > 0) {
        chunks.push({
          chunkType: "module",
          symbolName: null,
          startLine,
          endLine,
          text,
          language,
        });
      }

      pendingModuleNodes = [];
    };

    for (let i = 0; i < children.length; i++) {
      const node = children[i];

      if (node.type === "function_definition") {
        flushModuleChunk();
        const leadingComments = this.getLeadingComments(children, i);
        chunks.push(...this.processPythonFunction(node, lines, leadingComments, language, false));
      } else if (node.type === "class_definition") {
        flushModuleChunk();
        const leadingComments = this.getLeadingComments(children, i);
        chunks.push(...this.processPythonClass(node, lines, leadingComments, language));
      } else {
        pendingModuleNodes.push(node);
      }
    }

    flushModuleChunk();
    return chunks;
  }

  private processPythonFunction(
    node: Parser.SyntaxNode,
    lines: string[],
    leadingComments: Parser.SyntaxNode[],
    language: string,
    isMethod = false,
  ): RawChunk[] {
    const nameNode =
      node.childForFieldName("name") || node.children.find((c) => c.type === "identifier");
    const symbolName = nameNode ? nameNode.text : null;
    const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
    const startLine = startNode.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const text = lines.slice(startLine - 1, endLine).join("\n");

    const chunkType: RawChunk["chunkType"] = isMethod ? "method" : "function";

    if (endLine - startLine + 1 > MAX_CHUNK_LINES || text.length > MAX_CHUNK_CHARS) {
      return this.splitLargeBlock(node, lines, leadingComments, chunkType, symbolName, language);
    }

    return [
      {
        chunkType,
        symbolName,
        startLine,
        endLine,
        text,
        language,
      },
    ];
  }

  private processPythonClass(
    node: Parser.SyntaxNode,
    lines: string[],
    leadingComments: Parser.SyntaxNode[],
    language: string,
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const nameNode =
      node.childForFieldName("name") || node.children.find((c) => c.type === "identifier");
    const symbolName = nameNode ? nameNode.text : null;
    const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
    const startLine = startNode.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const text = lines.slice(startLine - 1, endLine).join("\n");

    chunks.push({
      chunkType: "class",
      symbolName,
      startLine,
      endLine,
      text,
      language,
    });

    const bodyNode =
      node.childForFieldName("body") || node.children.find((c) => c.type === "block");
    if (bodyNode) {
      const bodyChildren = this.getChildren(bodyNode);
      for (let i = 0; i < bodyChildren.length; i++) {
        const child = bodyChildren[i];
        if (child.type === "function_definition") {
          const methodComments = this.getLeadingComments(bodyChildren, i);
          chunks.push(...this.processPythonFunction(child, lines, methodComments, language, true));
        }
      }
    }

    return chunks;
  }

  /**
   * Generic semantic chunking for Go, Rust, Java, Kotlin, C#, C++, C, PHP
   */
  private chunkGenericAST(
    rootNode: Parser.SyntaxNode,
    lines: string[],
    language: string,
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const children = this.getChildren(rootNode);
    let pendingModuleNodes: Parser.SyntaxNode[] = [];

    const flushModuleChunk = () => {
      if (pendingModuleNodes.length === 0) return;

      const nonCommentNodes = pendingModuleNodes.filter((n) => n.type !== "comment");
      if (nonCommentNodes.length === 0) {
        pendingModuleNodes = [];
        return;
      }

      const firstNode = pendingModuleNodes[0];
      const lastNode = pendingModuleNodes[pendingModuleNodes.length - 1];

      const startLine = firstNode.startPosition.row + 1;
      const endLine = lastNode.endPosition.row + 1;
      const text = lines.slice(startLine - 1, endLine).join("\n");

      if (text.trim().length > 0) {
        chunks.push({
          chunkType: "module",
          symbolName: null,
          startLine,
          endLine,
          text,
          language,
        });
      }

      pendingModuleNodes = [];
    };

    for (let i = 0; i < children.length; i++) {
      const node = children[i];

      if (GENERIC_FUNCTION_NODES.has(node.type)) {
        flushModuleChunk();
        const leadingComments = this.getLeadingComments(children, i);
        const symbolName = this.extractGenericSymbolName(node);
        const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
        const startLine = startNode.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const text = lines.slice(startLine - 1, endLine).join("\n");

        if (endLine - startLine + 1 > MAX_CHUNK_LINES || text.length > MAX_CHUNK_CHARS) {
          chunks.push(
            ...this.splitLargeBlock(node, lines, leadingComments, "function", symbolName, language),
          );
        } else {
          chunks.push({
            chunkType: "function",
            symbolName,
            startLine,
            endLine,
            text,
            language,
          });
        }
      } else if (GENERIC_CLASS_NODES.has(node.type)) {
        flushModuleChunk();
        const leadingComments = this.getLeadingComments(children, i);
        const symbolName = this.extractGenericSymbolName(node);
        const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
        const startLine = startNode.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const text = lines.slice(startLine - 1, endLine).join("\n");

        chunks.push({
          chunkType: "class",
          symbolName,
          startLine,
          endLine,
          text,
          language,
        });
      } else {
        pendingModuleNodes.push(node);
      }
    }

    flushModuleChunk();
    return chunks;
  }

  private extractGenericSymbolName(node: Parser.SyntaxNode): string | null {
    const nameNode =
      node.childForFieldName("name") ||
      node.children.find((c) =>
        ["identifier", "type_identifier", "field_identifier", "name"].includes(c.type),
      );
    return nameNode ? nameNode.text : null;
  }

  /**
   * Split large functions or classes ONLY at semantic boundaries (statement blocks).
   * Splits based on accumulated lines (>= MAX_CHUNK_LINES) or characters (>= MAX_CHUNK_CHARS).
   */
  private splitLargeBlock(
    node: Parser.SyntaxNode,
    lines: string[],
    leadingComments: Parser.SyntaxNode[],
    chunkType: RawChunk["chunkType"],
    symbolName: string | null,
    language: string,
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const startNode = leadingComments.length > 0 ? leadingComments[0] : node;
    const startLine = startNode.startPosition.row + 1;

    const blockNode = node.children.find((c) =>
      [
        "statement_block",
        "block",
        "compound_statement",
        "declaration_list",
        "field_declaration_list",
      ].includes(c.type),
    );

    if (!blockNode) {
      const endLine = node.endPosition.row + 1;
      return [
        {
          chunkType,
          symbolName,
          startLine,
          endLine,
          text: lines.slice(startLine - 1, endLine).join("\n"),
          language,
        },
      ];
    }

    const blockChildren = this.getChildren(blockNode);
    let subBlockNodes: Parser.SyntaxNode[] = [];
    let accumLines = 0;
    let accumChars = 0;

    const flushSubChunk = (subType: RawChunk["chunkType"], subName: string | null) => {
      if (subBlockNodes.length === 0) return;

      const first = subBlockNodes[0];
      const last = subBlockNodes[subBlockNodes.length - 1];
      const subStartLine = first.startPosition.row + 1;
      const subEndLine = last.endPosition.row + 1;
      const subText = lines.slice(subStartLine - 1, subEndLine).join("\n");

      if (subText.trim().length > 0) {
        chunks.push({
          chunkType: subType,
          symbolName: subName,
          startLine: subStartLine,
          endLine: subEndLine,
          text: subText,
          language,
        });
      }
      subBlockNodes = [];
      accumLines = 0;
      accumChars = 0;
    };

    for (let i = 0; i < blockChildren.length; i++) {
      const child = blockChildren[i];
      const unwrapped = this.unwrapExport(child);

      if (
        this.isJsTsFunction(unwrapped) ||
        child.type === "function_definition" ||
        GENERIC_FUNCTION_NODES.has(child.type)
      ) {
        flushSubChunk(chunkType, symbolName ? `${symbolName}:block` : null);
        const subComments = this.getLeadingComments(blockChildren, i);
        const subChunks = this.processJsTsFunction(unwrapped, lines, subComments, language, true);
        chunks.push(...subChunks);
      } else {
        subBlockNodes.push(child);
        const nodeStartLine = child.startPosition.row + 1;
        const nodeEndLine = child.endPosition.row + 1;
        const lineSpan = nodeEndLine - nodeStartLine + 1;
        const charLen = lines.slice(nodeStartLine - 1, nodeEndLine).join("\n").length;

        accumLines += lineSpan;
        accumChars += charLen;

        // Split based on accumulated lines (>= MAX_CHUNK_LINES) or characters (>= MAX_CHUNK_CHARS)
        if (accumLines >= MAX_CHUNK_LINES || accumChars >= MAX_CHUNK_CHARS) {
          flushSubChunk(chunkType, symbolName ? `${symbolName}:block` : null);
        }
      }
    }

    flushSubChunk(chunkType, symbolName ? `${symbolName}:block` : null);

    if (chunks.length === 0) {
      const endLine = node.endPosition.row + 1;
      chunks.push({
        chunkType,
        symbolName,
        startLine,
        endLine,
        text: lines.slice(startLine - 1, endLine).join("\n"),
        language,
      });
    }

    return chunks;
  }

  // --- Helper Methods ---

  private getChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const children: Parser.SyntaxNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) children.push(child);
    }
    return children;
  }

  private unwrapExport(node: Parser.SyntaxNode): Parser.SyntaxNode {
    if (node.type === "export_statement" || node.type === "export_internal") {
      const inner = node.children.find((c) =>
        [
          "function_declaration",
          "class_declaration",
          "generator_function_declaration",
          "lexical_declaration",
          "variable_declaration",
        ].includes(c.type),
      );
      if (inner) return inner;
    }
    return node;
  }

  private isJsTsFunction(node: Parser.SyntaxNode): boolean {
    if (
      [
        "function_declaration",
        "generator_function_declaration",
        "function_expression",
        "generator_function",
      ].includes(node.type)
    ) {
      return true;
    }
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      return node.children.some((c) =>
        c.children.some((child) => ["arrow_function", "function_expression"].includes(child.type)),
      );
    }
    return false;
  }

  private isJsTsClass(node: Parser.SyntaxNode): boolean {
    return ["class_declaration", "class_expression"].includes(node.type);
  }

  private extractJsTsSymbolName(node: Parser.SyntaxNode): string | null {
    const nameNode =
      node.childForFieldName("name") || node.children.find((c) => c.type === "identifier");
    if (nameNode) return nameNode.text;

    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      const declarator = node.children.find((c) => c.type === "variable_declarator");
      if (declarator) {
        const idNode =
          declarator.childForFieldName("name") ||
          declarator.children.find((c) => c.type === "identifier");
        if (idNode) return idNode.text;
      }
    }

    return null;
  }

  private getLeadingComments(children: Parser.SyntaxNode[], index: number): Parser.SyntaxNode[] {
    const comments: Parser.SyntaxNode[] = [];
    let i = index - 1;

    while (i >= 0) {
      const prev = children[i];
      if (prev.type === "comment") {
        comments.unshift(prev);
        i--;
      } else {
        break;
      }
    }

    return comments;
  }
}
