import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	buildFolderPrompt,
	buildFoldersPrompt,
	buildPromptFromSelectedFiles,
	buildPromptFromFiles,
	buildPromptFromSource,
	matchesIgnorePattern,
	truncateSourceForPrompt,
} from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('buildPromptFromSource includes the file path and code content', () => {
		const prompt = buildPromptFromSource('src/example.ts', 'typescript', 'const value = 42;\nconsole.log(value);');

		assert.ok(prompt.includes('src/example.ts'));
		assert.ok(prompt.includes('const value = 42;'));
		assert.ok(prompt.includes('console.log(value);'));
		assert.ok(prompt.includes('```typescript'));
	});

	test('buildPromptFromFiles includes multiple files and their contents', () => {
		const prompt = buildPromptFromFiles([
			{ path: 'src/app.ts', language: 'typescript', source: 'export const x = 1;' },
			{ path: 'src/utils.ts', language: 'typescript', source: 'export const y = 2;' },
		]);

		assert.ok(prompt.includes('Project files'));
		assert.ok(prompt.includes('src/app.ts'));
		assert.ok(prompt.includes('src/utils.ts'));
		assert.ok(prompt.includes('export const x = 1;'));
		assert.ok(prompt.includes('export const y = 2;'));
	});

	test('matchesIgnorePattern recognizes ignored folder names', () => {
		assert.strictEqual(matchesIgnorePattern('src/node_modules/lib.js', ['node_modules']), true);
		assert.strictEqual(matchesIgnorePattern('src/app.ts', ['node_modules']), false);
	});

	test('truncateSourceForPrompt preserves content but adds a truncation notice', () => {
		const largeSource = 'A'.repeat(2000);
		const truncated = truncateSourceForPrompt(largeSource, 256);

		assert.ok(truncated.includes('... [truncated by code2prompt'));
		assert.notStrictEqual(truncated, largeSource);
	});

	test('buildFolderPrompt reads a selected folder and excludes ignored files', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code2prompt-'));
		const appPath = path.join(tempRoot, 'src', 'app.ts');
		const ignoredPath = path.join(tempRoot, 'node_modules', 'ignored.js');

		fs.mkdirSync(path.dirname(appPath), { recursive: true });
		fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
		fs.writeFileSync(appPath, 'export const app = true;');
		fs.writeFileSync(ignoredPath, 'console.log("ignored")');

		const prompt = buildFolderPrompt(tempRoot, { ignorePatterns: ['node_modules'], maxFileSizeKb: 200 });

		assert.ok(prompt.includes('src/app.ts'));
		assert.ok(prompt.includes('export const app = true;'));
		assert.ok(!prompt.includes('ignored.js'));
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	test('buildFoldersPrompt combines selected folders with folder-prefixed paths', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code2prompt-'));
		const firstFolder = path.join(tempRoot, 'first');
		const secondFolder = path.join(tempRoot, 'second');
		fs.mkdirSync(firstFolder);
		fs.mkdirSync(secondFolder);
		fs.writeFileSync(path.join(firstFolder, 'app.ts'), 'export const first = true;');
		fs.writeFileSync(path.join(secondFolder, 'app.ts'), 'export const second = true;');

		const prompt = buildFoldersPrompt([firstFolder, secondFolder], { ignorePatterns: [], maxFileSizeKb: 200 });

		assert.ok(prompt.includes('first/app.ts'));
		assert.ok(prompt.includes('second/app.ts'));
		assert.ok(prompt.includes('export const first = true;'));
		assert.ok(prompt.includes('export const second = true;'));
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	test('buildPromptFromSelectedFiles includes only selected files inside the workspace', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code2prompt-'));
		const selectedPath = path.join(tempRoot, 'src', 'selected.ts');
		const unselectedPath = path.join(tempRoot, 'src', 'unselected.ts');
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code2prompt-outside-'));
		const outsidePath = path.join(outsideRoot, 'outside.ts');
		fs.mkdirSync(path.dirname(selectedPath), { recursive: true });
		fs.writeFileSync(selectedPath, 'export const selected = true;');
		fs.writeFileSync(unselectedPath, 'export const unselected = true;');
		fs.writeFileSync(outsidePath, 'export const outside = true;');
		const workspaceFolder = { name: 'project', uri: vscode.Uri.file(tempRoot), index: 0 };

		const prompt = buildPromptFromSelectedFiles(
			[selectedPath, outsidePath],
			[workspaceFolder],
			{ ignorePatterns: [], maxFileSizeKb: 200 }
		);

		assert.ok(prompt.includes('project/src/selected.ts'));
		assert.ok(prompt.includes('export const selected = true;'));
		assert.ok(!prompt.includes('unselected.ts'));
		assert.ok(!prompt.includes('outside.ts'));
		fs.rmSync(tempRoot, { recursive: true, force: true });
		fs.rmSync(outsideRoot, { recursive: true, force: true });
	});
});
