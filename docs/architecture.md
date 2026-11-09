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
