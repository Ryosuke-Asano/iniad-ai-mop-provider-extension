# INIAD AI MOP Provider for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.104.0%2B-blue)](https://code.visualstudio.com/)

Integrates [INIAD AI MOP](https://api.openai.iniad.org/) (OpenAI-compatible API) models into VS Code Copilot Chat with vision support and tool calling.

## Features

- **Multiple Model Support**
  - **GPT-5.4**: 1M context window, up to 128K output tokens, vision support
  - **GPT-5.4 mini**: 400K context window, up to 128K output tokens, vision support
  - **GPT-5.4 nano**: 400K context window, up to 128K output tokens, vision support

- **Advanced Capabilities**
  - Tool calling support for VS Code chat participants
  - Streaming responses via Server-Sent Events (SSE)
  - Vision support for all GPT-5.4 models (text + image input)
  - Token-efficient image handling (explicit `detail: "low"` to save tokens)

- **Secure API Key Management**
  - Stored securely in VS Code SecretStorage
  - Managed via Command Palette (`INIAD: Manage INIAD AI MOP Provider`)

## About INIAD AI MOP API

INIAD provides an OpenAI-compatible API endpoint for INIAD students and faculty. The API is free to use for INIAD-related activities.

**Base URL:** `https://api.openai.iniad.org/api/v1`

### Usage Guidelines

- Use only for INIAD-related activities (work, study, internships at INIAD)
- Avoid wasting tokens; use within reasonable limits

### Getting an API Key

1. Open the INIAD 講義ワークスペース (Lecture Workspace)
2. Find the "GPT-4o mini" bot
3. Send the command: `apikey issue`
4. Copy the provided API key

## Installation

### From Source

1. Clone the repository:

```bash
git clone https://github.com/Ryosuke-Asano/iniad-ai-mop-provider-extension.git
cd iniad-ai-mop-provider-extension
```

2. Install dependencies:

```bash
npm install
```

3. Compile:

```bash
npm run compile
```

4. Press `F5` in VS Code to launch Extension Development Host

### Package

```bash
npm run package
```

## Setup

1. Install the extension
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run `INIAD: Manage INIAD AI MOP Provider`
4. Enter your INIAD API key

## Differences from Official OpenAI API

- Not all OpenAI API features are available (deprecated features excluded)
- Base URL is different: `https://api.openai.iniad.org/api/v1`
- Text Completion API `prompt` parameter is limited to `string` type
- Embeddings API `input` parameter is limited to `string` type
- Chat Completion API `image_url` without explicit `detail` is treated as `high` token consumption

## Development

```bash
# Compile
npm run compile

# Watch mode
npm run watch

# Lint
npm run lint

# Test
npm test
```

## License

[MIT](LICENSE)
