import * as vscode from "vscode";
import { tmpdir } from "os";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

type PlaygroundFile = {
  name: string;
  text: string;
};

const logger = vscode.window.createOutputChannel("Web Playground Fetcher");
logger.appendLine("Web Playground Fetcher has started");

const loadProject = async function(hash: string) {
  try {
    if (!hash) {
      return;
    }

    const data = JSON.parse(
      decompressFromEncodedURIComponent(unescape(hash))
    );


    const openEditors = vscode.window.visibleTextEditors;
    const {workspaceFolders} = vscode.workspace;
    const hasExistingWorkspace = workspaceFolders && workspaceFolders.length > 0;
    const hasExistingEditors = openEditors && openEditors.length > 0;
    const manifestFile = data.files.find((f:PlaygroundFile) => f.name === 'manifest.json')?.text
    const workspaceName = manifestFile ? JSON.parse(manifestFile).name : 'Web Extension Playground imported workspace'
    const folderPath = createTemporaryDirectoryWithFiles(data, workspaceName);

    if (!hasExistingEditors && !hasExistingWorkspace) {

      const newWorkspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file(folderPath),
        name: workspaceName,
        index: -1
      };

      await vscode.workspace.updateWorkspaceFolders(workspaceFolders ? workspaceFolders.length : 0, null, newWorkspaceFolder);
    } else {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(folderPath),
        !!hasExistingWorkspace
      )
    }
  } catch (err: any) {
    logger.appendLine(err.message);
  }
};

function createTemporaryDirectoryWithFiles({ files }: { files: PlaygroundFile[] }, workspaceName: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), `${workspaceName || "temp"}-`));

  files?.forEach((file: {
    name: string;text: any
  }) => {
    const filePath = path.join(tempDir, file.name);
    const fileContents = file.text;

    mkdirSync(path.dirname(filePath), {
      recursive: true
    });
    writeFileSync(filePath, fileContents);
  });

  return tempDir;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const prefix = "https://play.web-extensions.dev/#s=";

  const directLoad = vscode.window.registerUriHandler({
    handleUri(uri:vscode.Uri) {
      if (uri.path === '/load-project')  {
        const hash = uri.fragment.slice(2);
        loadProject(hash);
      }
    }
  });

  const fetch = vscode.commands.registerCommand(
    "web-extensions-sync.fetch",
    async () => {

      const clipboard = await vscode.env.clipboard.readText();
      let userInput;

      if (clipboard.startsWith(prefix)) {
        userInput = clipboard;
      } else {
      userInput = await vscode.window.showInputBox({
        placeHolder: `${prefix}...`,
        validateInput: (text:string) => {
          if (!text.startsWith(prefix)) {
            if (text !== "") {
              return "Invalid Playground URL";
            }
          }
        },
      });
    }

      const hash = userInput?.slice(prefix.length) ?? "";

      loadProject(hash);
    }
  );

  const generate = async () => {
      async function recreateDataObjectFromFiles(): Promise < any > {
        const files = await vscode.workspace.findFiles(
          "**/*",
          await getExcludedFilesGlob(),
          100
        );

        const data = [];

        if (files.length > 0) {
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
        }

        return data;
      }

      async function getExcludedFilesGlob(): Promise <
        vscode.RelativePattern | undefined > {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) {
            return undefined;
          }

          const gitIgnorePath = vscode.Uri.file(
            workspaceFolders[0].uri.fsPath + "/.gitignore"
          );
          const gitIgnoreExists = vscode.workspace.fs
            .stat(gitIgnorePath)
            .then((stat:any) => stat.type === vscode.FileType.File)
            .then(undefined, () => false);

          const gitIgnoreFileExists = await gitIgnoreExists;

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

      async function getManifestVersion(): Promise < void > {
        const manifestPath = path.join(
          vscode.workspace.rootPath || "",
          "manifest.json"
        );

        try {
          const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(manifestPath)
          );
          // eslint-disable-next-line @typescript-eslint/naming-convention
          let {manifest_version} = JSON.parse(content.toString());
          let version =
            manifest_version === 2 ?
            "MV2" :
            manifest_version === 3 ?
            "MV3" :
            undefined;

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

      return `${prefix}${state}`;
  };

  const copyURL = vscode.commands.registerCommand(
    "web-extensions-sync.copyURL",
   async() => {
      const playgroundURL = await generate();
      await vscode.env.clipboard.writeText(playgroundURL);
   });

   const openURL = vscode.commands.registerCommand(
    "web-extensions-sync.openURL",
   async() => {
      const playgroundURL = await generate();
      vscode.env.openExternal(vscode.Uri.parse(playgroundURL));
   });

  context.subscriptions.push(fetch, copyURL, openURL, directLoad);
}

// This method is called when your extension is deactivated
export function deactivate() {}
