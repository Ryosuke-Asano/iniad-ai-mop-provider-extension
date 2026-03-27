import * as vscode from "vscode";
import { IniadVisionApiClient } from "./vision-api-client";

/**
 * Tool for analyzing images using INIAD API (GPT-4o-mini vision fallback).
 * Useful for non-vision models to process image content.
 */
export class IniadAnalyzeImageTool implements vscode.LanguageModelTool<{
  image_data: string;
  prompt: string;
}> {
  static readonly id = "iniad_analyze_image";

  readonly name = IniadAnalyzeImageTool.id;
  readonly description =
    "Analyze an image using INIAD AI MOP (GPT-5.4-nano Vision). Use this tool when you need to understand or describe the content of an image, extract text from images (OCR), or answer questions about visual content. Returns a detailed analysis of the image.";
  readonly tags = ["vision", "image", "ocr", "analysis"];

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      image_data: {
        type: "string",
        description:
          "Base64-encoded image data URL (e.g., 'data:image/png;base64,...'). The image to analyze.",
      },
      prompt: {
        type: "string",
        description:
          "The question or instruction about what to analyze in the image. Be specific about what you want to know.",
      },
    },
    required: ["image_data", "prompt"],
  };

  private readonly _visionClient: IniadVisionApiClient;

  constructor(secrets: vscode.SecretStorage) {
    this._visionClient = new IniadVisionApiClient(secrets);
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{
      image_data: string;
      prompt: string;
    }>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { image_data, prompt } = options.input;

    try {
      const result = await this._visionClient.analyzeImage(image_data, prompt);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(result),
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Failed to analyze image: ${errorMessage}`
        ),
      ]);
    }
  }

  prepareInvocation?(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<{
      image_data: string;
      prompt: string;
    }>,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Analyzing image with INIAD AI MOP Vision...",
    };
  }
}

/**
 * Register all INIAD tools with the Language Model API.
 * @param secrets VS Code secret storage for API key access
 * @returns Disposable for the tool registrations
 */
export function registerIniadTools(
  secrets: vscode.SecretStorage
): vscode.Disposable {
  const analyzeImageTool = new IniadAnalyzeImageTool(secrets);

  return vscode.Disposable.from(
    vscode.lm.registerTool(IniadAnalyzeImageTool.id, analyzeImageTool)
  );
}
