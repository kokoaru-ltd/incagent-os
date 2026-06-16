# 受電代行 求人リード生成

受電オペレーターを募集している求人を、受電代行の営業リードとして取り込む。
狙うのは「自社で受電を抱えている事業会社」。派遣、人材紹介、BPO、求人媒体は落とす。

```bash
cd apps/engine

# dry-run: Indeed検索URLからCSV出力
npm run leads:reception -- --query "電話受付 受電 オペレーター" --location "東京" --limit 20 --out output/reception_leads.csv

# 保存済みCSV/JSON/HTMLから抽出
npm run leads:reception -- --input output/indeed_reception_jobs.csv --json

# Supabaseへ投入
npm run leads:reception -- --input output/indeed_reception_jobs.csv --insert --business-id inbound-agent
```

DBは `reception_leads` を優先する。テーブルが無い環境では既存 `leads` にフォールバックする。
本番では `apps/engine/supabase/migrations/0001_reception_leads.sql` を先に適用する。
