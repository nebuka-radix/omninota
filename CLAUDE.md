# Claude Code 開発指示書

## プロジェクト概要

macOS上で動作する、VS Code風のGTD
（Getting Things Done）デスクトップアプリケーションを開発する。

開発にはClaude Codeを使用する。
データの永続保存先はローカルのSQLiteファイルとする。

まず以下を読むこと。

1. docs/requirements.md
2. docs/technology-decisions.md
3. docs/architecture.md
4. docs/implementation-plan.md

## 作業環境

- OS: macOS
- シェル: zsh
- エディター: VS Code
- 言語: TypeScript
- デスクトップ基盤: Electron
- UI: React

## 基本方針

- 日本語で説明・報告する。
- 既存ファイルとpackage.jsonを確認してから変更する。
- 空のプロジェクトと既存プロジェクトを区別する。
- 未確定事項を、ユーザーが承認済みの事項として扱わない。
- 未確定の技術選定は、根拠を示して承認を得る。
- 実装は小さく分割し、各段階で実行・検証する。
- 無関係なファイルを変更しない。
- 動作未確認の内容を、確認済みと報告しない。
- 不要な抽象化、過剰なフォルダー分割を避ける。
- 利用するバージョンとAPIは、公式ドキュメントと実際の
  package.json・型定義で確認する。
- 生成済みの指示書を初期化ツールで削除・上書きしない。

## 技術選定

確定・採用方針・候補の区別は
docs/technology-decisions.mdを正とする。

TanStackの以下4ライブラリは採用確定。

- @tanstack/react-query
- @tanstack/react-table
- @tanstack/react-virtual
- @tanstack/react-router

以下も採用済み。依存は実際に必要になるフェーズで導入する。

- React、MUI、lucide-react、Motion for React
- electron-vite、electron-builder
- better-sqlite3、Drizzle ORM / Drizzle Kit
- react-resizable-panels、Zod

Dockviewは初期版では採用しない。

## 実装上の境界

- RendererからSQLite、Node.jsのファイルAPI、Repositoryを直接使わない。
- DB操作と業務ルールはMain側へ置く。
- Preloadでは用途を限定したAPIを公開する。
- 任意SQLや任意IPCチャンネルを実行できるAPIを公開しない。
- IPCの入力はMain側で実行時検証する。
- TypeScriptの型だけを入力検証の代わりにしない。
- IPCの送信元・ウィンドウを検証する。
- contextIsolationを有効にし、nodeIntegrationを無効にする。
- sandboxも原則有効とし、変更が必要な場合は理由を説明する。
- sandbox付きPreloadはCJSで出力し、`electron`以外をrequireしない前提とする。
- 外部URL、ナビゲーション、新規ウィンドウの許可範囲を制限する。

## データと状態

- SQLiteを永続業務データの正本とする。
- TanStack Queryのキャッシュを永続保存の代わりにしない。
- Query、Table、Virtual、Routerの責務を分離する。
- 業務データをUI状態へ不必要に複製しない。
- タスク・プロジェクトの更新後は、関連するQueryを更新する。
- 期限の日付と、完了日時などの瞬間を区別する。
- マイグレーション、バックアップ、復元を設計する。
- 開発用・テスト用・通常利用用のDBを分離する。
- 実DB、バックアップ、ログをGitに追加しない。

## UI

- VS Code風のダークテーマを基本案とする。
- リスト・ペイン中心のコンパクトなUIとする。
- MUIのテーマに配色・密度・角丸などを集約する。
- アイコンはLucideで統一する方針とする。
- アニメーションは短く控えめにする。
- OSの「動きを減らす」設定に対応する。
- アイコンのみのボタンにはaria-labelを付ける。
- キーボード操作とフォーカス表示に対応する。
- 日本語IME変換確定のEnterでタスクを誤登録しない。
- 長時間処理には進捗・実行中・失敗状態を表示する。
- アニメーションだけで処理のブロック対策を済ませない。

## コード品質

- TypeScriptのstrictを有効にする。
- any、ts-ignoreなどの安易な使用を避ける。
- 自動生成ファイルを直接編集しない。
- DB接続などの副作用をsharedへ置かない。
- RendererからMainの実装をimportしない。
- エラーを握りつぶさず、画面表示用とログ用を整理する。
- イベント購読、タイマー、DB接続を適切に解放する。

## コマンドとGit

- コマンドはmacOS・zshで実行可能にする。
- 破壊的な初期化、削除、DBリセットを無断実行しない。
- Gitのadd、commitは、ユーザーから明示的な依頼がある場合だけ実行する。
  依頼時のコミットメッセージは簡潔な日本語とする。
- Gitのpush、履歴改変は明示的な依頼がある場合だけ行う。
- 未保存・未コミットの変更を勝手に破棄しない。
- 依存導入には、既存のパッケージマネージャーを使用する。
- 新規プロジェクトの場合はnpmを初期候補とする。

## 作業完了時の報告

1. 変更内容
2. 変更した主要ファイル
3. 実行した確認コマンドと結果
4. 未検証事項・残課題
5. 次の実装単位

テストやビルドを実行できなかった場合は、その理由を明記する。
