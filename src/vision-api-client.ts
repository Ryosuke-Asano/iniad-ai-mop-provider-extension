import * as vscode from "vscode";

/**
 * INIAD AI MOP Vision API Client for image analysis fallback on non-vision models.
 */
export class IniadVisionApiClient {
  private apiKey: string;

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.apiKey = "";
  }

  /**
   * Initialize the client with API key from secrets
   */
  private async ensureApiKey(): Promise<boolean> {
    if (!this.apiKey) {
      this.apiKey = (await this.secrets.get("iniad.apiKey")) ?? "";
    }
    return !!this.apiKey;
  }

  /**
   * Analyze an image using a vision-capable model (GPT-5.4-nano) via the INIAD API.
   * This is used as a fallback for non-vision models to add image processing capabilities.
   * @param imageData Base64-encoded image (data URL format)
   * @param prompt What to analyze in the image
   * @returns Image analysis result
   */
  async analyzeImage(imageData: string, prompt: string): Promise<string> {
    if (!(await this.ensureApiKey())) {
      throw new Error("INIAD API key not found");
    }

    const response = await fetch(
      "https://api.openai.iniad.org/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5.4-nano",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: imageData, detail: "low" },
                },
              ],
            },
          ],
          max_completion_tokens: 2000,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const result =
      data.choices?.[0]?.message?.content ?? "Failed to analyze image";
    return result;
  }
}
