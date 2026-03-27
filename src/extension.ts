import * as vscode from "vscode";
import packageJson from "../package.json";
import { IniadChatModelProvider } from "./provider";
import { registerIniadTools } from "./tools";

// Global provider reference for API key management
let _provider: IniadChatModelProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  // Build a descriptive User-Agent to help quantify API usage
  const extVersion = (packageJson as { version?: string }).version ?? "unknown";
  const vscodeVersion = vscode.version;
  const ua = `iniad-ai-mop-vscode-chat/${extVersion} VSCode/${vscodeVersion}`;

  const provider = new IniadChatModelProvider(context.secrets, ua);
  _provider = provider;

  // Refresh model list when API key is changed outside the management command.
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === "iniad.apiKey") {
        _provider?.fireModelInfoChanged();
      }
    })
  );

  // Register the INIAD provider under the vendor id used in package.json
  const registration = vscode.lm.registerLanguageModelChatProvider(
    "iniad",
    provider
  );
  context.subscriptions.push(registration);

  console.log("[INIAD Provider] INIAD AI MOP provider registered successfully");

  // Register INIAD tools (vision analysis fallback) for Copilot to use
  const toolsRegistration = registerIniadTools(context.secrets);
  context.subscriptions.push(toolsRegistration);

  console.log("[INIAD Provider] INIAD tools registered successfully");

  // Management command to configure API key
  context.subscriptions.push(
    vscode.commands.registerCommand("iniad.manage", async () => {
      const existing = await context.secrets.get("iniad.apiKey");
      const apiKey = await vscode.window.showInputBox({
        title: "INIAD AI MOP API Key",
        prompt: existing
          ? "Update your INIAD API key"
          : "Enter your INIAD API key (obtain via 'apikey issue' command in GPT-4o mini bot)",
        ignoreFocusOut: true,
        password: true,
        value: existing ?? "",
        placeHolder: "Enter your INIAD API key...",
      });
      if (apiKey === undefined) {
        return; // user canceled
      }
      if (!apiKey.trim()) {
        await context.secrets.delete("iniad.apiKey");
        vscode.window.showInformationMessage("INIAD API key cleared.");
        _provider?.fireModelInfoChanged();
        return;
      }
      await context.secrets.store("iniad.apiKey", apiKey.trim());
      vscode.window.showInformationMessage("INIAD API key saved.");
      // Notify VS Code that the list of available models has changed
      _provider?.fireModelInfoChanged();
    })
  );

  console.log("[INIAD Provider] Extension activated");
}

export function deactivate() {
  console.log("[INIAD Provider] Extension deactivated");
  _provider = null;
}
