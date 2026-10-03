import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface FilePromptEntry {
	path: string;
	language: string;
	source: string;
}

export interface PromptSettings {
	ignorePatterns: string[];
	maxFileSizeKb: number;
}

interface ExplorerNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	children?: ExplorerNode[];
}

const DEFAULT_IGNORE_PATTERNS = [
	'.git',
	'.svn',
	'.hg',
	'node_modules',
	'dist',
	'build',
	'.next',
	'.nuxt',
	'.cache',
	'coverage',
];

export function getPromptSettings(): PromptSettings {
	const config = vscode.workspace.getConfiguration('code2prompt');
	const ignorePatterns = Array.isArray(config.get('ignorePatterns'))
		? config.get<string[]>('ignorePatterns') ?? []
		: [];
	const maxFileSizeKb = Number(config.get<number>('maxFileSizeKb') ?? 200);

	return {
		ignorePatterns: normalizeIgnorePatterns([...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns]),
		maxFileSizeKb: Number.isFinite(maxFileSizeKb) && maxFileSizeKb > 0 ? maxFileSizeKb : 200,
	};
}

export function normalizeIgnorePatterns(values: string[]): string[] {
	return values
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.length > 0);
}

export function matchesIgnorePattern(filePath: string, ignorePatterns: string[]): boolean {
	const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
	return ignorePatterns.some((pattern) => {
		if (!pattern) {
			return false;
		}

		if (normalizedPath === pattern || normalizedPath.endsWith('/' + pattern) || normalizedPath.startsWith(pattern + '/')) {
			return true;
		}

		return normalizedPath.includes('/' + pattern + '/') || normalizedPath.includes('\\' + pattern + '\\');
	});
}

export function truncateSourceForPrompt(source: string, maxBytes: number): string {
	if (maxBytes <= 0) {
		return '(file omitted because the configured size cap is zero)';
	}

	const sourceBytes = Buffer.byteLength(source, 'utf8');
	if (sourceBytes <= maxBytes) {
		return source;
	}

	const capped = source.slice(0, Math.max(0, Math.floor((maxBytes / 4) * 3)));
	return `${capped}\n\n... [truncated by code2prompt: limit ${maxBytes} bytes reached]`;
}

export function buildPromptFromSource(filePath: string, language: string, source: string): string {
	const trimmedSource = source.trim();
	if (!trimmedSource) {
		return `Here is the file: ${filePath}\n\nNo content available.`;
	}

	return [
		`Here is the file: ${filePath}`,
		'',
		'```' + language,
		trimmedSource,
		'```',
	].join('\n');
}

export function buildPromptFromFiles(files: FilePromptEntry[]): string {
	if (files.length === 0) {
		return 'Project files:\n\nNo files available.';
	}

	const sections = files.map((file) => {
		const fileText = file.source.trim();
		const source = fileText ? fileText : '(empty file)';
		return [
			`File: ${file.path}`,
			'',
			'```' + file.language,
			source,
			'```',
			'',
		].join('\n');
	});

	return ['Project files:', '', ...sections].join('\n');
}

export function buildFolderPrompt(folderPath: string, settings: PromptSettings): string {
	const entries = collectFilesFromFolder(folderPath, folderPath, settings);
	return buildPromptFromFiles(entries);
}

export function buildFoldersPrompt(folderPaths: string[], settings: PromptSettings): string {
	const entries = folderPaths.flatMap((folderPath) => {
		const folderName = path.basename(path.resolve(folderPath));
		return collectFilesFromFolder(folderPath, folderPath, settings).map((entry) => ({
			...entry,
			path: path.posix.join(folderName, entry.path),
		}));
	});
	return buildPromptFromFiles(entries);
}

export function buildPromptFromSelectedFiles(
	filePaths: string[],
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	settings: PromptSettings
): string {
	const entries: FilePromptEntry[] = [];
	const seenPaths = new Set<string>();
	const maxBytes = settings.maxFileSizeKb * 1024;

	for (const filePath of filePaths) {
		const absolutePath = path.resolve(filePath);
		const normalizedPath = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath;
		if (seenPaths.has(normalizedPath) || shouldIgnoreFile(absolutePath, settings.ignorePatterns)) {
			continue;
		}

		const workspaceFolder = workspaceFolders.find((folder) => {
			const relativePath = path.relative(folder.uri.fsPath, absolutePath);
			return relativePath !== '' && relativePath !== '..'
				&& !relativePath.startsWith('..' + path.sep)
				&& !path.isAbsolute(relativePath);
		});
		if (!workspaceFolder) {
			continue;
		}

		try {
			if (!fs.statSync(absolutePath).isFile()) {
				continue;
			}
			const relativePath = path.relative(workspaceFolder.uri.fsPath, absolutePath).replace(/\\/g, '/');
			entries.push({
				path: path.posix.join(workspaceFolder.name, relativePath),
				language: getLanguageFromFileName(absolutePath),
				source: truncateSourceForPrompt(fs.readFileSync(absolutePath, 'utf-8'), maxBytes),
			});
			seenPaths.add(normalizedPath);
		} catch {
			continue;
		}
	}

	return buildPromptFromFiles(entries);
}

async function copyActiveFileToPrompt(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active file to convert.');
		return;
	}

	const document = editor.document;
	const filePath = document.uri.fsPath;
	const language = document.languageId || 'text';
	const source = document.getText();
	const prompt = buildPromptFromSource(filePath, language, source);

	await vscode.env.clipboard.writeText(prompt);
	vscode.window.showInformationMessage(`Copied ${document.fileName} to the clipboard as a prompt.`);
}

function shouldIgnoreFile(fileName: string, ignorePatterns: string[]): boolean {
	const normalizedFileName = fileName.replace(/\\/g, '/').toLowerCase();
	return ignorePatterns.some((pattern) => {
		if (!pattern) {
			return false;
		}

		const normalizedPattern = pattern.replace(/\\/g, '/').toLowerCase();
		return normalizedFileName === normalizedPattern
			|| normalizedFileName.endsWith('/' + normalizedPattern)
			|| normalizedFileName.includes('/' + normalizedPattern + '/')
			|| normalizedFileName.split('/').includes(normalizedPattern);
	});
}

function getLanguageFromFileName(fileName: string): string {
	const extensionMap: Record<string, string> = {
		'.ts': 'typescript',
		'.tsx': 'typescript',
		'.js': 'javascript',
		'.jsx': 'javascript',
		'.json': 'json',
		'.md': 'markdown',
		'.css': 'css',
		'.html': 'html',
		'.py': 'python',
		'.java': 'java',
		'.cs': 'csharp',
		'.yaml': 'yaml',
		'.yml': 'yaml',
		'.xml': 'xml',
	};

	return extensionMap[path.extname(fileName).toLowerCase()] || 'text';
}

function collectFilesFromFolder(rootPath: string, folderPath: string, settings: PromptSettings): FilePromptEntry[] {
	const entries: FilePromptEntry[] = [];
	const children = fs.readdirSync(folderPath, { withFileTypes: true });
	const maxBytes = settings.maxFileSizeKb * 1024;

	for (const child of children) {
		const childPath = path.join(folderPath, child.name);
		if (child.isDirectory()) {
			if (shouldIgnoreFile(childPath, settings.ignorePatterns)) {
				continue;
			}
			entries.push(...collectFilesFromFolder(rootPath, childPath, settings));
			continue;
		}

		if (child.isFile()) {
			const fileContents = fs.readFileSync(childPath, 'utf-8');
			const boundedSource = truncateSourceForPrompt(fileContents, maxBytes);
			entries.push({
				path: path.relative(rootPath, childPath).replace(/\\/g, '/'),
				language: getLanguageFromFileName(child.name),
				source: boundedSource,
			});
		}
	}

	return entries;
}

function collectExplorerChildren(folderPath: string, settings: PromptSettings): ExplorerNode[] {
	let children: fs.Dirent[];
	try {
		children = fs.readdirSync(folderPath, { withFileTypes: true });
	} catch {
		return [];
	}

	return children
		.filter((child) => !shouldIgnoreFile(path.join(folderPath, child.name), settings.ignorePatterns))
		.sort((left, right) => {
			if (left.isDirectory() !== right.isDirectory()) {
				return left.isDirectory() ? -1 : 1;
			}
			return left.name.localeCompare(right.name);
		})
		.flatMap<ExplorerNode>((child) => {
			const childPath = path.join(folderPath, child.name);
			if (child.isDirectory()) {
				return [{ name: child.name, path: childPath, type: 'folder' as const, children: collectExplorerChildren(childPath, settings) }];
			}
			if (child.isFile()) {
				return [{ name: child.name, path: childPath, type: 'file' as const }];
			}
			return [];
		});
}

function getNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function getExplorerHtml(roots: ExplorerNode[]): string {
	const nonce = getNonce();
	const safeRoots = JSON.stringify(roots).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Select Files and Folders</title>
	<style>
		:root { color-scheme: light dark; }
		body { padding: 0 20px 20px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
		main { max-width: 900px; margin: 0 auto; }
		.toolbar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px; padding: 14px 0; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
		h1 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
		button { min-height: 28px; padding: 4px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { color: var(--vscode-foreground); background: transparent; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); }
		#count { color: var(--vscode-descriptionForeground); white-space: nowrap; }
		#tree { padding: 10px 0; }
		details { margin: 0; }
		summary, .file-row { display: flex; align-items: center; min-height: 26px; gap: 7px; padding: 1px 6px; border-radius: 3px; list-style: none; }
		summary { cursor: pointer; }
		summary::-webkit-details-marker { display: none; }
		summary:hover, .file-row:hover { background: var(--vscode-list-hoverBackground); }
		.tree-children { margin-left: 15px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border)); }
		input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; margin: 0 2px 0 0; accent-color: var(--vscode-checkbox-background); }
		.disclosure { width: 12px; color: var(--vscode-descriptionForeground); font-size: 12px; text-align: center; }
		details:not([open]) > summary .disclosure::before { content: '›'; }
		details[open] > summary .disclosure::before { content: '⌄'; }
		.file-row .disclosure { visibility: hidden; }
		.kind { width: 14px; height: 12px; box-sizing: border-box; flex: 0 0 auto; opacity: .85; }
		.kind.folder { position: relative; height: 9px; margin-top: 3px; border: 1px solid var(--vscode-symbolIcon-folderForeground, #dcb67a); border-radius: 2px; background: color-mix(in srgb, var(--vscode-symbolIcon-folderForeground, #dcb67a) 22%, transparent); }
		.kind.folder::before { position: absolute; top: -4px; left: 0; width: 6px; height: 3px; content: ''; border: 1px solid var(--vscode-symbolIcon-folderForeground, #dcb67a); border-bottom: 0; border-radius: 2px 2px 0 0; }
		.kind.file { width: 10px; height: 13px; border: 1px solid var(--vscode-descriptionForeground); border-radius: 1px; }
		.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		#empty { padding: 16px 8px; color: var(--vscode-descriptionForeground); }
		@media (max-width: 520px) { body { padding: 0 10px 14px; } .toolbar { flex-wrap: wrap; } h1 { flex-basis: 100%; } #count { flex: 1; } }
	</style>
</head>
<body>
	<main>
		<header class="toolbar">
			<h1>Select files and folders</h1>
			<span id="count" aria-live="polite">0 files selected</span>
			<button id="select-all" class="secondary" type="button">Select All</button>
			<button id="clear" class="secondary" type="button">Clear</button>
			<button id="copy" type="button" disabled>Copy Selected</button>
		</header>
		<div id="tree" role="tree"></div>
		<div id="empty" hidden>No files found in the open workspace folders.</div>
	</main>
	<script nonce="${nonce}">
		const roots = ${safeRoots};
		const vscode = acquireVsCodeApi();
		const tree = document.getElementById('tree');
		function createEntry(node, depth) {
			const isFolder = node.type === 'folder';
			const container = document.createElement(isFolder ? 'details' : 'div');
			if (isFolder) container.open = depth === 0;
			const row = document.createElement(isFolder ? 'summary' : 'div');
			row.className = isFolder ? 'folder-row' : 'file-row';
			const disclosure = document.createElement('span');
			disclosure.className = 'disclosure';
			disclosure.setAttribute('aria-hidden', 'true');
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.setAttribute('aria-label', (isFolder ? 'Select folder ' : 'Select file ') + node.name);
			checkbox.dataset.type = node.type;
			checkbox.dataset.path = node.path;
			checkbox.addEventListener('click', (event) => event.stopPropagation());
			const icon = document.createElement('span');
			icon.className = 'kind ' + node.type;
			icon.setAttribute('aria-hidden', 'true');
			const name = document.createElement('span');
			name.className = 'name';
			name.textContent = node.name;
			row.append(disclosure, checkbox, icon, name);
			container.append(row);
			if (isFolder) {
				const childList = document.createElement('div');
				childList.className = 'tree-children';
				for (const child of node.children || []) childList.append(createEntry(child, depth + 1));
				container.append(childList);
			}
			checkbox.addEventListener('change', () => {
				if (isFolder) {
					for (const descendant of container.querySelectorAll('input[type="checkbox"]')) {
						descendant.checked = checkbox.checked;
						descendant.indeterminate = false;
					}
				}
				updateAncestors(container);
				updateCount();
			});
			return container;
		}
		function updateAncestors(item) {
			let parent = item.closest('details');
			if (item === parent) parent = parent.parentElement.closest('details');
			while (parent) {
				const childList = parent.querySelector(':scope > .tree-children');
				const states = Array.from(childList.children, (child) => {
					const input = child.matches('details')
						? child.querySelector(':scope > summary > input')
						: child.querySelector('input');
					return { checked: input.checked, partial: input.indeterminate };
				});
				const input = parent.querySelector(':scope > summary > input');
				input.checked = states.length > 0 && states.every((state) => state.checked && !state.partial);
				input.indeterminate = states.some((state) => state.partial) || (states.some((state) => state.checked) && !input.checked);
				parent = parent.parentElement.closest('details');
			}
		}
		function updateCount() {
			const count = tree.querySelectorAll('input[data-type="file"]:checked').length;
			document.getElementById('count').textContent = count + (count === 1 ? ' file selected' : ' files selected');
			document.getElementById('copy').disabled = count === 0;
		}
		for (const root of roots) tree.append(createEntry(root, 0));
		document.getElementById('empty').hidden = tree.querySelectorAll('input[data-type="file"]').length > 0;
		document.getElementById('select-all').addEventListener('click', () => {
			for (const input of tree.querySelectorAll('input[type="checkbox"]')) { input.checked = true; input.indeterminate = false; }
			updateCount();
		});
		document.getElementById('clear').addEventListener('click', () => {
			for (const input of tree.querySelectorAll('input[type="checkbox"]')) { input.checked = false; input.indeterminate = false; }
			updateCount();
		});
		document.getElementById('copy').addEventListener('click', () => {
			const paths = Array.from(tree.querySelectorAll('input[data-type="file"]:checked'), (input) => input.dataset.path);
			vscode.postMessage({ type: 'copy', paths });
		});
	</script>
</body>
</html>`;
}

async function copyFolderToPrompt(): Promise<void> {
	await vscode.commands.executeCommand('workbench.view.extension.code2prompt');
}

class FileExplorerViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		this.refresh();
		webviewView.webview.onDidReceiveMessage(async (message: { type?: string; paths?: unknown }) => {
		if (message.type !== 'copy' || !Array.isArray(message.paths)) {
			return;
		}
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		const selectedPaths = message.paths.filter((filePath): filePath is string => typeof filePath === 'string');
		const prompt = buildPromptFromSelectedFiles(selectedPaths, workspaceFolders, getPromptSettings());
		await vscode.env.clipboard.writeText(prompt);
		vscode.window.showInformationMessage(`Copied ${selectedPaths.length} selected file${selectedPaths.length === 1 ? '' : 's'} to the clipboard as a prompt.`);
		});
	}

	refresh(): void {
		if (!this.view) {
			return;
		}

		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		const settings = getPromptSettings();
		const roots: ExplorerNode[] = workspaceFolders.map((folder) => ({
			name: folder.name,
			path: folder.uri.fsPath,
			type: 'folder',
			children: collectExplorerChildren(folder.uri.fsPath, settings),
		}));
		this.view.webview.html = getExplorerHtml(roots);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const fileDisposable = vscode.commands.registerCommand('code2prompt.copyActiveFileToPrompt', copyActiveFileToPrompt);
	const folderDisposable = vscode.commands.registerCommand('code2prompt.copyFolderToPrompt', copyFolderToPrompt);
	const explorerProvider = new FileExplorerViewProvider();
	const viewDisposable = vscode.window.registerWebviewViewProvider('code2prompt.fileExplorer', explorerProvider);
	const workspaceDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => explorerProvider.refresh());
	context.subscriptions.push(fileDisposable, folderDisposable, viewDisposable, workspaceDisposable);
}

export function deactivate() {}
