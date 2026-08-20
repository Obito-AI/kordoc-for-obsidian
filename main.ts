import {
  App,
  FileSystemAdapter,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  normalizePath,
} from "obsidian";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile, appendFile } from "fs/promises";
import { basename, dirname, extname, join, parse as parsePath } from "path";

interface KordocSettings {
  commandMode: "npx" | "global" | "custom";
  customCommand: string;
  customArgs: string;
  workRoot: string;
  parsedFolder: string;
  chunksFolder: string;
  redactedFolder: string;
  generatedFolder: string;
  logsFolder: string;
  openResult: boolean;
  generateChunksWithMarkdown: boolean;
  useOcrByDefault: boolean;
}

const DEFAULT_SETTINGS: KordocSettings = {
  commandMode: "npx",
  customCommand: "kordoc",
  customArgs: "",
  workRoot: ".",
  parsedFolder: "10_SOURCE",
  chunksFolder: "AI 작업/문서처리/chunks",
  redactedFolder: "AI 작업/문서처리/redacted",
  generatedFolder: "AI 작업/문서처리/generated",
  logsFolder: "AI 작업/문서처리/logs",
  openResult: true,
  generateChunksWithMarkdown: false,
  useOcrByDefault: false,
};

const PARSE_EXTENSIONS = new Set(["hwp", "hwpx", "hml", "pdf", "xls", "xlsx", "docx", "png", "jpg", "jpeg", "webp"]);

interface KordocRunResult {
  stdout: string;
  stderr: string;
}

export default class KordocForObsidianPlugin extends Plugin {
  pluginSettings: KordocSettings;
  private statusBar: HTMLElement;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KordocSettingTab(this.app, this));

    this.statusBar = this.addStatusBarItem();
    this.setStatus("kordoc ready");

    this.addRibbonIcon("file-text", "kordoc for Obsidian", async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        new Notice("kordoc: 활성 파일이 없습니다.");
        return;
      }
      await this.parseFileToMarkdown(file);
    });

    this.addCommand({
      id: "parse-current-file-to-markdown",
      name: "Parse current file to Markdown",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = Boolean(file && this.isParseable(file));
        if (checking) return ok;
        if (file) void this.parseFileToMarkdown(file);
        return true;
      },
    });

    this.addCommand({
      id: "parse-current-file-to-chunks",
      name: "Parse current file to chunks JSON",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = Boolean(file && this.isParseable(file));
        if (checking) return ok;
        if (file) void this.parseFileToChunks(file);
        return true;
      },
    });

    this.addCommand({
      id: "generate-hwpx-from-current-note",
      name: "Generate HWPX from current Markdown note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = Boolean(file && file.extension.toLowerCase() === "md");
        if (checking) return ok;
        if (file) void this.generateHwpxFromMarkdown(file);
        return true;
      },
    });

    this.addCommand({
      id: "redact-current-file",
      name: "Create redacted copy of current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = Boolean(file && this.isParseable(file));
        if (checking) return ok;
        if (file) void this.redactFile(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        if (this.isParseable(file)) {
          menu.addSeparator();
          menu.addItem((item) => {
            item.setTitle("Kordoc: Markdown으로 변환")
              .setIcon("file-text")
              .onClick(() => void this.parseFileToMarkdown(file));
          });
          menu.addItem((item) => {
            item.setTitle("Kordoc: chunks JSON 생성")
              .setIcon("braces")
              .onClick(() => void this.parseFileToChunks(file));
          });
          menu.addItem((item) => {
            item.setTitle("Kordoc: 개인정보 마스킹본 생성")
              .setIcon("shield")
              .onClick(() => void this.redactFile(file));
          });
        }
        if (file.extension.toLowerCase() === "md") {
          menu.addSeparator();
          menu.addItem((item) => {
            item.setTitle("Kordoc: 현재 노트를 HWPX로 생성")
              .setIcon("file-output")
              .onClick(() => void this.generateHwpxFromMarkdown(file));
          });
        }
      })
    );
  }

  onunload() {
    this.setStatus("kordoc unloaded");
  }

  private isParseable(file: TFile): boolean {
    return PARSE_EXTENSIONS.has(file.extension.toLowerCase());
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("kordoc for Obsidian은 Desktop 파일시스템 볼트에서만 작동합니다.");
    }
    return adapter.getBasePath();
  }

  private vaultPathToFullPath(vaultRelativePath: string): string {
    return join(this.getVaultBasePath(), vaultRelativePath);
  }

  private sanitizeFileStem(name: string): string {
    return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim();
  }

  private outputRelPath(folder: string, source: TFile, ext: string, suffix = ""): string {
    const stem = this.sanitizeFileStem(parsePath(source.name).name);
    return normalizePath(`${folder}/${stem}${suffix}${ext}`);
  }

  private async ensureVaultFolder(folder: string) {
    await mkdir(this.vaultPathToFullPath(folder), { recursive: true });
  }

  private async ensureParentForRelPath(relPath: string) {
    await mkdir(dirname(this.vaultPathToFullPath(relPath)), { recursive: true });
  }

  private getKordocCommand(): { command: string; argsPrefix: string[] } {
    if (this.pluginSettings.commandMode === "npx") {
      return {
        command: this.resolveExecutable("npx"),
        argsPrefix: ["-y", "--package", "kordoc", "--package", "pdfjs-dist", "kordoc"],
      };
    }
    if (this.pluginSettings.commandMode === "global") {
      return { command: this.resolveExecutable("kordoc"), argsPrefix: [] };
    }
    const customParts = this.splitArgs(this.pluginSettings.customArgs);
    return {
      command: this.normalizeCustomCommand(this.pluginSettings.customCommand || "kordoc"),
      argsPrefix: customParts,
    };
  }

  private normalizeCustomCommand(command: string): string {
    if (process.platform !== "win32") return command;
    const lower = command.toLowerCase().replace(/\\/g, "/");
    if (lower.endsWith("/npx") || lower.endsWith("/npx.cmd")) return this.resolveExecutable("npx");
    if (lower.endsWith("/kordoc") || lower.endsWith("/kordoc.cmd")) return this.resolveExecutable("kordoc");
    if (lower.startsWith("/usr/") || lower.startsWith("/opt/")) return this.resolveExecutable("npx");
    return command;
  }

  private resolveExecutable(name: "npx" | "kordoc"): string {
    if (process.platform === "win32") {
      // Windows resolves npm shims such as npx.cmd through PATHEXT when shell mode is enabled.
      // Returning the bare command avoids quoting problems with paths like C:\Program Files\nodejs.
      return name;
    }
    const candidates = [
      `/usr/local/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/bin/${name}`,
      `/bin/${name}`,
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? name;
  }

  private splitArgs(raw: string): string[] {
    if (!raw.trim()) return [];
    const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    return matches.map((part) => part.replace(/^(["'])(.*)\1$/, "$2"));
  }

  private runKordoc(args: string[]): Promise<KordocRunResult> {
    const { command, argsPrefix } = this.getKordocCommand();
    const cwd = this.getVaultBasePath();
    const env = {
      ...process.env,
      PATH: this.buildExecutionPath(),
      KORDOC_ROOT: this.resolveKordocRoot(),
    };
    return new Promise((resolve, reject) => {
      const finalArgs = [...argsPrefix, ...args];
      const runner = process.platform === "win32" ? "cmd.exe" : command;
      const runnerArgs = process.platform === "win32"
        ? ["/d", "/s", "/c", [command, ...finalArgs].map((arg) => this.quoteWindowsShellArg(arg)).join(" ")]
        : finalArgs;

      execFile(runner, runnerArgs, {
        cwd,
        env,
        timeout: 10 * 60 * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          const detail = [stderr, stdout, error.message].filter(Boolean).join("\n");
          reject(new Error(detail));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private quoteWindowsShellArg(arg: string): string {
    // cmd.exe receives one command string. Quote every argument so paths like
    // E:\Obsidian\...\감정으로 끝날기 만드는 법_이호철.pdf stay one file arg.
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"')}"`;
  }

  private buildExecutionPath(): string {
    const commonPaths = process.platform === "win32"
      ? ["C:\Program Files\nodejs", "C:\Program Files (x86)\nodejs"]
      : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    const currentPath = process.env.PATH ?? "";
    const delimiter = process.platform === "win32" ? ";" : ":";
    return [...commonPaths, currentPath].filter(Boolean).join(delimiter);
  }

  private resolveKordocRoot(): string {
    const root = normalizePath(this.pluginSettings.workRoot || ".");
    if (root === "." || root === "") return this.getVaultBasePath();
    return this.vaultPathToFullPath(root);
  }

  async parseFileToMarkdown(file: TFile) {
    if (!this.isParseable(file)) {
      new Notice(`kordoc: 지원하지 않는 파일입니다: ${file.name}`);
      return;
    }
    const outputRel = this.outputRelPath(this.pluginSettings.parsedFolder, file, ".md");
    const fullInput = this.vaultPathToFullPath(file.path);
    const fullOutput = this.vaultPathToFullPath(outputRel);
    await this.ensureParentForRelPath(outputRel);
    await this.ensureVaultFolder(this.pluginSettings.workRoot);

    const args = [fullInput, "--format", "markdown", "-o", fullOutput];
    if (this.pluginSettings.useOcrByDefault) args.splice(1, 0, "--ocr");
    await this.runWithNotice(`Markdown 변환 중: ${file.name}`, async () => {
      await this.runKordoc(args);
      await this.wrapMarkdownOutput(outputRel, file, "parsed");
      if (this.pluginSettings.generateChunksWithMarkdown) {
        await this.parseFileToChunks(file, false);
      }
      await this.logJob({ action: "parse-markdown", source: file.path, output: outputRel, status: "success" });
      if (this.pluginSettings.openResult) await this.openVaultFile(outputRel);
      return outputRel;
    });
  }

  async parseFileToChunks(file: TFile, openNotice = true) {
    if (!this.isParseable(file)) {
      new Notice(`kordoc: 지원하지 않는 파일입니다: ${file.name}`);
      return;
    }
    const outputRel = this.outputRelPath(this.pluginSettings.chunksFolder, file, ".chunks.json");
    const fullInput = this.vaultPathToFullPath(file.path);
    const fullOutput = this.vaultPathToFullPath(outputRel);
    await this.ensureParentForRelPath(outputRel);
    await this.ensureVaultFolder(this.pluginSettings.workRoot);

    const args = [fullInput, "--format", "chunks", "-o", fullOutput];
    if (this.pluginSettings.useOcrByDefault) args.splice(1, 0, "--ocr");
    const task = async () => {
      await this.runKordoc(args);
      await this.logJob({ action: "parse-chunks", source: file.path, output: outputRel, status: "success" });
      return outputRel;
    };
    if (openNotice) await this.runWithNotice(`chunks 생성 중: ${file.name}`, task);
    else await task();
  }

  async generateHwpxFromMarkdown(file: TFile) {
    if (file.extension.toLowerCase() !== "md") {
      new Notice("kordoc: Markdown 노트만 HWPX로 생성할 수 있습니다.");
      return;
    }
    const outputRel = this.outputRelPath(this.pluginSettings.generatedFolder, file, ".hwpx");
    const fullInput = this.vaultPathToFullPath(file.path);
    const fullOutput = this.vaultPathToFullPath(outputRel);
    await this.ensureParentForRelPath(outputRel);
    await this.ensureVaultFolder(this.pluginSettings.workRoot);

    await this.runWithNotice(`HWPX 생성 중: ${file.name}`, async () => {
      await this.runKordoc(["generate", fullInput, "-o", fullOutput]);
      await this.logJob({ action: "generate-hwpx", source: file.path, output: outputRel, status: "success" });
      await this.appendLinkToSourceNote(file, outputRel, "생성 HWPX");
      return outputRel;
    });
  }

  async redactFile(file: TFile) {
    if (!this.isParseable(file)) {
      new Notice(`kordoc: 지원하지 않는 파일입니다: ${file.name}`);
      return;
    }
    const originalExt = extname(file.name) || `.${file.extension}`;
    const outputRel = this.outputRelPath(this.pluginSettings.redactedFolder, file, originalExt, "_redacted");
    const reviewRel = this.outputRelPath(this.pluginSettings.redactedFolder, file, ".redaction-review.md", "_redacted");
    const fullInput = this.vaultPathToFullPath(file.path);
    const fullOutput = this.vaultPathToFullPath(outputRel);
    await this.ensureParentForRelPath(outputRel);
    await this.ensureVaultFolder(this.pluginSettings.workRoot);

    await this.runWithNotice(`마스킹본 생성 중: ${file.name}`, async () => {
      await this.runKordoc(["redact", fullInput, "-o", fullOutput]);
      await this.writeRedactionReview(reviewRel, file, outputRel);
      await this.logJob({ action: "redact", source: file.path, output: outputRel, review: reviewRel, status: "review-required" });
      if (this.pluginSettings.openResult) await this.openVaultFile(reviewRel);
      return outputRel;
    });
  }

  private async wrapMarkdownOutput(outputRel: string, source: TFile, status: string) {
    const fullOutput = this.vaultPathToFullPath(outputRel);
    const rawBody = await readFile(fullOutput, "utf8");
    const body = this.normalizeMarkdownAssetLinks(rawBody);
    if (body.startsWith("---\nsource_file:")) {
      if (body !== rawBody) await writeFile(fullOutput, body, "utf8");
      return;
    }
    const wrapped = `---\nsource_file: "[[${source.path}]]"\nsource_path: "${source.path}"\nparser: kordoc\nparsed_at: "${new Date().toISOString()}"\nstatus: ${status}\n---\n\n# ${parsePath(source.name).name}\n\n## 원본\n- [[${source.path}]]\n\n## 파싱 결과\n\n${body}`;
    await writeFile(fullOutput, wrapped, "utf8");
  }

  private normalizeMarkdownAssetLinks(markdown: string): string {
    return markdown.replace(/!\[image\]\((image_\d+\.png)\)/g, "![image](images/$1)");
  }

  private async writeRedactionReview(reviewRel: string, source: TFile, redactedRel: string) {
    await this.ensureParentForRelPath(reviewRel);
    const content = `---\nsource_file: "[[${source.path}]]"\nredacted_file: "[[${redactedRel}]]"\nparser: kordoc\ncreated_at: "${new Date().toISOString()}"\nstatus: 검토필요\nhuman_review_required: true\n---\n\n# 개인정보 마스킹 검토 - ${parsePath(source.name).name}\n\n- 원본: [[${source.path}]]\n- 마스킹본: [[${redactedRel}]]\n- 상태: **검토필요**\n\n> kordoc 자동 검출 결과입니다. 공개·전송 전 반드시 사람이 최종 확인하세요.\n`;
    await writeFile(this.vaultPathToFullPath(reviewRel), content, "utf8");
  }

  private async appendLinkToSourceNote(file: TFile, outputRel: string, label: string) {
    const marker = `\n\n---\n## kordoc 결과\n- ${label}: [[${outputRel}]]\n`;
    await appendFile(this.vaultPathToFullPath(file.path), marker, "utf8");
  }

  private async logJob(payload: Record<string, unknown>) {
    await this.ensureVaultFolder(this.pluginSettings.logsFolder);
    const logPath = this.vaultPathToFullPath(normalizePath(`${this.pluginSettings.logsFolder}/kordoc-jobs.jsonl`));
    await appendFile(logPath, JSON.stringify({ time: new Date().toISOString(), ...payload }) + "\n", "utf8");
  }

  private async openVaultFile(relPath: string) {
    const file = this.app.vault.getAbstractFileByPath(relPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private async runWithNotice(label: string, fn: () => Promise<string | void>) {
    this.setStatus(label);
    const start = Date.now();
    new Notice(`kordoc: ${label}`);
    try {
      const output = await fn();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.setStatus(`kordoc done (${elapsed}s)`);
      new Notice(output ? `kordoc 완료: ${output}` : "kordoc 완료");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("kordoc failed");
      new Notice(`kordoc 실패: ${message.slice(0, 300)}`, 10000);
      await this.logJob({ action: "error", label, status: "failed", error: message });
      console.error("kordoc for Obsidian failed", err);
    }
  }

  private setStatus(text: string) {
    if (this.statusBar) this.statusBar.setText(text);
  }

  async loadSettings() {
    this.pluginSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.pluginSettings);
  }
}

class KordocSettingTab extends PluginSettingTab {
  plugin: KordocForObsidianPlugin;

  constructor(app: App, plugin: KordocForObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "kordoc for Obsidian" });
    containerEl.createEl("p", {
      text: "HWP/HWPX/PDF/DOCX/XLSX/이미지를 kordoc CLI로 변환하고 결과를 볼트에 저장합니다. Desktop 전용입니다.",
      cls: "kordoc-for-obsidian-setting-muted",
    });

    new Setting(containerEl)
      .setName("kordoc 실행 방식")
      .setDesc("npx는 설치 없이 쓰기 쉽고, global/custom은 더 빠릅니다.")
      .addDropdown((dropdown) => dropdown
        .addOption("npx", "npx -y --package kordoc --package pdfjs-dist kordoc")
        .addOption("global", "kordoc")
        .addOption("custom", "사용자 지정")
        .setValue(this.plugin.pluginSettings.commandMode)
        .onChange(async (value: "npx" | "global" | "custom") => {
          this.plugin.pluginSettings.commandMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.pluginSettings.commandMode === "custom") {
      new Setting(containerEl)
        .setName("사용자 지정 명령")
        .setDesc("예: /opt/homebrew/bin/kordoc 또는 node")
        .addText((text) => text
          .setPlaceholder("kordoc")
          .setValue(this.plugin.pluginSettings.customCommand)
          .onChange(async (value) => {
            this.plugin.pluginSettings.customCommand = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName("사용자 지정 선행 인자")
        .setDesc("예: /path/to/dist/cli.js 를 node 뒤에 붙이고 싶을 때 사용합니다.")
        .addText((text) => text
          .setPlaceholder("")
          .setValue(this.plugin.pluginSettings.customArgs)
          .onChange(async (value) => {
            this.plugin.pluginSettings.customArgs = value;
            await this.plugin.saveSettings();
          }));
    }

    this.addTextSetting("작업 루트(KORDOC_ROOT)", "kordoc 파일 접근을 제한할 볼트 내부 폴더입니다. 기본값 . 은 현재 볼트 전체만 허용합니다.", "workRoot");
    this.addTextSetting("Markdown 출력 폴더", "파싱된 Markdown 노트 저장 위치", "parsedFolder");
    this.addTextSetting("chunks 출력 폴더", "RAG/구조 청크 JSON 저장 위치", "chunksFolder");
    this.addTextSetting("마스킹 출력 폴더", "redacted 파일과 검토 노트 저장 위치", "redactedFolder");
    this.addTextSetting("HWPX 생성 폴더", "Markdown에서 생성한 HWPX 저장 위치", "generatedFolder");
    this.addTextSetting("로그 폴더", "kordoc-jobs.jsonl 저장 위치", "logsFolder");

    new Setting(containerEl)
      .setName("Markdown 변환 시 chunks도 함께 생성")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.pluginSettings.generateChunksWithMarkdown)
        .onChange(async (value) => {
          this.plugin.pluginSettings.generateChunksWithMarkdown = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("OCR 기본 사용")
      .setDesc("스캔 PDF/이미지 문서가 많을 때 켜세요. 첫 실행 시 모델 다운로드가 필요할 수 있습니다.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.pluginSettings.useOcrByDefault)
        .onChange(async (value) => {
          this.plugin.pluginSettings.useOcrByDefault = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("완료 후 결과 노트 열기")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.pluginSettings.openResult)
        .onChange(async (value) => {
          this.plugin.pluginSettings.openResult = value;
          await this.plugin.saveSettings();
        }));
  }

  private addTextSetting(name: string, desc: string, key: keyof Pick<KordocSettings, "workRoot" | "parsedFolder" | "chunksFolder" | "redactedFolder" | "generatedFolder" | "logsFolder">) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => text
        .setValue(this.plugin.pluginSettings[key])
        .onChange(async (value) => {
          this.plugin.pluginSettings[key] = normalizePath(value.trim());
          await this.plugin.saveSettings();
        }));
  }
}
