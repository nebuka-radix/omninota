# 技術選定と承認状況

## 1. 明示的に確定した技術

| 分野 | 技術 |
|---|---|
| 開発OS | macOS |
| エディター | VS Code |
| 開発支援 | Claude Code |
| 言語 | TypeScript |
| デスクトップ基盤 | Electron |
| 永続保存 | SQLiteファイル |
| 非同期データ管理 | @tanstack/react-query |
| テーブルロジック | @tanstack/react-table |
| 仮想スクロール | @tanstack/react-virtual |
| ルーティング | @tanstack/react-router |

## 2. フェーズ0で承認された技術

依存は、実際に必要になるフェーズで導入する。

| 分野 | 技術 | 導入フェーズ |
|---|---|---|
| UI基盤 | React | 1 |
| UIコンポーネント | MUI | 1 |
| アイコン | lucide-react | 1 |
| アニメーション | motion / motion/react | 1 |
| IPC入力の実行時検証 | Zod | 1 |
| 開発・ビルド | electron-vite | 1 |
| パッケージ化 | electron-builder | 2 |
| DBドライバー | better-sqlite3 | 2 |
| ORM・マイグレーション | Drizzle ORM / Drizzle Kit | 2 |
| 固定ペイン | react-resizable-panels（v4。Group / Panel / Separator） | 3 |
| テーブル・仮想スクロール | TanStack Table v9（@tanstack/react-table・table-core 9.3.1）/ Virtual 3.14.26 | 4 |

Drizzleは素のSQLとの再比較を行わず採用する。
better-sqlite3のNode-API対応、同梱バイナリ、Electron向け再ビルドの要否は、
フェーズ2で採用版の実体と公式情報を確認し、
開発起動とパッケージ化後の両方で検証してから確定扱いにする。

### Router

- コードベースのルート定義とする（router-pluginと生成ファイルは使わない）。
- 履歴はハッシュ方式（createHashHistory）とする。
- 開発時は開発サーバーのURL、ビルド後はローカルのindex.htmlを読み込む。

### 開発用の仮名称

最終的な公開名とは区別する。定義はsrc/shared/app-identity.tsに集約する。

| 項目 | 値 |
|---|---|
| 表示名 | GTD |
| package名 | gtd-desktop |
| アプリID | com.radix-studio.gtd |

## 3. 未確定・不採用

| 分野 | 状況 | 補足 |
|---|---|---|
| ドッキング | Dockviewは初期版で不採用 | 自由なタブ分割が必要になった時に再検討 |
| UI状態保存 | app_settingsテーブル（フェーズ3で実装） | 分類ごとの行・バージョン付きJSON。詳細は docs/database.md |
| UI状態管理 | React Context / Reducer | 状態管理ライブラリは導入しない |
| Table v9 の選定 | 9.3.1（2026-08に安定版、latest） | パッケージ同梱の版対応ガイドと型定義に合わせて実装。v8（最終2025-04）のサンプルは使わない |
| @tanstack/table-core | devDependencies に明示（react-tableが固定で依存する同じ版） | Reactを使わないテストで `storeReactivityBindings` を使うため |
| 一覧の意味付け | listbox / option（1件選択） | 表（grid）とセル単位の操作は、必要になった時に再検討する |
| テスト | vitest（フェーズ2で導入） | ホストNode.jsで実行。Electron内の動作確認は別に行う。E2Eツールは未選定 |
| ネイティブ再ビルド | 不採用（@electron/rebuildなし、npmRebuild: false） | better-sqlite3 v13のNode-APIバイナリをElectron 44で読み込めることを確認済み（docs/database.md） |
| 配布CPU | 当面はIntel Mac（x64）で確認 | arm64・universalは後続で判断 |

## 4. 選定時の注意

- SQLiteファイルを使うことは、npmのsqlite3採用を意味しない。
- node:sqliteも比較候補だが、Electron内蔵Node.jsとの互換性を確認する。
- better-sqlite3採用時は、Electron ABI、CPUアーキテクチャ、
  ネイティブ再ビルド、ASAR設定を検証する。
- MUI XのCommunityとProの機能・ライセンスを区別する。
- 商用ライブラリを無断導入しない。
- Motionの追加有料機能を前提にしない。
- shadcn/uiは必須ではない。MUIと同じ役割の部品を混在させない。
- ResizableとDockviewを同じ領域へ理由なく重ねない。
- TanStack4ライブラリ以外を、名前が近いだけで追加採用しない。
- TanStack DB、Start、Form、Storeは未採用。

## 5. バージョン管理方針

具体的なバージョン番号は、この指示書では固定しない。
初期化時に公式情報、peerDependencies、Electronの内蔵Node.jsを確認する。
動作確認した組み合わせをpackage.jsonとロックファイルに記録する。

- 安定版を使う。alpha、beta、rcは無断で採用しない。
- 最新版であることだけを選定理由にしない。
- peerDependenciesの一致と、実行時の動作確認を区別する。
- --forceや--legacy-peer-depsで依存衝突を回避しない。
- Node.jsは、Electron内蔵Node.jsと同じLTS系列（.nvmrc）を推奨構成とする。
