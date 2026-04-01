# 変更履歴

## [0.3.0] - 2026-04-01

### 追加

- GPT-5.4 モデルを有効化
- Anthropic Claude モデルを有効化（Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5）

## [0.2.1] - 2026-03-28

### 変更

- o4-mini モデルの表示名を「GPT-o4-mini」に変更
- エラーハンドリングの詳細を改善

## [0.2.0] - 2026-03-28

### 追加

- Anthropic モデル（Claude）の基盤サポートを追加
- ツール設定を Anthropic モデルのリクエストに適切に反映

### 変更

- 温度パラメータの送信を明示的に指定された場合のみに変更

## [0.1.0] - 2026-03-27

### 追加

- 初回リリース
- 複数モデル対応（GPT-5.4, GPT-5.4 mini, GPT-5.4 nano）
- Server-Sent Events (SSE)によるストリーミングレスポンス
- ビジョン対応（画像＋テキスト入力）
- VS Codeチャット参加者向けのツール呼び出し機能
- VS Code SecretStorageによる安全なAPIキー管理
