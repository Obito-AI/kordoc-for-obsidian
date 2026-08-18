# kordoc for Obsidian

**kordoc for Obsidian** is a desktop-only Obsidian plugin that connects your vault to [`kordoc`](https://github.com/chrisryugj/kordoc), a Korean document processing CLI/MCP tool for HWP/HWPX/PDF/Office/image documents.

The plugin does **not** reimplement document parsing. Instead, it provides an Obsidian-friendly bridge:

```text
Obsidian file / note
  → kordoc CLI
  → Markdown, chunks JSON, redacted copy, or generated HWPX
  → saved back into your vault
```

It is designed for people who keep research, administrative documents, reading material, public documents, scanned PDFs, or HWP/HWPX files inside an Obsidian vault and want a quick way to convert them into Markdown-based notes.

> Status: early MVP / beta. Use with copies of important documents until you trust the workflow.

---

## What this plugin can do

### Convert documents to Markdown

Right-click a supported file in Obsidian and choose:

```text
Kordoc: Markdown으로 변환
```

The plugin calls kordoc and saves a Markdown note into the configured `parsed` folder.

### Generate chunks JSON

Right-click a supported file and choose:

```text
Kordoc: chunks JSON 생성
```

This creates a `.chunks.json` file suitable for later search, RAG, or structured analysis workflows.

### Generate HWPX from a Markdown note

Right-click a Markdown note or use the command palette:

```text
Kordoc: 현재 노트를 HWPX로 생성
```

The plugin calls:

```bash
kordoc generate <note.md> -o <output.hwpx>
```

### Create a redacted copy

Right-click a supported document and choose:

```text
Kordoc: 개인정보 마스킹본 생성
```

The plugin creates:

1. a redacted output file, and
2. a review note marked `검토필요` / `human_review_required: true`.

Automatic redaction is only a helper. Always review before sharing or publishing.

### Job logging

Every successful or failed job is appended to:

```text
AI 작업/문서처리/logs/kordoc-jobs.jsonl
```

This makes it easier for another automation agent, script, or your future self to audit what happened.

---

## Supported input files

The plugin exposes kordoc actions for these extensions:

```text
.hwp
.hwpx
.hml
.pdf
.xls
.xlsx
.docx
.png
.jpg
.jpeg
.webp
```

Actual parsing quality depends on kordoc, the document format, and the source file quality.

Typical examples:

- Korean HWP/HWPX documents
- public PDFs
- scanned PDFs, with OCR option enabled
- book/report PDFs
- DOCX files
- XLS/XLSX spreadsheets
- image scans

---

## Requirements

### 1. Obsidian Desktop

This plugin is **desktop-only**.

It uses Node/Electron APIs to run a local CLI process, so it is not intended for Obsidian Mobile.

### 2. Node.js and npm

The default execution mode is:

```bash
npx -y kordoc
```

So Node.js and npm must be available to Obsidian's desktop process.

### 3. kordoc

You can use kordoc in one of three ways:

| Mode | How it runs | Good for |
|---|---|---|
| `npx -y kordoc` | Downloads/runs the package as needed | easiest setup |
| `kordoc` | Uses globally installed kordoc | faster repeated use |
| custom | Your own command and arguments | advanced/local builds |

For global installation:

```bash
npm install -g kordoc
kordoc --version
```

For more about kordoc, see:

- https://github.com/chrisryugj/kordoc
- https://www.npmjs.com/package/kordoc

---

## Installation

## Option A. Install with BRAT

This is the recommended beta installation method.

1. Install the Obsidian community plugin **BRAT**.
2. Open BRAT settings.
3. Choose **Add Beta Plugin**.
4. Paste this repository URL:

```text
https://github.com/Obito-AI/kordoc-for-obsidian
```

5. Enable **kordoc for Obsidian** in Obsidian's Community Plugins settings.

## Option B. Manual installation

Download or build these files:

```text
manifest.json
main.js
styles.css
```

Copy them into your vault:

```text
<Vault>/.obsidian/plugins/kordoc-for-obsidian/
```

Then restart Obsidian and enable the plugin.

---

## Default folder layout

By default, the plugin uses this vault-internal structure:

```text
AI 작업/문서처리/
  parsed/
  chunks/
  redacted/
  generated/
  logs/
```

You can change these paths in the plugin settings.

### Default outputs

| Action | Output |
|---|---|
| Markdown parse | `AI 작업/문서처리/parsed/<file>.md` |
| chunks parse | `AI 작업/문서처리/chunks/<file>.chunks.json` |
| redaction | `AI 작업/문서처리/redacted/<file>_redacted.<ext>` |
| redaction review note | `AI 작업/문서처리/redacted/<file>_redacted.redaction-review.md` |
| HWPX generation | `AI 작업/문서처리/generated/<note>.hwpx` |
| job log | `AI 작업/문서처리/logs/kordoc-jobs.jsonl` |

---

## Commands

Open Obsidian's command palette and search for `Kordoc`.

Available commands:

```text
Kordoc: Parse current file to Markdown
Kordoc: Parse current file to chunks JSON
Kordoc: Generate HWPX from current Markdown note
Kordoc: Create redacted copy of current file
```

The same actions are also available from the file context menu where applicable.

---

## Settings

Open:

```text
Settings → Community Plugins → kordoc for Obsidian
```

Available settings:

| Setting | Meaning |
|---|---|
| kordoc execution mode | `npx -y kordoc`, global `kordoc`, or custom command |
| custom command | path/name of a custom executable |
| custom leading args | extra args placed before plugin-generated kordoc args |
| work root | vault-relative folder used as `KORDOC_ROOT` |
| Markdown output folder | where parsed Markdown notes are saved |
| chunks output folder | where `.chunks.json` files are saved |
| redacted output folder | where redacted files and review notes are saved |
| generated HWPX folder | where generated HWPX files are saved |
| logs folder | where job JSONL logs are saved |
| generate chunks with Markdown | also create chunks when converting to Markdown |
| OCR by default | pass `--ocr` when parsing supported files |
| open result after completion | open the generated Markdown/review note |

---

## Usage examples

### Convert a PDF to Markdown

1. Put `report.pdf` in your vault.
2. Right-click it.
3. Select `Kordoc: Markdown으로 변환`.
4. Open the generated note under `AI 작업/문서처리/parsed/`.

### Convert a scanned PDF with OCR

1. Enable **OCR by default** in plugin settings.
2. Right-click the scanned PDF.
3. Select `Kordoc: Markdown으로 변환`.

Depending on kordoc, first OCR use may download local OCR model files.

### Create chunks for later AI workflows

Right-click `document.hwpx` and select:

```text
Kordoc: chunks JSON 생성
```

Output:

```text
AI 작업/문서처리/chunks/document.chunks.json
```

### Generate HWPX from a note

1. Open `draft.md`.
2. Run `Kordoc: Generate HWPX from current Markdown note`.
3. Output is saved to `AI 작업/문서처리/generated/draft.hwpx`.

### Create a redacted copy

1. Right-click a document.
2. Select `Kordoc: 개인정보 마스킹본 생성`.
3. Review both:
   - the redacted output file
   - the generated review note

Do not share the redacted copy until a human has checked it.

---

## Safety model

This plugin follows a few conservative defaults:

- It does not overwrite original documents.
- Generated files are saved into configured output folders.
- Redaction output is marked as requiring human review.
- `KORDOC_ROOT` is set to the configured work root when kordoc is called.

Important caveat: `KORDOC_ROOT` is enforced by kordoc, not by this plugin. Keep your configured work root narrow if you use the plugin with sensitive documents.

---

## Limitations

- Desktop-only; not for Obsidian Mobile.
- Requires local command execution.
- Requires Node/npm if using the default `npx` mode.
- Parsing quality depends on kordoc and document quality.
- OCR can be slower and may require model downloads.
- Redaction is not a legal/compliance guarantee; review manually.
- This plugin is an MVP and does not yet provide queue management, batch folder processing, or integrated preview rendering.

---

## Troubleshooting

### The plugin does not appear in Obsidian

Check that these files exist:

```text
<Vault>/.obsidian/plugins/kordoc-for-obsidian/manifest.json
<Vault>/.obsidian/plugins/kordoc-for-obsidian/main.js
<Vault>/.obsidian/plugins/kordoc-for-obsidian/styles.css
```

Then restart Obsidian and enable the plugin.

### `npx` or `kordoc` not found

Obsidian may not inherit the same shell `PATH` as your terminal.

Try one of these:

1. Install kordoc globally:

```bash
npm install -g kordoc
```

2. In plugin settings, choose **custom command** and provide the full path to `kordoc`, `npx`, or `node`.

On macOS, common paths include:

```text
/opt/homebrew/bin/npx
/usr/local/bin/npx
```

### OCR is slow or downloads models

This is expected on first use if kordoc needs OCR models. Disable **OCR by default** unless you mainly process scanned documents.

### Redaction finished, can I publish the file?

Not automatically. Treat redaction as `검토필요`. Check the output manually first.

---

## Development

Clone the repository:

```bash
git clone https://github.com/Obito-AI/kordoc-for-obsidian.git
cd kordoc-for-obsidian
npm install
npm run build
```

Local install for testing:

```bash
PLUGIN_DIR="/path/to/Vault/.obsidian/plugins/kordoc-for-obsidian"
mkdir -p "$PLUGIN_DIR"
cp manifest.json main.js styles.css "$PLUGIN_DIR/"
```

Then restart Obsidian and enable the plugin.

---

## Release / BRAT notes

BRAT can install this repository because the built plugin files are committed:

```text
manifest.json
main.js
styles.css
versions.json
```

When releasing a new version:

1. update `manifest.json` version,
2. update `versions.json`,
3. run `npm run build`,
4. commit `main.ts`, `main.js`, and metadata changes,
5. create a GitHub release/tag.

---

## Privacy

The plugin runs kordoc locally. It does not intentionally upload your files.

However:

- `npx -y kordoc` may contact npm to download the package if not cached.
- kordoc OCR/model behavior depends on kordoc settings and may download model files on first use.
- Review kordoc's own documentation for its network/offline behavior.

For stricter local operation, install kordoc and its models ahead of time, then use global/custom command mode.

---

## License

MIT

---

## Credits

- Built as an Obsidian bridge for [`kordoc`](https://github.com/chrisryugj/kordoc) by chrisryugj.
- Plugin scaffold and workflow by Aion & Aimyon.
