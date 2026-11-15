/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

import { buildSystemPrompt } from '@/agent/systemPrompt';
import { APP_NAME } from '@/appName';

const ROOT = join(__dirname, '..', '..');
const OLD_NAME = /consumerhack/i;

// Identifiers that keep the old name on purpose (docs/building.md lists them with the reasons).
const ALLOWED_STRINGS: Record<string, string[]> = {
  'convex/memory.ts': ['consumerhack_'],
};
const KEPT_IDENTIFIER = 'com.akhileshrangani.consumerhack';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '_generated' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function strings(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the app is called Juno everywhere a person can see or hear it', () => {
  it('has no string in src/ or convex/ that says consumerhack, apart from the kept identifiers', () => {
    const offending = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'convex'))].flatMap((path) => {
      const file = relative(ROOT, path);
      return strings(path)
        .filter((text) => OLD_NAME.test(text) && !(ALLOWED_STRINGS[file] ?? []).includes(text))
        .map((text) => `${file}: ${text}`);
    });
    expect(offending).toEqual([]);
  });

  it('names Juno in app.json where iOS shows the name, and keeps the identifiers that must not change', () => {
    const { expo } = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
    expect(expo.name).toBe(APP_NAME);
    expect(expo.scheme).toEqual(['juno', 'consumerhack']);
    expect(expo.ios.bundleIdentifier).toBe(KEPT_IDENTIFIER);
    expect(expo.android.package).toBe(KEPT_IDENTIFIER);
    const prompts: string[] = [];
    const collect = (value: unknown, key = '') => {
      if (typeof value === 'string' && /Permission$|UsageDescription$/.test(key)) prompts.push(value);
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, Array.isArray(value) ? key : k));
    };
    collect(expo);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain(APP_NAME);
      expect(prompt).not.toMatch(OLD_NAME);
    }
  });

  it("tells the voice agent that it answers to the app's name", () => {
    const prompt = buildSystemPrompt({ account: '', settings: '', memories: '', focus: '' });
    expect(prompt).toContain(`You are also called ${APP_NAME}.`);
    expect(prompt).toContain(`If they ask your name, say it is ${APP_NAME}`);
    expect(prompt).not.toMatch(OLD_NAME);
  });
});
