# INCAGENT Engine — Slack-first Business Operating System

## 概要

INCAGENT エンジンは、Slack を中心に「目標 → 稟議 → 承認 → 実行 → 報告」の完全自動ループを回します。

## 最小 MVP

1. **Slack Bot** — `/business-select` で業種（光回線営業など）を選択
2. **Goal Compiler** — Claude が KPI ツリー・稟議案を生成
3. **稟議エンジン** — Slack ボタンで承認・却下
4. **実行エージェント** — 承認後、営業活動を実行（架電ログ記録）
5. **結果報告** — Slack チャンネルに成果を投げ

## セットアップ

### 1. 環境変数

```bash
cp .env.example .env
```

以下を設定：

```
SLACK_BOT_TOKEN=xoxb-...       # Slack App Token
SLACK_SIGNING_SECRET=...        # Slack Signing Secret
SLACK_APP_TOKEN=xapp-...        # Slack App-Level Token (Socket Mode)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. 依存関係

```bash
npm install
```

### 3. 実行

```bash
npm start        # 本番
npm run dev      # 開発（ファイル変更時に自動再起動）
```

## 使い方

### 1. Slack で業種を選択

```
/business-select light-fiber
```

### 2. 稟議が Slack に表示

```
[事業OS実行提案]
目標: 法人向け光回線新規成約
予算: ¥50,000
[承認] [却下]
```

### 3. 承認すると実行開始

```
✅ 実行完了: light-fiber

📊 結果:
- 架電数: 20件
- 成約数: 3件
- 売上: ¥15,000
```

## アーキテクチャ

```
Slack Bot
  ↓
Goal Compiler (Claude)
  ↓
稟議エンジン (Slack ボタン)
  ↓
実行エージェント (Call Logs)
  ↓
結果報告 (Slack チャンネル)
```

## Supabase スキーマ

- `incagent.businesses` — 業種定義（光回線、営業代行など）
- `incagent.leads` — 営業リスト
- `incagent.call_logs` — 架電ログ
- `incagent.contracts` — 契約記録

## Next Steps

1. ✅ Slack Bot スケルトン
2. ✅ 稟議エンジン（Claude 統合）
3. ⬜ 見積・契約書自動生成（docx → AI 補完 → PDF）
4. ⬜ 電子契約署名（DocuSign 連携）
5. ⬜ 広告 API 連携（Meta / Google）
6. ⬜ 経理自動分類（Supabase → freee）
