# code2prompt

Copy source files into an AI-friendly prompt and send it to your clipboard.

## Use

With a workspace open, click the **Code2Prompt** icon in the Activity Bar to open the file tree in the sidebar. Check individual files or folders, then select **Copy Selected**. Selecting a folder includes its files and subfolders.

Run **Code2Prompt: Copy Folder to Prompt** to focus the sidebar view, or **Code2Prompt: Copy Active File to Prompt** to copy the active file.

## Settings

- `code2prompt.ignorePatterns`: Folder names or paths to exclude. Defaults include `.git`, `node_modules`, `dist`, and `build`.
- `code2prompt.maxFileSizeKb`: Maximum size of each included file before its content is truncated. Default: `200` KB.

Requires VS Code 1.125 or later.
