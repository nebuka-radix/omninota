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

## 2. 会話で構成案に組み込まれた技術

以下は推奨され、その前提で構成を検討したもの。
TanStack4ライブラリのような個別の明示承認とは区別する。
実装開始時にまとめて確認する。

| 分野 | 技術 |
|---|---|
| UI基盤 | React |
| UIコンポーネント | MUI |
| アイコン | lucide-react |
| アニメーション | motion / motion/react |

## 3. 推奨候補・未確定

| 分野 | 第一候補 | 補足 |
|---|---|---|
| 開発・ビルド | electron-vite | Electron用のビルド環境 |
| パッケージ化 | electron-builder | 配布成果物を生成 |
| ORM | Drizzle ORM | SQLiteの型付きアクセス |
| DBドライバー | better-sqlite3 | Electron向け再ビルドを確認 |
| 固定ペイン | react-resizable-panels | 幅調整中心の場合 |
| ドッキング | Dockview | 自由なタブ分割が必要な場合 |
| UI状態保存 | app_settingsテーブル | 保存形式は要設計 |
| Router方式 | ファイルベース | コードベース方式も選択可能 |
| Router履歴 | ハッシュ方式など | 配布時の読み込み方式に合わせる |

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
