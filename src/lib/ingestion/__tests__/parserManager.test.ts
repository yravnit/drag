import { describe, it, expect, afterEach } from 'vitest';
import { TreeSitterParserManager } from '../parserManager';

describe('TreeSitterParserManager', () => {
  const manager = new TreeSitterParserManager();

  afterEach(() => {
    manager.dispose();
  });

  it('loads language grammar exactly once', async () => {
    const lang1 = await manager.getLanguage('typescript');
    const lang2 = await manager.getLanguage('typescript');

    expect(lang1).toBe(lang2);
  });

  it('runs concurrent parsing safely using withParser', async () => {
    const codeA = 'const a = 1; function testA() { return a; }';
    const codeB = 'const b = 2; class TestB { getValue() { return b; } }';

    const [resA, resB] = await Promise.all([
      manager.withParser('typescript', (parser) => parser.parse(codeA)),
      manager.withParser('typescript', (parser) => parser.parse(codeB)),
    ]);

    expect(resA.rootNode.type).toBe('program');
    expect(resB.rootNode.type).toBe('program');
  });

  it('normalizes jsx to tsx grammar', async () => {
    const tsxLang = await manager.getLanguage('tsx');
    const jsxLang = await manager.getLanguage('jsx');

    expect(jsxLang).toBe(tsxLang);
  });
});
