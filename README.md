# INIAD AI MOP Provider for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.104.0%2B-blue)](https://code.visualstudio.com/)

[INIAD AI MOP](https://api.openai.iniad.org/)（OpenAI互換API）のモデルをVS Code Copilot Chatに統合します。ビジョン機能とツール呼び出しに対応しています。

## 機能

- **複数モデル対応**
  - **GPT-5.4**: 100万トークンのコンテキストウィンドウ、最大128K出力トークン、ビジョン対応
  - **GPT-5.4 mini**: 40万トークンのコンテキストウィンドウ、最大128K出力トークン、ビジョン対応
  - **GPT-5.4 nano**: 40万トークンのコンテキストウィンドウ、最大128K出力トークン、ビジョン対応

- **高度な機能**
  - VS Codeチャット参加者向けのツール呼び出し機能
  - Server-Sent Events (SSE)によるストリーミングレスポンス
  - すべてのGPT-5.4モデルでビジョン対応（テキスト＋画像入力）
  - トークン効率的な画像処理（`detail: "low"`でトークンを節約）

- **安全なAPIキー管理**
  - VS Code SecretStorageに安全に保存
  - コマンドパレットから管理（`INIAD: Manage INIAD AI MOP Provider`）

## INIAD AI MOP APIについて

INIADは、INIADの学生と教職員向けにOpenAI互換のAPIエンドポイントを提供しています。INIAD関連の活動であれば無料で使用できます。

**ベースURL:** `https://api.openai.iniad.org/api/v1`

### 利用ガイドライン

- INIAD関連の活動（INIADでの作業、学習、インターンシップ）でのみ使用してください
- トークンの無駄遣いを避け、合理的な範囲内で使用してください

### APIキーの取得方法

1. INIAD 講義ワークスペースを開く
2. 「GPT-4o mini」ボットを見つける
3. コマンド `apikey issue` を送信
4. 提供されたAPIキーをコピー

## インストール

### ソースからビルド

1. リポジトリをクローン:

```bash
git clone https://github.com/Ryosuke-Asano/iniad-ai-mop-provider-extension.git
cd iniad-ai-mop-provider-extension
```

2. 依存関係をインストール:

```bash
npm install
```

3. コンパイル:

```bash
npm run compile
```

4. VS Codeで `F5` を押して拡張機能開発ホストを起動

### パッケージ化

```bash
npm run package
```

## セットアップ

1. 拡張機能をインストール
2. コマンドパレットを開く（`Ctrl+Shift+P` / `Cmd+Shift+P`）
3. `INIAD: Manage INIAD AI MOP Provider` を実行
4. INIAD APIキーを入力

## 公式OpenAI APIとの違い

- すべてのOpenAI API機能が利用できるわけではありません（非推奨機能は除外）
- ベースURLが異なります: `https://api.openai.iniad.org/api/v1`
- Text Completion APIの `prompt` パラメータは `string` 型のみ
- Embeddings APIの `input` パラメータは `string` 型のみ
- Chat Completion APIで `image_url` に明示的な `detail` がない場合、`high` トークン消費として扱われます

## 開発

```bash
# コンパイル
npm run compile

# ウォッチモード
npm run watch

# Lint
npm run lint

# テスト
npm test
```

## ライセンス

[MIT](LICENSE)
