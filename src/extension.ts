import * as vscode from "vscode";
import { tmpdir } from "os";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

function createTemporaryDirectoryWithFiles(files:  any[] ) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "temp-"));

  files.forEach((file: { name: string; text: any }) => {
    const filePath = path.join(tempDir, file.name);
    const fileContents = file.text;

    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, fileContents);
  });

  return tempDir;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const prefix = "https://play.web-extensions.dev/#s=";

  const logger = vscode.window.createOutputChannel("Web Playground Fetcher");

  const fetch = vscode.commands.registerCommand(
    "web-playground-sync.fetch",
    async () => {
      const userInput = await vscode.window.showInputBox({
        placeHolder: `${prefix}...`,
        validateInput: (text) => {
          if (!text.startsWith(prefix)) {
            if (text !== "") {
              return "Not 123!";
            }
          }
        },
      });

      const hash = userInput?.slice(prefix.length) || "";
      const data = JSON.parse(
        decompressFromEncodedURIComponent(unescape(hash))
      );

      const folderPath = createTemporaryDirectoryWithFiles(data);
      vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(folderPath),
        true
      );
    }
  );

  const generate = vscode.commands.registerCommand(
    "web-playground-sync.generate",
    async () => {
      async function recreateDataObjectFromFiles(): Promise<any> {
        const files = await vscode.workspace.findFiles(
          "**/*",
          await getExcludedFilesGlob(),
          100
        );

        const data = [];

        for (const file of files) {
          const document = await vscode.workspace.openTextDocument(file);
          const text = document.getText();

          const relativePath = vscode.workspace.asRelativePath(file);
          const fileEntry = {
            name: relativePath,
            text: text,
          };

          data.push(fileEntry);
        }

        return data;
      }

      async function getExcludedFilesGlob(): Promise<
        vscode.RelativePattern | undefined
      > {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          return undefined;
        }

        const gitIgnorePath = vscode.Uri.file(
          workspaceFolders[0].uri.fsPath + "/.gitignore"
        );
        const gitIgnoreExists = vscode.workspace.fs
          .stat(gitIgnorePath)
          .then((stat) => stat.type === vscode.FileType.File)
          .then(undefined, () => false); // Error handling for failure case

        const gitIgnoreFileExists = await gitIgnoreExists; // Await the promise

        if (gitIgnoreFileExists) {
          if (vscode.window.activeTextEditor) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(
              vscode.window.activeTextEditor.document.uri
            );
            if (workspaceFolder) {
              return new vscode.RelativePattern(workspaceFolder, ".gitignore");
            }
          }
        }
      }

      async function getManifestVersion(): Promise<void> {
        const manifestPath = path.join(
          vscode.workspace.rootPath || "",
          "manifest.json"
        );

        try {
          const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(manifestPath)
          );
          // eslint-disable-next-line @typescript-eslint/naming-convention
          let { manifest_version } = JSON.parse(content.toString());
          let version =
            manifest_version === 2
              ? "MV2"
              : manifest_version === 3
              ? "MV3"
              : undefined;

          return; // Return early on success
        } catch (err: any) {
          showInvalidExtensionProjectError(err);
        }
      }

      function showInvalidExtensionProjectError(err: Error): void {
        logger.appendLine(err.message);
        vscode.window.showErrorMessage("Not a valid extension project");
      }

      const files = await recreateDataObjectFromFiles();
      const manifestVersion = await getManifestVersion();

      const stateObj = {
        files,
        browser: "Chrome",
        manifestVersion,
        includePolyfill: false,
        templateId: "helloWorld",
      };

      const state = compressToEncodedURIComponent(JSON.stringify(stateObj));
      logger.appendLine(JSON.stringify(stateObj));

      logger.appendLine(`${prefix}${state}`);
    }
  );

  context.subscriptions.push(fetch, generate);
}

// This method is called when your extension is deactivated
export function deactivate() {}
