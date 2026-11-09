# IPC API

Rendererからは `window.gtd` だけを使う。任意SQLや任意チャンネルの呼び出し口はない。

## 共通

- 契約（型・定数）: `src/shared/contracts/`（実行時依存なし）
- 入力検証（Zod）: `src/shared/validation/`（Mainだけがimport）
- 受付処理: `src/main/ipc/handler.ts`（送信元検証 → 入力検証 → 処理 → 結果形式へ変換）
- 登録: `src/main/ipc/index.ts`（タスクAPIはマイグレーション完了後に登録）

結果形式:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string } }
```

| code | 意味 | message |
|---|---|---|
| FORBIDDEN | 送信元が自アプリのウィンドウのメインフレーム・許可URLではない | 固定文言 |
| INVALID_INPUT | Zodの入力検証に失敗 | 最初の検証エラーの文言（画面表示用） |
| NOT_FOUND | 業務エラー: 対象のタスクが存在しない | 固定文言（「対象のタスクが見つかりません。」） |
| INTERNAL | 処理中の予期しないエラー | 固定文言。SQLやスタックはMainのログだけに出す |

送信元検証の条件:
- `event.sender` がメインウィンドウの `webContents` と一致する
- `senderFrame` があり、メインフレーム（`parent === null`）である
- `senderFrame.url` が許可URL（開発時は開発サーバーのオリジン、ビルド後は `out/renderer/index.html`）

## API一覧

| window.gtd | チャンネル | 入力 | 出力 |
|---|---|---|---|
| `app.getInfo()` | `app:get-info` | なし | `AppInfo` |
| `tasks.create(input)` | `tasks:create` | `{ title: string }` | `TaskDto` |
| `tasks.list()` | `tasks:list` | なし | `TaskDto[]` |
| `tasks.updateTitle(input)` | `tasks:update-title` | `{ id, title }` | `TaskDto`（保存後） |
| `tasks.setCompleted(input)` | `tasks:set-completed` | `{ id, completed }` | `TaskDto`（保存後） |
| `workspace.get()` | `workspace:get` | なし | `WorkspaceSettings` |
| `workspace.save(settings)` | `workspace:save` | `WorkspaceSettings` | `WorkspaceSettings` |
| `workspace.onFlushRequest(listener)` | `workspace:flush-request`（Main → Renderer） | `{ requestId, draftAction }` | 購読解除関数 |
| `workspace.reportFlushResult(result)` | `workspace:flush-result` | `{ requestId, outcome }` | `null` |

### tasks.create

- `title` の前後空白を除去する。
- 除去後に空ならINVALID_INPUT（「タイトルを入力してください。」）。
- 上限は `TASK_TITLE_MAX_LENGTH`（200、`src/shared/contracts/tasks.ts`）。超えたらINVALID_INPUT。
- 余分なキー、余分な引数、文字列以外もINVALID_INPUT。
- IDと作成・更新日時はMain側で付与する。

### tasks.list

- `created_at` の新しい順。同じ日時なら `id` の降順（常に同じ順序）。

### tasks.updateTitle

- `id` はUUID、`title` は tasks.create と同じ規則（前後空白の除去・空は拒否・上限200文字）。
- 余分なキー（`completedAt` など列の直接指定）は拒否する。
- 前後空白を除いたタイトルが保存済みと同じなら更新せず、そのままのタスクを返す。
- 存在しないIDは NOT_FOUND（成功扱いしない）。

### tasks.setCompleted

- 目的の状態を指定する（`{ id, completed: true }` / `{ id, completed: false }`）。トグルではない。
  二重呼び出しや再試行で状態が反転しないようにするため。
- 完了日時はMain側で付与する。Rendererから日時は指定できない（余分なキーは拒否）。
- 既に目的の状態なら更新せず（日時を変えず）、そのままのタスクを返す。
- 存在しないIDは NOT_FOUND。

### TaskDto

```ts
type TaskDto = { id: string; title: string; createdAt: string; updatedAt: string; completedAt: string | null } // 日時はUTCのISO 8601
```

### workspace.get / workspace.save

Workspace設定（画面枠のUI状態）専用。任意の設定キーは扱わない。

```ts
type WorkspaceSettings = {
  version: 1
  sidebarWidth: number // 180〜480の整数px
  detailWidth: number // 220〜560の整数px
  detailVisible: boolean
  lastRoute: '/inbox' | '/settings'
}
```

- `get`: 保存値を検証・正規化して返す。未保存・破損時は既定値（docs/database.md 参照）。
- `save`: 範囲外・小数・余分なキー・未知の画面・バージョン違いはINVALID_INPUT。全体を置き換える。

### workspace.onFlushRequest / workspace.reportFlushResult

通常の終了・ウィンドウを閉じる前に、Mainが確定済みWorkspace状態の保存完了を問い合わせるための専用API。

- Mainは `workspace:flush-request` で `{ requestId（UUID）, draftAction }` を送る。Preloadはこのチャンネルだけを購読し、
  値の形（文字列・3値）を確かめてから渡す。戻り値は購読解除関数。
- `draftAction`（フェーズ4.1）: `check`（確認だけ）/ `save`（未保存ドラフトを保存してから応答）/ `discard`（ドラフトを破棄してから応答）
- Rendererは保存キューの `flush()` を待ってから `reportFlushResult` で応答する。
  - `outcome`: `saved`（保存できた）/ `nothing`（未保存の変更なし）/ `failed`（失敗）/ `disabled`（保存しない設定）
    / `unsaved-draft`（Workspace状態は問題ないが、詳細パネルに未保存のタイトル編集がある。フェーズ4）
    / `draft-save-failed`（`save` でタイトルを保存できなかった。無効な入力を含む。フェーズ4.1）
  - `unsaved-draft` の場合、Mainは同じ終了フローのダイアログで「保存して終了 / 保存せずに終了 / キャンセル」を選んでもらう。
  - `draft-save-failed` の場合、Mainは終了・閉じる処理を中断する（ダイアログは重ねない）。
- Main側の検証: 送信元検証に加え、`requestId` はUUID、`outcome` は上記4値、余分なキーは拒否。
  未知・期限切れ（確認・破棄は3秒、保存は10秒）の `requestId` への応答は無視する。
- Main側では、応答なしを `timeout`、ウィンドウ破棄済みを `unavailable` として扱う。
  `failed` と `timeout` は成功として扱わず、利用者に再試行・保存せずに続行・キャンセルを選んでもらう。

## Renderer側

- Queryキー: `['tasks', 'list']`（`src/renderer/src/features/tasks/task-queries.ts`）
- タスク登録のMutationキー: `['tasks', 'create']`（StatusBarの「保存中」表示に使う）
- `tasks.create` が成功した場合だけ、一覧のQueryを無効化して取り直す。
- `tasks.updateTitle` / `tasks.setCompleted` が成功した場合は、返却されたDTOで一覧キャッシュの該当行だけを置き換える
  （再取得しないので、スクロール位置や検索条件を初期化しない）。失敗時はキャッシュを変えない（楽観的更新はしない）。
- 更新中のタスクID（`usePendingTaskIds`）の行・ボタンは、同じタスクへの重複更新を防ぐため無効にする。
- Workspace設定は起動時に `['workspace', 'settings']` で1回だけ読み込み、以後はWorkspaceContextが正本。
  保存は最新値だけを順番に送るキューを通す。
- `ok: false` は `IpcCallError` として扱い、画面に失敗を表示する。
