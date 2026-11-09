# Claude Codeへの開始指示

以下をClaude Codeへ入力する。

---

CLAUDE.mdとdocs内の指示書を読み、
このリポジトリの現状を確認してください。

今回はmacOS向けのVS Code風GTDアプリを開発します。
開発はClaude Codeで進めます。

まずアプリの生成や依存関係のインストールを行わず、
次の内容を日本語で報告してください。

1. 既存ファイルと現在のプロジェクト状態
2. 確定済み技術の整理
3. 未確定の技術選定と、推奨する組み合わせ
4. 初期版の最小構成
5. 最初に実装・検証する単位
6. 実装前に確認が必要な事項

TanStack Query、Table、Virtual、Routerは採用確定です。
MUI、Lucide、Motionを組み込む構成を検討しています。

electron-vite、electron-builder、Drizzle ORM、
better-sqlite3、ペイン配置ライブラリは候補として扱い、
確定扱いする前に確認してください。

既存のCLAUDE.md、docs、setup.shを保持してください。
承認後はimplementation-plan.mdの順序で、
小さな単位に分けて実装・検証してください。

Gitのcommit、push、破壊的な操作は行わないでください。

---
