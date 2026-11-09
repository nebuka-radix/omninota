#!/bin/zsh

set -euo pipefail
umask 022

# このスクリプトがあるディレクトリをプロジェクトルートにする。
ROOT_DIR="${0:A:h}"
cd "$ROOT_DIR"

typeset -a OUTPUT_FILES
OUTPUT_FILES=(
  "CLAUDE.md"
  "docs/requirements.md"
  "docs/architecture.md"
  "docs/technology-decisions.md"
  "docs/implementation-plan.md"
  "docs/claude-code-start.md"
)

# 部分的な上書きを防ぐため、書き込み前に全出力先を確認する。
for file in "${OUTPUT_FILES[@]}"; do
  if [[ -e "$file" || -L "$file" ]]; then
    print -u2 -- "既存ファイルがあるため停止しました: $file"
    print -u2 -- "必要な内容を退避してから再実行してください。"
    exit 1
  fi
done

if [[ -e docs && ! -d docs ]]; then
  print -u2 -- "docs がディレクトリではないため停止しました。"
  exit 1
fi

mkdir -p docs

cat > CLAUDE.md <<'EOF'
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
- Gitのcommit、push、履歴改変は明示的な依頼がある場合だけ行う。
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
EOF

cat > docs/requirements.md <<'EOF'
# 要件

## 目的

macOS向けに、VS Code風の操作感を持つGTDツールを開発する。
ローカルSQLiteファイルにデータを保存する。

## 明示された要件

- macOS、VS Code、Electron、TypeScriptを使用する。
- Claude Codeで開発を進める。
- データはSQLiteファイルへ永続保存する。
- TanStack Query、Table、Virtual、Routerを採用する。

## ここまでの構成案

- ReactをUI基盤とする。
- MUIをUIコンポーネントに使用する。
- Lucideをアイコンに使用する。
- Motion for Reactをアニメーションに使用する。
- Main、Preload、Rendererを分離する。
- 単一リポジトリ、単一package.jsonから始める。

上記は会話上の構成方針。
厳密な承認状況はtechnology-decisions.mdを参照する。

## 画面構成案

- トップバー
- アクティビティバー
- 左サイドバー
- メインパネル
- 右詳細パネル
- ステータスバー

基本はダークテーマとし、カードよりリストとペインを優先する。

## GTD機能の候補

初期の縦断実装:
- Inboxへのタスク追加
- タスク一覧
- タスク詳細の表示・編集
- タスク完了
- 再起動後のデータ復元

後続の機能候補:
- プロジェクト
- Next Actions
- 待機中
- いつか／たぶん
- 期限・タグ
- 完了履歴
- 週次レビュー
- 検索・絞り込み

後続機能の詳細ルールは、実装前に決める。

## UI状態の保存案

- 選択中のアクティビティ
- 左右ペインの幅
- 詳細パネルの表示状態
- 開いているタブ
- アクティブタブ

保存は業務データと分離する。
ドラッグ中の毎フレームのDB書き込みは避ける。

## 初期版の対象外

明示的な追加依頼がない限り、以下を前提にしない。

- クラウド同期
- 複数端末同期
- アカウント・ログイン
- チーム共有
- プラグイン機構
- VS Code拡張API互換
- モバイル版
- カレンダーや外部サービスとの連携

## 要確認事項

- アプリ名、アプリID
- ペイン配置ライブラリ
- タブ分割・ドラッグ移動の必要性
- DBドライバーとORM
- タスク階層・プロジェクト階層
- Next Actionsの判定条件
- 期限と開始日、繰り返しの仕様
- バックアップの保存先と保持数
- 配布対象CPU、署名・公証の必要性
EOF

cat > docs/technology-decisions.md <<'EOF'
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
EOF

cat > docs/architecture.md <<'EOF'
# アーキテクチャ

## 基本構造

単一リポジトリ・単一package.jsonを初期案とする。

```text
Renderer / React
  ├─ Router: 画面遷移
  ├─ Query: 非同期データとキャッシュ
  ├─ Table: ソート・フィルター・選択
  ├─ Virtual: 表示範囲の描画
  └─ MUI / Lucide / Motion
          |
          v
Preload / 用途別API
          |
          v
Main / IPC受付
          |
          v
Service / 業務ルール・トランザクション
          |
          v
Repository / データアクセス
          |
          v
SQLiteファイル
```

## ディレクトリ案

```text
.
├─ CLAUDE.md
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ drizzle.config.ts
├─ tsconfig.json
├─ resources/
├─ migrations/
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ windows/
│  │  ├─ ipc/
│  │  ├─ services/
│  │  ├─ repositories/
│  │  ├─ db/
│  │  │  ├─ client.ts
│  │  │  ├─ migrate.ts
│  │  │  └─ schema/
│  │  └─ infrastructure/
│  ├─ preload/
│  │  ├─ index.ts
│  │  └─ index.d.ts
│  ├─ shared/
│  │  ├─ contracts/
│  │  ├─ validation/
│  │  └─ errors.ts
│  └─ renderer/
│     ├─ index.html
│     ├─ public/
│     └─ src/
│        ├─ main.tsx
│        ├─ app/
│        ├─ routes/
│        ├─ layouts/
│        ├─ features/
│        │  ├─ tasks/
│        │  ├─ inbox/
│        │  ├─ projects/
│        │  ├─ review/
│        │  └─ settings/
│        ├─ components/
│        ├─ state/
│        ├─ theme/
│        ├─ lib/
│        └─ styles/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ scripts/
├─ docs/
├─ out/
└─ dist/
```

候補技術の設定ファイルは、採用後に追加する。
不要な空ディレクトリを先に大量作成しない。

## Rendererの機能単位

```text
features/tasks/
├─ api/
│  ├─ task-queries.ts
│  └─ task-mutations.ts
├─ components/
│  ├─ TaskTable.tsx
│  ├─ TaskQuickAdd.tsx
│  └─ TaskDetail.tsx
├─ table/
│  └─ task-columns.tsx
└─ hooks/
```

routesにはルーティングと画面の組み立てを置く。
業務ロジックをrouteファイルへ集中させない。

## IPC契約

shared/contractsに入力・出力とAPI型を定義する。

APIの例:
- tasks.list
- tasks.create
- tasks.update
- tasks.complete
- projects.list

契約上の注意:
- RendererにDB接続を渡さない。
- DB内部の行型を無条件で画面用DTOにしない。
- Date、例外、クラスインスタンスの暗黙的な転送に依存しない。
- 日時の表現とエラーの表現を明示する。
- 業務エラーと予期しない障害を区別する。
- 通知イベントの購読APIは解除関数を返す。

## 状態の配置

| 状態 | 所有者 |
|---|---|
| タスク・プロジェクト・タグ | SQLite |
| 取得結果のキャッシュ | TanStack Query |
| ソート・列表示・行選択 | Tableと画面状態 |
| 表示範囲・スクロール計算 | Virtual |
| 現在の画面 | Router |
| 開いているタブ・ペイン幅 | Workspace状態 |
| 入力途中のフォーム | 対象画面 |

UI状態管理ライブラリは未選定。
最初はReact Context/Reducer等で必要十分か検討する。

## 一覧表示

```text
Query -> IPC API -> Main -> SQLite
  |
  v
Tableのrow model
  |
  v
Virtual
  |
  v
MUIによる描画
```

- VirtualはDBページングの代わりではない。
- 全件取得かページングかをデータ量に応じて決める。
- DB側とクライアント側のソート・フィルターを混同しない。
- 仮想行のキーには安定したIDを使う。
- 可変行高、スクロール復元、選択行への移動を検証する。
- 仮想化とMotionのレイアウトアニメーションを安易に重ねない。

## Routerとタブ

Routerは現在の表示先を管理する。
Workspaceは開いているタブを管理する。

- タブの識別子とルートの対応を定義する。
- タブ切り替えとURLの同期方向を決める。
- 同じ対象を重複して開くかを決める。
- 動的なタブと単純な画面遷移を混同しない。
- パッケージ化後のHTML読み込みで動作を確認する。
- ファイルベース採用時のみrouteTree.gen.tsを生成する。
- RouterプラグインはRendererのVite設定に適用する。

## DB・保存先

- 実DBはアプリバンドル、out、dist、ソースツリーに保存しない。
- ユーザーデータ領域を候補とし、最終パスは明示する。
- 開発・テスト・通常利用のDBを分離する。
- マイグレーションSQLはアプリへ同梱する。
- 配布後の参照パスを検証する。
- スキーマ変更は履歴として管理する。
- 更新前バックアップと復元手順を用意する。
- WAL使用時は、稼働中DBファイルの単純コピーを
  安全なバックアップ方法だとみなさない。
- 採用ドライバーに応じた整合性のあるバックアップ方法を選ぶ。
- タスク完了日時を更新日時だけから推定しない。

## 負荷の高い処理

SQLiteの同期処理や大量処理でMainを長時間占有しない。
まず計測し、必要ならDB用ワーカーなどへ分離する。

アニメーションの追加だけでUI停止問題が解消したと判断しない。
EOF

cat > docs/implementation-plan.md <<'EOF'
# 実装計画

## フェーズ0: 現状確認と技術確定

- リポジトリ、既存コード、package.jsonを確認する。
- technology-decisions.mdの未確定事項を確認する。
- React/MUI/Lucide/Motionの構成方針を確認する。
- ビルド・配布・DB・ペイン配置の技術を確定する。
- アプリ名とIDを決める。
- バージョンと互換性を確認する。

完了条件:
- 確定事項と保留事項を文書に記録する。
- 未承認の選定を承認済みと扱わない。

## フェーズ1: 起動可能な土台

- Electron、Preload、Reactを構築する。
- TypeScript strictを設定する。
- Router、QueryのProviderを設定する。
- MUIテーマとMotionの共通設定を用意する。
- 開発起動、型チェック、ビルドを確認する。

完了条件:
- ElectronウィンドウにReact画面が表示される。
- Rendererに不要なNode.js権限がない。
- 指示書が初期化によって失われていない。

## フェーズ2: SQLiteの縦断検証

- 接続、初期マイグレーション、タスクテーブルを実装する。
- 入力検証、Service、Repository、IPCを実装する。
- 1件登録・取得する。
- 終了・再起動後に復元する。
- パッケージ化したアプリでも確認する。

完了条件:
- 実DBの保存先が明示されている。
- 開発用と通常利用用のデータが混ざらない。
- ネイティブモジュールとマイグレーションが配布後も動く。

## フェーズ3: AppShell

- トップバー
- アクティビティバー
- 左サイドバー
- メインパネル
- 右詳細パネル
- ステータスバー

完了条件:
- ダークテーマとアイコンの見た目が統一される。
- ペイン調整と必要なUI状態の保存が動作する。
- キーボード操作とフォーカス表示を確認する。

## フェーズ4: Inbox

- タスク追加、一覧、詳細、編集、完了を実装する。
- Queryのキーと更新方法を統一する。
- TableとVirtualを組み合わせる。
- ローディング・空・失敗状態を表示する。
- IME変換中のEnter誤登録を防ぐ。
- 控えめなアニメーションを追加する。

完了条件:
- 追加から完了、再起動まで一連の操作が動く。
- 失敗時に成功したような表示をしない。
- 大量行でスクロールと選択を確認する。
- Reduced Motion設定に対応する。

## フェーズ5: GTD機能の拡張

以下は詳細仕様を確認してから実装する。

- プロジェクト
- Next Actions
- 待機中
- いつか／たぶん
- タグ、期限
- 完了履歴
- 週次レビュー
- 検索

## フェーズ6: データ保護・配布

- バックアップと復元
- スキーマ更新時の移行確認
- 異常終了時の扱い
- ログとエラー表示
- 必要なCPU向けの配布検証
- 必要に応じて署名・公証

## テスト方針

Unit:
- GTD業務ルール
- 入力検証
- 日付と日時の扱い

Integration:
- RepositoryのCRUD
- マイグレーション
- トランザクション
- バックアップ・復元
- IPC契約

E2E:
- 起動
- タスク追加・編集・完了
- 画面遷移
- 再起動後の復元
- ペイン・タブ状態
- パッケージ化後の保存

テストツールは未選定。
採用前に実行環境とElectron対応を確認する。
EOF

cat > docs/claude-code-start.md <<'EOF'
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
EOF

for file in "${OUTPUT_FILES[@]}"; do
  if [[ ! -s "$file" ]]; then
    print -u2 -- "生成結果の確認に失敗しました: $file"
    exit 1
  fi
done

print -- ""
print -- "指示書を生成しました。"
print -- "プロジェクトルート: $ROOT_DIR"
print -- ""

for file in "${OUTPUT_FILES[@]}"; do
  print -- "  $file"
done

print -- ""
print -- "次の作業:"
print -- "  1. 生成した指示書を確認する"
print -- "  2. このディレクトリでClaude Codeを起動する"
print -- "  3. docs/claude-code-start.md の開始指示を入力する"
print -- ""
print -- "アプリ生成・依存インストール・Git操作は行っていません。"