import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getLanguageForFile,
  discoverRepositoryFiles,
  isSensitiveFile,
  isSensitiveContent,
} from '../fileFilter';

describe('getLanguageForFile', () => {
  describe('expanded source files', () => {
    it.each([
      ['src/index.ts', 'typescript'],
      ['src/App.tsx', 'tsx'],
      ['lib/utils.js', 'javascript'],
      ['components/Button.jsx', 'jsx'],
      ['scripts/run.py', 'python'],
      ['main.go', 'go'],
      ['src/main.rs', 'rust'],
      ['App.java', 'java'],
      ['Main.kt', 'kotlin'],
      ['Program.cs', 'csharp'],
      ['main.cpp', 'cpp'],
      ['utils.c', 'c'],
      ['index.php', 'php'],
    ])('maps %s → %s', (filePath, expected) => {
      expect(getLanguageForFile(filePath)).toBe(expected);
    });
  });

  describe('expanded project documents', () => {
    it.each([
      ['README.md', 'markdown'],
      ['CONTRIBUTING.md', 'markdown'],
      ['SECURITY.md', 'markdown'],
      ['LICENSE', 'text'],
      ['LICENSE.md', 'text'],
      ['package.json', 'json'],
      ['pyproject.toml', 'toml'],
      ['Dockerfile', 'dockerfile'],
      ['compose.yaml', 'dockerfile'],
      ['docker-compose.override.yml', 'dockerfile'],
      ['Makefile', 'config'],
      ['.editorconfig', 'config'],
      ['.github/workflows/ci.yml', 'yaml'],
    ])('maps %s → %s', (filePath, expected) => {
      expect(getLanguageForFile(filePath)).toBe(expected);
    });
  });
});

describe('discoverRepositoryFiles with gitignore and custom patterns', () => {
  let tmpDir: string;

  const mkFile = (relPath: string, content = '') => {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'drag-ff-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('respects .gitignore in workspace', async () => {
    mkFile('.gitignore', 'temp_generated.ts\n*.log\n');
    mkFile('src/index.ts');
    mkFile('temp_generated.ts');

    const files = await discoverRepositoryFiles(tmpDir);
    const paths = files.map((f) => f.relativePath);

    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('temp_generated.ts');
  });

  it('respects extraIgnorePatterns', async () => {
    mkFile('src/index.ts');
    mkFile('src/legacy.ts');

    const files = await discoverRepositoryFiles(tmpDir, { extraIgnorePatterns: ['src/legacy.ts'] });
    const paths = files.map((f) => f.relativePath);

    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('src/legacy.ts');
  });

  it('excludes sensitive files and certificates from discovery', async () => {
    mkFile('src/index.ts', 'console.log("hello");');
    mkFile('.env', 'DATABASE_URL=postgres://...');
    mkFile('.env.local', 'SECRET=secret');
    mkFile('id_rsa', 'ssh private key');
    mkFile('id_ed25519', 'ed25519 key');
    mkFile('server.key', 'key');
    mkFile('cert.pem', 'cert');
    mkFile('credentials.json', '{"client_id": "xyz"}');
    mkFile('service-account.json', '{"project_id": "xyz"}');

    const files = await discoverRepositoryFiles(tmpDir);
    const paths = files.map((f) => f.relativePath);

    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('.env.local');
    expect(paths).not.toContain('id_rsa');
    expect(paths).not.toContain('id_ed25519');
    expect(paths).not.toContain('server.key');
    expect(paths).not.toContain('cert.pem');
    expect(paths).not.toContain('credentials.json');
    expect(paths).not.toContain('service-account.json');
  });
});

describe('sensitive file and content detection', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'id_rsa',
    'id_ed25519',
    'server.key',
    'cert.pem',
    'identity.p12',
    'cert.pfx',
    'ca.crt',
    'credentials.json',
    'client_secret_xyz.json',
    'service-account.json',
    'service_account.json',
  ])('identifies %s as a sensitive file and denies language mapping', (filePath) => {
    expect(getLanguageForFile(filePath)).toBeNull();
  });

  it('detects private key headers in file content', () => {
    const rsaKey = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y...
-----END RSA PRIVATE KEY-----
    `;
    const openSshKey = `
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAA...
-----END OPENSSH PRIVATE KEY-----
    `;
    const pgpKey = `
-----BEGIN PGP PRIVATE KEY BLOCK-----
Version: BCPG C# v1.6.1.0
...
-----END PGP PRIVATE KEY BLOCK-----
    `;
    const cert = `
-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJ...
-----END CERTIFICATE-----
    `;
    const regularCode = `export function hello() { return "world"; }`;

    expect(isSensitiveContent(rsaKey)).toBe(true);
    expect(isSensitiveContent(openSshKey)).toBe(true);
    expect(isSensitiveContent(pgpKey)).toBe(true);
    expect(isSensitiveContent(cert)).toBe(true);
    expect(isSensitiveContent(regularCode)).toBe(false);

    expect(isSensitiveFile('src/key.txt', rsaKey)).toBe(true);
    expect(isSensitiveFile('src/code.ts', regularCode)).toBe(false);
  });
});


