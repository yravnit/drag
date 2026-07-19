# DRAG - Developer Repository Augmented Generation - v1

## Overall

- AI assistant for software repositories
- Follow the tutorial architecture as closely as possible
- Only deviate where code repositories require different handling
- Design for future expansion without implementing future features

---

## Supported Sources

- GitHub repository
- Local repository
- Resume (PDF/Markdown)

---

## Supported Languages

- TypeScript
- JavaScript
- Python

---

## Indexed Files

### Include

- Source code
- README.md
- package.json
- tsconfig.json
- pyproject.toml
- requirements.txt
- Dockerfile
- docker-compose.yml
- .github/workflows/*
- JSON/YAML configuration files

### Ignore

- node_modules
- .next
- dist
- build
- coverage
- vendor
- generated files
- lockfiles
- cache folders
- AGENTS.md
- editor/IDE metadata

---

## Ingestion Pipeline

Repository

↓

Parse

↓

AST Chunking

↓

Embeddings

↓

pgvector

↓

Retrieval

↓

LLM

---

## Chunking

- Tree-sitter based parsing
- Chunk by:
  - functions
  - classes
  - methods
  - modules
- Keep comments attached to their code
- Split oversized functions only when necessary

---

## Retrieval

- Semantic vector search
- Top-K retrieval
- LLM answers only from retrieved context
- No hybrid search (v1)

---

## Database

- PostgreSQL
- pgvector
- Follow tutorial database architecture

---

## Metadata

Each chunk stores:

- repository
- file path
- language
- chunk type
- symbol name
- start line
- end line
- branch (main only in v1)

---

## Response Rules

- Never invent code
- Never invent files
- Never invent APIs
- Always answer from retrieved context
- If evidence is insufficient, explicitly say so
- Always include file + line citations
- Generate Mermaid diagrams only when enough evidence exists

---

## UI Features

- Chat interface
- Repository indexing status
- Source citations
- Mermaid architecture rendering

---

## Out of Scope (v1)

- Hybrid retrieval
- Git history search
- Commit embeddings
- PR indexing
- Branch-aware retrieval
- Multi-repository indexing
- VS Code extension
- CLI
- SaaS features
- Team collaboration

---

## Future Ready

Architecture should allow adding:

- Hybrid search
- Incremental indexing
- Branch support
- Git history
- CLI
- VS Code extension
- Alternative vector stores

## Design Principles

- Prefer simple solutions over clever ones.
- Optimize for correctness before performance.
- Keep every module replaceable (parser, embeddings, vector store, LLM).