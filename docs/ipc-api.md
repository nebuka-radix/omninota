# IPC API

Rendererからは `window.gtd` だけを使う。任意SQLや任意チャンネルの呼び出し口はない。

## 共通

- 契約（型・定数）: `src/shared/contracts/`（実行時依存なし）
- 入力検証（Zod）: `src/shared/validation/`（Mainだけがimport）
- 受付処理: `src/main/ipc/handler.ts`（送信元検証 → 入力検証 → 処理 → 結果形式へ変換）
- 登録: `src/main/ipc/index.ts`（タスクAPIはマイグレーション完了後に登録）

結果形式:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string; details?: IpcErrorDetails } }

// 業務エラーの型付きの補足（フェーズ5.3）。画面はメッセージ文字列を解析せず、この値を使う。SQLやスタックは含めない
type IpcErrorDetails =
  | { kind: 'project-has-open-tasks'; openTaskCount: number }
  | { kind: 'deletion-scope-changed' } // フェーズ5.6
  | { kind: 'order-changed' } // フェーズ5.9: 並べ替えの対象が画面の表示と一致しない
```

| code | 意味 | message |
|---|---|---|
| FORBIDDEN | 送信元が自アプリのウィンドウのメインフレーム・許可URLではない | 固定文言 |
| INVALID_INPUT | Zodの入力検証に失敗 | 最初の検証エラーの文言（画面表示用） |
| NOT_FOUND | 業務エラー: 対象が存在しない | 固定文言（「対象のタスクが見つかりません。」「対象のプロジェクトが見つかりません。」「指定したプロジェクトが見つかりません。」） |
| CONFLICT | 業務エラー: 業務ルールにより実行できない（フェーズ5.2・5.3） | 「完了済みのプロジェクトにはタスクを追加・移動できません。」「完了済みのプロジェクトのタスクは未完了に戻せません。先にプロジェクトを未完了に戻してください。」「未完了のタスクがn件あるため完了できません。」（この場合は `details` に件数） |
| INTERNAL | 処理中の予期しないエラー | 固定文言。SQLやスタックはMainのログだけに出す |

送信元検証の条件:
- `event.sender` がメインウィンドウの `webContents` と一致する
- `senderFrame` があり、メインフレーム（`parent === null`）である
- `senderFrame.url` が許可URL（開発時は開発サーバーのオリジン、ビルド後は `out/renderer/index.html`）

## API一覧

| window.gtd | チャンネル | 入力 | 出力 |
|---|---|---|---|
| `app.getInfo()` | `app:get-info` | なし | `AppInfo` |
| `tasks.create(input)` | `tasks:create` | `{ title: string, projectId?: string \| null, milestoneId?: string \| null }` | `TaskDto` |
| `tasks.list()` | `tasks:list` | なし | `TaskDto[]` |
| `tasks.updateTitle(input)` | `tasks:update-title` | `{ id, title }` | `TaskDto`（保存後） |
| `tasks.setCompleted(input)` | `tasks:set-completed` | `{ id, completed }` | `TaskDto`（保存後） |
| `tasks.setAssignment(input)` | `tasks:set-assignment` | `{ id, projectId: string \| null, milestoneId: string \| null }` | `TaskDto`（保存後。フェーズ5.4。5.2の `tasks.setProject` を置き換え） |
| `tasks.delete(input)` | `tasks:delete` | `{ id }` | `{ id }`（物理削除。フェーズ5.6） |
| `tasks.assignFromInbox(input)` | `tasks:assign-from-inbox` | `{ ids: string[], projectId, milestoneId }` | `TaskDto[]`（ids の順。フェーズ5.9） |
| `tasks.deleteMany(input)` | `tasks:delete-many` | `{ ids: string[] }` | `{ ids }`（物理削除。フェーズ5.9） |
| `tasks.setDue(input)` | `tasks:set-due` | `{ id, due: { kind: 'today' } \| { kind: 'tomorrow' } \| { kind: 'date', date: 'YYYY-MM-DD' } \| { kind: 'clear' } }` | `TaskDto`（保存後。フェーズ6） |
| `summary.get()` | `summary:get` | なし | `SummaryReview`（`{ today, todayItems, tomorrowItems, thisWeekItems, overdueItems }`。overdueItems は昨日以前すべて。フェーズ6。各行は `TaskDto` と `projectName`・`milestoneName`） |
| `summary.today()` | `summary:today` | なし | `string`（Main のローカルの今日 "YYYY-MM-DD"。期限の表示に使う） |
| `tasks.setFavorite(input)` | `tasks:set-favorite` | `{ id, favorite: boolean }` | `TaskDto`（保存後。お気に入りだけを更新。同じ値なら更新しない。非表示・削除済みは NOT_FOUND） |
| `tasks.reorderInMilestone(input)` | `tasks:reorder-in-milestone` | `{ milestoneId, orderedIds: string[] }` | `TaskDto[]`（そのマイルストンの全件・新しい順。フェーズ5.9） |
| `projects.list()` | `projects:list` | なし | `ProjectDto[]` |
| `projects.create(input)` | `projects:create` | `{ name }` | `ProjectDto` |
| `projects.rename(input)` | `projects:rename` | `{ id, name }` | `ProjectDto`（保存後） |
| `projects.setCompleted(input)` | `projects:set-completed` | `{ id, completed }` | `ProjectDto`（保存後。フェーズ5.3） |
| `projects.getDeletionSummary(input)` | `projects:get-deletion-summary` | `{ id }` | `ProjectDeletionSummary`（フェーズ5.6） |
| `projects.delete(input)` | `projects:delete` | `{ id, expectedMilestoneCount, expectedTaskCount }` | `{ id, milestoneCount, taskCount }`（フェーズ5.6） |
| `milestones.list()` | `milestones:list` | なし | `MilestoneDto[]`（全プロジェクト分。作成日時・IDの昇順。フェーズ5.4） |
| `milestones.create(input)` | `milestones:create` | `{ projectId, name }` | `MilestoneDto` |
| `milestones.rename(input)` | `milestones:rename` | `{ id, name }` | `MilestoneDto`（保存後） |
| `milestones.getDeletionSummary(input)` | `milestones:get-deletion-summary` | `{ id }` | `MilestoneDeletionSummary`（フェーズ5.6） |
| `milestones.delete(input)` | `milestones:delete` | `{ id, expectedTaskCount }` | `{ id, hiddenTaskCount }`（フェーズ5.6） |
| `milestones.reorder(input)` | `milestones:reorder` | `{ projectId, orderedIds: string[] }` | `MilestoneDto[]`（そのプロジェクトの全件・新しい順。フェーズ5.9） |
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
- 余分なキー（`doneOn` など列の直接指定）は拒否する。
- 前後空白を除いたタイトルが保存済みと同じなら更新せず、そのままのタスクを返す。
- 存在しないIDは NOT_FOUND（成功扱いしない）。

### tasks.setCompleted

- 目的の状態を指定する（`{ id, completed: true }` / `{ id, completed: false }`）。トグルではない。
  二重呼び出しや再試行で状態が反転しないようにするため。
- 完了日時はMain側で付与する。Rendererから日時は指定できない（余分なキーは拒否）。
- 既に目的の状態なら更新せず（日時を変えず）、そのままのタスクを返す。
- 存在しないIDは NOT_FOUND。
- 完了済みプロジェクトに所属するタスクを未完了に戻す（`completed: false`）要求は CONFLICT（フェーズ5.3）。
  確認順は「タスクの存在 → 同じ状態なら変更なしの成功 → 所属プロジェクトの完了状態 → 更新」で、1つのトランザクションで行う。
  完了にする要求（`completed: true`）は、所属によらず許可する。

### 削除と所属ルールの変更（フェーズ5.6）

所属ルール（tasks.create・tasks.setAssignment）:
- 受け付ける所属は「Inbox（projectId・milestoneId ともに省略／null）」か「プロジェクトとそのプロジェクトのマイルストンの両方」だけ。
  プロジェクトだけ（milestoneId が null）・マイルストンだけは INVALID_INPUT（「プロジェクトに所属させる場合は、そのプロジェクトのマイルストンも指定してください。」）。
  Serviceでも同じ規則を確認する（CONFLICT）。マイルストンが0件のプロジェクトには、結果として追加・紐付けできない。
- 非表示（削除由来）のマイルストン・存在しないマイルストンは NOT_FOUND（「指定したマイルストンが見つかりません。」）。
- 完了済みプロジェクトへの追加・移動の拒否（CONFLICT）は従来どおり。

projects.create:
- プロジェクトと初期マイルストン「新しいマイルストン」（`INITIAL_MILESTONE_NAME`。通常のマイルストンで、名前変更・削除できる）を
  1つのトランザクションで作成する。どちらかが失敗すれば両方とも作らない。戻り値は従来どおり `ProjectDto`（Rendererはマイルストン一覧も取り直す）。

非表示データ（削除由来）:
- `tasks.list` は hidden_at がNULLのタスクだけ、`milestones.list` は project_id がNULLでないマイルストンだけを返す。
- `tasks.updateTitle`・`tasks.setCompleted`・`tasks.setAssignment`・`tasks.delete` は、非表示のタスクを NOT_FOUND にする（再表示・再利用しない。旧所属にも戻らない）。
  `milestones.rename`・削除も、非表示のマイルストンを NOT_FOUND にする。
- プロジェクトの完了判定の未完了件数に、非表示のタスクは含めない（マイルストンの削除で非表示になった未完了タスクは完了を妨げない）。

`tasks.delete({ id })`:
- 表示中のタスクを物理削除する（所属・完了状態は問わない。完了済みプロジェクトのタスクも削除できる）。存在しない・非表示・削除済みは NOT_FOUND。
- 所属プロジェクトの状態は変えない（未完了タスクが0件になっても自動で完了しない）。

`milestones.getDeletionSummary({ id })` / `milestones.delete({ id, expectedTaskCount })`:
- 確認内容: `{ id, name, taskCount }`。taskCount はDBで数えた所属タスクの総数（完了済み・画面の検索で隠れているものを含む）。
- 削除は1つのトランザクションで: 存在（表示中。NOT_FOUND）→ 件数が expectedTaskCount と同じか（違えば何も変えずに
  CONFLICT `details: { kind: 'deletion-scope-changed' }`）→ 所属タスクの milestone_id を NULL・hidden_at を設定（project_id は維持。
  タスクは削除しない）→ マイルストンを物理削除。最後の1件でも削除でき、代わりのマイルストンは作らない。完了済みプロジェクトのマイルストンも削除できる。

`projects.getDeletionSummary({ id })` / `projects.delete({ id, expectedMilestoneCount, expectedTaskCount })`:
- 確認内容: `{ id, name, done, doneOn, milestoneCount, taskCount, hiddenTaskCount }`。taskCount は既に非表示の所属タスク（マイルストンの削除で
  非表示になり project_id だけが残っているもの）を含む総数。
- 削除は1つのトランザクションで: 存在（NOT_FOUND）→ 件数が確認時と同じか（違えば CONFLICT `deletion-scope-changed`）→
  所属タスク（既に非表示のものを含む）の project_id・milestone_id を NULL・hidden_at を設定（既にあれば維持）→
  所属マイルストンの project_id を NULL → プロジェクトを物理削除。マイルストン・タスクは削除しない。
- 未完了・完了済みのどちらでも削除できる（完了の条件とは無関係）。関係のないプロジェクト・Inboxのタスクは変えない。

件数（expected*）: 0以上の整数（Zodで検証。小数・負数・省略は INVALID_INPUT）。updatedAt の扱いは docs/database.md（tasks の表）を参照。

```ts
type MilestoneDeletionSummary = { id: string; name: string; taskCount: number }
type ProjectDeletionSummary = { id: string; name: string; done: boolean; doneOn: string | null; milestoneCount: number; taskCount: number; hiddenTaskCount: number }
// IpcErrorDetails に { kind: 'deletion-scope-changed' } を追加
```

### tasks.setAssignment・tasks.create のマイルストン・milestones（フェーズ5.4）

（フェーズ5.6で、プロジェクトだけの所属は廃止した。上記「削除と所属ルールの変更」を参照）


- `tasks.setProject`（5.2）は廃止し、プロジェクトとマイルストンを1回で保存する `tasks.setAssignment` に置き換えた
  （プロジェクトとマイルストンを別々のAPIで順番に更新し、途中で不整合な状態を作らないため。呼び出し元は詳細パネル・Inboxの紐付け・テスト）。
- 入力: `{ id, projectId, milestoneId }`。両方必須（解除は両方 `null`）。`milestoneId` だけを指定した形は INVALID_INPUT。
- Main側の確認順（1つのトランザクション）:
  1. タスクの存在（NOT_FOUND）
  2. プロジェクト・マイルストンの両方が同じなら、変更しない成功（updatedAtも変えない。完了済みプロジェクトでも同じ）
  3. プロジェクトの存在（NOT_FOUND「指定したプロジェクトが見つかりません。」）→ マイルストンの存在（NOT_FOUND「指定したマイルストンが見つかりません。」）
     → マイルストンがそのプロジェクトのものか（CONFLICT「指定したマイルストンは、そのプロジェクトに属していません。」）
     → プロジェクトが未完了か（CONFLICT）
  4. project_id・milestone_id・updated_at を1回の UPDATE で更新（プロジェクトだけを変える場合も milestone_id を指定値（null）で上書きし、
     旧プロジェクトのマイルストンを残さない）。ID・タイトル・作成日時・完了日時は変えない。
- 完了済みプロジェクトから外（未所属・別の未完了プロジェクト）への移動は許可。完了済みプロジェクト内でのマイルストン変更は拒否（移動とみなす）。
- `tasks.create`: `milestoneId` は省略可。指定する場合は `projectId` も必要で、上記3と同じ確認を行う。
- `milestones.create`: プロジェクトの存在（NOT_FOUND）・未完了（CONFLICT「完了済みのプロジェクトにはマイルストンを追加できません。」）。
  名前は前後空白を除去、空白のみは INVALID_INPUT、最大200文字（`MILESTONE_NAME_MAX_LENGTH`）、同名可。IDと日時はMain側で付与。
- `milestones.rename`: 存在しないIDは NOT_FOUND。同じ名前なら更新しない。完了済みプロジェクトのマイルストンでも変更できる。

```ts
type MilestoneDto = { id: string; projectId: string; name: string; createdAt: string; updatedAt: string }
// TaskDto に milestoneId: string | null を追加（projectId が null なら常に null）
```

### tasks.create の所属・tasks.setProject（フェーズ5.2。5.4で setAssignment に置き換え）

- `tasks.create`: `projectId` は省略可（フェーズ5.1までの呼び出しと互換。省略・nullは未所属）。指定する場合はUUID。
  指定したプロジェクトが存在しなければ NOT_FOUND（「指定したプロジェクトが見つかりません。」）、完了済みなら CONFLICT。
- `tasks.setProject`: `projectId` は必須（解除は `null` で明示）。余分なキーは拒否。Main側の確認順:
  1. タスクの存在（なければ NOT_FOUND「対象のタスクが見つかりません。」）
  2. 既に同じ所属なら、変更しない成功（updatedAtも変えない。完了済みプロジェクトに所属中の再要求もエラーにしない）
  3. 移動先プロジェクトの存在（NOT_FOUND「指定したプロジェクトが見つかりません。」）・未完了（CONFLICT）
  4. 更新（updatedAt だけ更新。ID・タイトル・作成日時・完了日時は変えない）
- 2〜4（作成では3〜4）は1つのトランザクションで行う。完了済みプロジェクトから外（未所属・別の未完了）への移動は許可する。

### 一括紐付け・一括削除・並べ替え（フェーズ5.9）

いずれも Main の1つのトランザクション（BEGIN IMMEDIATE）で、確認してから全件を更新する。1件でも条件を満たさなければ何も変更しない。
Rendererから単体APIを件数分呼ぶ方式は使わない。

- 入力（Zod）: ID一覧は1件以上・`TASK_BULK_MAX`（10,000）件以内・UUID・重複なし（重複は INVALID_INPUT）。余分なキーは拒否。
- `tasks.assignFromInbox`: Inboxの複数タスクを1つのマイルストンへ紐付ける。移動先はプロジェクトとマイルストンの両方（Inboxへの移動は受け付けない）。
  確認順: 全件が存在し表示中（NOT_FOUND「選択したタスクの一部が見つかりません…」）→ 全件が現在Inbox（CONFLICT「…既にInboxにありません…」）→
  移動先（`setAssignment` と同じ: プロジェクトの存在・マイルストンの存在（削除済み・非表示は NOT_FOUND）・組み合わせ・未完了）。
  ドラッグ開始後に移動先が削除・完了された場合も、この確認で拒否する。2回目の同じ要求（二重送信）は CONFLICT で何も変えない。
  更新は所属と手動順（移動先に手動順があれば ids の順で末尾）と updated_at だけ。タイトル・完了状態・作成日時は変えない。
- `tasks.deleteMany`: 表示中の複数タスクの物理削除。全件が存在し表示中でなければ NOT_FOUND で何も削除しない。
- `tasks.reorderInMilestone`: `orderedIds` はそのマイルストンの表示中のタスク全件（完了済みを含む）の新しい順序。
  DBの所属タスクと一致しない（一部だけ・別のタスク・存在しないID）場合は CONFLICT（`details: { kind: 'order-changed' }`）。
  順位（`position`）だけを書き換え、created_at・done_on・updated_at は変えない。
- `milestones.reorder`: `orderedIds` はそのプロジェクトの表示中のマイルストン全件の新しい順序。一致しなければ CONFLICT（order-changed）。
  名前・日時は変えない。完了済みプロジェクトでも並べ替えられる。

### TaskDto

```ts
type TaskDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  doneOn: string | null // 完了日時（0010 で completedAt から名前を変更）。タスクの完了状態（done）は doneOn の有無で表す（done の列・項目はない）
  projectId: string | null // 所属するプロジェクト。nullは未所属（フェーズ5.2）
  milestoneId: string | null // 所属するマイルストン。nullは未設定（フェーズ5.4）
  position: number | null // マイルストン内の手動順（フェーズ5.9）。null は手動順なし（作成日時の古い順）
  dueto: string | null // 期限（フェーズ6）。日付のみ "YYYY-MM-DD"。null は未設定
  favorite: boolean // お気に入り（0009）。既定は false
} // 日時はUTCのISO 8601
// MilestoneDto にも position: number | null（プロジェクト内のカードの手動順。フェーズ5.9）
```

### projects.list / projects.create / projects.rename（フェーズ5.1）

- 名前: 前後空白を除去、空白のみは INVALID_INPUT、最大200文字（`PROJECT_NAME_MAX_LENGTH`）。同名を許可。
- `create`: IDと日時はMain側で付与し、未完了（`done: false`・`doneOn: null`）で作成する。
- `rename`: `id` はUUID。存在しないIDは NOT_FOUND（「対象のプロジェクトが見つかりません。」）。同じ名前なら更新しない。
- 余分なキー（`done`・`doneOn` など）は拒否する。

### projects.setCompleted（フェーズ5.3）

- 目的の状態を指定する（`{ id, completed: true }` / `{ id, completed: false }`）。トグルではない。`id` はUUID、余分なキーは拒否。
- Main側の確認順（1つのトランザクション）:
  1. プロジェクトの存在（NOT_FOUND「対象のプロジェクトが見つかりません。」）
  2. 既に目的の状態なら、変更しない成功（日時を変えない）
  3. 完了にする場合: 所属する未完了タスクの件数をDBで数える（画面の検索・表示フィルター・取得済みの件数には依存しない）。
     1件以上なら CONFLICT（`details: { kind: 'project-has-open-tasks', openTaskCount }`）。タスク0件・全件完了なら完了できる。
  4. 更新: 完了は `done: true` と `doneOn`・`updatedAt` を同じ現在日時に（同じ更新）、取り消しは `done: false`・`doneOn: null` と `updatedAt` を現在日時にする。
     `createdAt`・名前は変えない。所属タスクの状態・日時・所属は変えない。
- タスクが全件完了しても、プロジェクトを自動で完了しない。

```ts
type ProjectDto = { id: string; name: string; createdAt: string; updatedAt: string; done: boolean; doneOn: string | null } // 0010 で completedAt → doneOn、done を追加
// MilestoneDto にも done: boolean・doneOn: string | null（0010。今回は完了の操作がなく常に false / null）
```

### workspace.get / workspace.save

Workspace設定（画面枠のUI状態）専用。任意の設定キーは扱わない。

```ts
type WorkspaceSettings = {
  version: 1
  sidebarWidth: number // 180〜480の整数px
  detailWidth: number // 220〜560の整数px
  detailVisible: boolean
  lastRoute: '/inbox' | '/settings' | '/projects' | `/projects/${string}` // 小文字のUUIDだけ
  milestoneCardWidth: number // 240〜640の整数px（フェーズ5.5。マイルストンカードの共通の幅）
}
```

- `milestoneCardWidth` はフェーズ5.5で追加した。追加前に保存した値（このキーがない）は、読み取り時に既定値320pxで補う
  （補正扱いにせず、他の項目もそのまま使う）。保存要求では必須。`/projects/new`（新規プロジェクトの画面）は lastRoute に保存しない。

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
    / `draft-save-failed`（`save` でタイトル・プロジェクト名を保存できなかった。無効な入力を含む。フェーズ4.1、5.1で対象を追加）
  - `unsaved-draft` の場合、Mainは同じ終了フローのダイアログで「保存して終了 / 保存せずに終了 / キャンセル」を選んでもらう。
  - `draft-save-failed` の場合、Mainは終了・閉じる処理を中断する（ダイアログは重ねない）。
  - 進行中のタスクの保存（所属の変更など）がある場合、Rendererはその完了を待ってから応答する。
    失敗していれば `draft-save-failed` を返し、終了・閉じる処理を中断する（理由は画面に表示されている。フェーズ5.2）。
  - `draftKind`（任意、フェーズ5.1）: `task` / `project`。未保存ドラフトの対象で、終了時のダイアログの文言に使う。
    `unsaved-draft` / `draft-save-failed` の時に付ける。省略時はタスクのタイトルとして扱う（フェーズ4.1までの応答との互換）。
- Main側の検証: 送信元検証に加え、`requestId` はUUID、`outcome` は上記4値、`draftKind` は上記2値、余分なキーは拒否。
  未知・期限切れ（確認・破棄は3秒、保存は10秒）の `requestId` への応答は無視する。
- Main側では、応答なしを `timeout`、ウィンドウ破棄済みを `unavailable` として扱う。
  `failed` と `timeout` は成功として扱わず、利用者に再試行・保存せずに続行・キャンセルを選んでもらう。

## Renderer側

- Queryキー: `['tasks', 'list']`（`src/renderer/src/features/tasks/task-queries.ts`）
- タスク登録のMutationキー: `['tasks', 'create']`（StatusBarの「保存中」表示に使う）
- `tasks.create` が成功した場合だけ、一覧のQueryを無効化して取り直す。
- `tasks.updateTitle` / `tasks.setCompleted` / `tasks.setProject` が成功した場合は、返却されたDTOで一覧キャッシュの該当行だけを置き換える
  （再取得しないので、スクロール位置や検索条件を初期化しない。他のタスク・プロジェクトのキャッシュは変えない）。
  失敗時はキャッシュを変えない（楽観的更新はしない）。一覧の再取得中だった場合は、更新前の結果で上書きされないよう取り直す。
- 同じタスクへの更新（タイトル・完了・所属）は、Renderer内で順番に1つずつ送る（`task-save-queue.ts`、フェーズ5.2）。
  各応答は保存後のタスク全体なので、最後の応答が最新の状態になり、古いDTOで別の項目を上書きしない。
- 同じプロジェクトへの更新（名前・完了状態）も、同じ保存キューでキー `project:<ID>` として順番に送る（フェーズ5.3）。
  `projects.rename` / `projects.setCompleted` の成功時は、返却DTOでプロジェクト一覧キャッシュの該当行だけを置き換える。
- `IpcCallError.details` で業務エラーの補足を受け取る（プロジェクト完了の拒否時の件数など）。
- 更新中のタスクID（`usePendingTaskIds`）の行・ボタン・所属の選択は、同じタスクへの重複操作を防ぐため無効にする。
- Inbox・プロジェクトの一覧は同じ全件Query（`['tasks', 'list']`）から、Tableの絞り込みで表示範囲を決める（範囲ごとのQueryは作らない）。
- Workspace設定は起動時に `['workspace', 'settings']` で1回だけ読み込み、以後はWorkspaceContextが正本。
  保存は最新値だけを順番に送るキューを通す。
- `ok: false` は `IpcCallError` として扱い、画面に失敗を表示する。
