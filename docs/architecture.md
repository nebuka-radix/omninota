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
実装済みAPIの一覧と結果形式は docs/ipc-api.md を参照する。

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

各層の取り込み範囲:
- shared/contractsは型とチャンネル名の定数だけを置き、実行時依存を持たない。
  Main、Preload、Rendererのどこから使ってもよい。
- shared/validation（Zodスキーマ）はMainだけがimportする。
  PreloadとRendererへZodを持ち込まない。
- Mainは`ipcMain.handle`で受け付け、送信元のwebContents・フレームURLを検証し、
  Zodで入力を検証してから処理する。結果は`{ ok, data | error }`形式で返す。
- PreloadはsandboxのためCJSで出力する。`require`できるのは`electron`だけなので、
  Preloadが使うコードはすべてバンドルする（electron-viteの`externalizeDeps: false`）。
- Preloadは用途別の関数だけを`window.gtd`として公開し、汎用のinvokeを公開しない。

## 依存関係の分類

| 分類 | 置き場所 | 理由 |
|---|---|---|
| Mainの実行時に読み込む（例: zod、better-sqlite3、drizzle-orm） | dependencies | electron-viteがMainでは外部依存として残すため、配布物のnode_modulesに必要 |
| Rendererだけで使う（例: React、MUI、TanStack） | devDependencies | Viteがout/rendererへバンドルし、実行時にnode_modulesから読み込まないため |
| ビルド・型・開発ツール | devDependencies | 実行時に使わないため |

Preloadは全依存をバンドルするため、Preloadだけで使う依存もdevDependenciesとする。
Mainへ新しい依存を追加する場合は、外部依存として残るかを確認してから分類する。

## 状態の配置

| 状態 | 所有者 |
|---|---|
| タスク・プロジェクト・タグ | SQLite |
| 取得結果のキャッシュ | TanStack Query |
| ソート・列表示・行選択 | Tableと画面状態 |
| 表示範囲・スクロール計算 | Virtual |
| 現在の画面 | Router |
| ペイン幅・詳細パネル表示・最後の画面 | Workspace状態（SQLiteのapp_settingsへ保存） |
| 開いているタブ | Workspace状態（未実装） |
| 入力途中のフォーム | 対象画面 |

UI状態管理ライブラリは導入せず、React Context / Reducerで管理する。

### Workspace状態（フェーズ3）

`src/renderer/src/features/workspace/WorkspaceContext.tsx`

| 項目 | 保存 | 内容 |
|---|---|---|
| sidebarWidth | する | 左サイドバーの希望幅（px） |
| detailWidth | する | 右詳細パネルの希望幅（px）。閉じても保持する |
| detailVisible | する | 右詳細パネルの表示・非表示 |
| lastRoute | する | 最後に表示した画面（`/inbox` / `/settings` / `/projects` / `/projects/<UUID>`）。次回起動用のスナップショット |
| milestoneCardWidth | する | マイルストンカードの共通の幅（px。フェーズ5.5）。左右の幅とは独立。ドラッグを終えた時・キー操作の時だけ保存する |
| revealOpenRequest | しない | 「未完了のタスクを表示」の要求回数（右の詳細パネル → メインパネルの一覧。フェーズ5.5） |
| selectedTaskId | しない | 詳細パネルに表示するタスク |
| saveStatus | しない | 保存中・失敗の表示用 |

- 現在の画面の正本はRouter。ActivityBarの選択はRouterの位置から導出し、
  lastRouteはRouterの位置に追従させるだけで独立には更新しない。
- タブ（openTabs / activeTabId）はまだ持たない。
- 起動時はWorkspace設定を読み込んでからAppShellを描画する。読み込み失敗時は既定値で表示し、保存しない。
- 保存はユーザー操作で設定が変わった時だけ行う（起動時の復元値・既定値は書き込まない）。
- 保存は「最新値だけを順番に送る」キュー（latest-wins-saver.ts）を通し、古い保存が新しい値を上書きしないようにする。

### 終了・ウィンドウを閉じる時の保存（フェーズ3.1）

```text
⌘Q / app.quit()          → before-quit ─┐
閉じるボタン・⌘W（close） → close ───────┤→ ExitCoordinator（止めて確認）
                                          │   → Rendererへ workspace:flush-request（送信元はMain）
                                          │   → Rendererは保存キューの flush() を待ち workspace:flush-result で応答
                                          │   → 成功・保存不要: 終了 / 閉じる処理を再開
                                          └   → 失敗・3秒応答なし: 「再試行 / 保存せずに終了（閉じる） / キャンセル」
```

- `src/main/lifecycle/workspace-flush.ts`（electronに依存しない）と `src/main/index.ts` で実装。
- 確認中に届いた終了・閉じる要求は止めるだけで、問い合わせやダイアログを重ねない。
  閉じる確認中に終了要求が来た場合は、確認後に終了まで進める。
- フェーズ5.9から、最後のウィンドウを閉じたら macOS でもアプリを終了する（以前はウィンドウを閉じてもアプリは残していた）。×は終了要求として同じ確認を行う。
- 破棄済みのウィンドウ・Rendererには問い合わせない（unavailable として終了を妨げない）。
- 起動時の読み込みに失敗した場合は保存しない方針のため、Rendererは disabled を返す。
- 保証するのは通常の終了操作での保存。強制終了・OSクラッシュ・電源断は対象外。
  ドラッグ途中の幅は未確定として扱う。

未保存ドラフトがある場合（フェーズ4.1）:

```text
check → unsaved-draft → ダイアログ（保存して終了 / 保存せずに終了 / キャンセル）
  保存して終了   → save:    タイトルを保存（入力欄は読み取り専用）→ Workspace状態を保存 → 終了
                            保存失敗・無効な入力 → draft-save-failed → 中断（ドラフトと理由は詳細パネルに残り、入力欄へフォーカス）
  保存せずに終了 → discard: ドラフトだけ破棄 → Workspace状態は保存する → 終了
  キャンセル     → 中断（編集を続けられる）
```

- 問い合わせごとの待機上限: 確認・破棄は3秒、保存は10秒。超えたら timeout として既存のダイアログで扱う。
- 応答の前に1フレーム分（上限100ms）待ち、キーボードで変えた直後のペイン幅を保存キューへ入れてから確認する。
- 終了処理の連打: 確認・保存・ダイアログは1回ずつ順番に行う（ExitCoordinator）。

保証できない経路:
- Rendererから `window.close()` を呼ぶ経路は、BrowserWindowの close イベントを経由しないため、保存確認を通らない。
  アプリ自身は呼んでいない。対応するには、Rendererの `beforeunload` と webContents の `will-prevent-unload` で
  閉じる操作を止めて ExitCoordinator へ回す設計が必要（開発時の再読み込みも止まるため、区別の方法を含めて別途設計する）。
- 強制終了（SIGKILL、短時間に繰り返したSIGTERM）、クラッシュ、電源断。

### 自動テスト用の起動モード（GTD_TEST_UI）

- 未パッケージ時だけ有効。`hidden`（表示しない）/ `secondary`（プライマリ以外のディスプレイに `showInactive()`）。
- 一時ディレクトリ内の userData を必須とし、誤った設定ではuserDataを決める前に終了する。
- Mainのネイティブダイアログは `lifecycle/message-box.ts` のアダプター経由。テストモードでは起動時に環境変数で指定した回答を使い、
  回答がなければキャンセル扱い＋失敗記録。Rendererから回答を注入するIPCは公開しない。
- 通常起動・パッケージ版の表示、多重起動の防止、実ダイアログは変えない。詳細は docs/testing.md。

### Projects（フェーズ5.1）

- ルート: `/projects`（未選択）、`/projects/$projectId`（選択中）。プロジェクトの選択はルートの変更として扱い、
  未保存の編集があれば既存の `useBlocker` が遷移の前に確認する（キャンセル時は画面・選択を変えない）。
- 左サイドバー: プロジェクト一覧（`features/projects/ProjectsSidebar.tsx`）。一覧の順序は `project-order.ts`。
  フェーズ5.5で作成欄を廃止し、最下段の「NEW PROJECT」から `/projects/new` を開くようにした（下記「UIと操作導線（フェーズ5.5）」）。
- メイン: 見出しでの名前編集（`ProjectNameEditor.tsx`）と、そのプロジェクトのタスク一覧・追加欄（5.2。下記「タスク一覧の表示範囲」）。
- 表示の区別: 取得中 / 取得失敗（IPC・DBエラー）/ 存在しないID / 形式が不正なID。取得失敗を「見つかりません」と表示しない。
  判定は `features/projects/project-route.ts` の `getProjectPageState`（DOMに依存しない純粋関数。単体テストあり）。
- Query: `['projects', 'list']`（全件）だけ。詳細用のQueryは作らない。作成後は一覧を取り直し、名前変更は返却DTOで該当行を置き換える。
- 起動時の復元: 保存済みのルートが `/projects/<UUID>` の場合、プロジェクト一覧を取得して存在を確かめる。
  存在しなければ `/projects` へ移動する。取得に失敗した場合は判定せず、そのルートを開いて取得失敗として表示する
  （`resolveStartupTarget`）。明示的なルート（`#/settings` など）で開いた場合は保存値より優先する。
- 完了・取り消し（5.3）: `ProjectCompletionControl.tsx`。5.5で見出しの下から右の詳細パネルへ移した。下記「プロジェクトの完了（フェーズ5.3）」。
- 新規作成（5.5）の名前は、入力済みなら未保存確認の対象（下記）。NEW TASK・NEW MILESTONE の未送信の入力は対象にしない（従来の追加欄と同じ）。

### 未保存の編集（DraftGuard、フェーズ5.1で一般化）

- `features/drafts/DraftGuard.tsx`。対象はタスクのタイトルかプロジェクト名で、方針として同時に1つ。
  編集欄は自分を `{ kind, targetId, isDirty, save, discard }` として登録する。
- 確認ダイアログ（アプリ内）と終了時のダイアログ（Main側）は1つずつで、文言は対象に合わせる
  （終了時は応答の `draftKind` で「タスクのタイトル」「プロジェクト名」を切り替える。Main側の文言は
  `lifecycle/workspace-flush.ts` の `unsavedDraftDialogText`）。アプリ内のダイアログは、閉じるアニメーション中も直前の対象の文言を保つ。
- 保存失敗時（Main側の拒否・DBエラー）はドラフトと理由を残し、画面遷移・終了を続行しない。
- 別の編集を始める前（プロジェクト名の編集開始など）にも確認する。
- 確認の前に、進行中のタスクの保存（所属の変更など）の完了を待つ。失敗していれば移動しない（理由は画面に表示。フェーズ5.2）。

### プロジェクトの完了（フェーズ5.3）

- API: `projects.setCompleted({ id, completed })`。完了可否（所属する未完了タスクが0件か）はMain側がDBで数えて判定する
  （Rendererの一覧・件数を根拠にしない）。拒否時は CONFLICT と型付きの `details`（`project-has-open-tasks`・件数）を返す。
- 画面: 状態を文字でも表示し（「未完了」「完了済み（日時）」）、「プロジェクトを完了」「プロジェクトを未完了に戻す」ボタンを置く。
  - 操作の前に `confirmLeave()`（DraftGuard）を呼ぶ: 進行中のタスク・プロジェクトの保存の完了を待ち（失敗していれば中止）、
    未保存の編集（プロジェクト名・タスクのタイトル）があれば保存／破棄／キャンセルを確認する。保存に成功・破棄した時だけ続行する。
  - 保存中はボタン・名前の編集を無効にする。表示は保存成功後にだけ切り替える。完了しても画面は移動しない。
  - 拒否時は「未完了のタスクが n 件あるため完了できません」と「未完了のタスクを表示」を出す（件数は `details` から。メッセージは解析しない）。
- 「未完了のタスクを表示」: ProjectPage の要求回数（`revealOpenRequest`）を増やし、`TaskScopeView` が状態を「未完了」にし、
  検索で隠れる未完了タスクがあれば検索を消し（`task-rules.ts` の `shouldClearSearchToRevealOpen`）、先頭へスクロールする。
  一覧の読み込み中・取得失敗は従来どおり別の表示で、「未完了0件」と混同しない。新しいルートは作らない。
- 状態フィルターの初期値: `initialStatusForProject`（未完了 → 「未完了」、完了済み → 「完了」）。`TaskScopeView` は
  `key=プロジェクトID` で作り直す時だけ初期値を使うため、同じ画面で完了・取り消しをしてもフィルターは変わらない。
- Sidebar（5.8で区分は廃止。未完了だけを表示）: `groupProjects` で「未完了」「完了済み」の区分（見出しと件数）に分けて表示する。区分内の順序は従来の名前順・タイブレーカー。
  完了済みは文字（「完了済み」）でも示す。選択はルート（プロジェクトID）で決まるため、区分が変わっても維持される。開閉状態は持たない。
- 完了済みプロジェクトのタスク: 未完了へ戻す操作は、詳細のボタンを無効にして理由を表示し、一覧の Space・チェックでは理由を表示して要求しない
  （`reopenBlockedReason`）。保証はMain側（tasks.setCompleted の CONFLICT）。タイトル編集・外への移動・プロジェクト名の編集は可能。
- 更新の競合: 同じプロジェクトの名前変更と完了変更は、タスクと同じ保存キューにキー `project:<ID>` で入れ、順番に送る。
  返却DTOは保存後のプロジェクト全体なので、古いDTOで新しい名前・完了状態をキャッシュから消さない。
- 保存直後の確認（5.3で修正。UIテストで検出した競合）: Enterで保存した直後に別の編集・画面遷移・終了をすると、
  保存済みのタイトルを「未保存」と誤認して確認ダイアログが出ることがあった。次の2点で修正した。
  - 編集欄（タスクのタイトル・プロジェクト名）は進行中の保存を `waitForSave` として DraftGuard に公開し、
    DraftGuard と終了前の問い合わせ（`settle`）は、その保存の後処理が終わってから未保存の有無を判定する。
  - TaskEditor は最後に保存に成功したタイトル（応答DTOのタイトルと updatedAt）を自分の状態として持ち、入力欄の更新と同じ描画で
    比較相手を切り替える（Queryキャッシュからの再描画が少し遅れて届く間も、未保存と判定しない。キャッシュが同じか新しい更新を
    受け取ったらキャッシュの値を使う）。プロジェクト名の編集欄は、保存成功時に同じ描画で編集状態を終えるため該当しない。

### マイルストンとInboxからの紐付け（フェーズ5.4）

- 所属の値: `{ projectId, milestoneId }`（`features/tasks/assignment.ts`）。保存は `tasks.setAssignment` の1回だけ。
- Inboxの紐付け: 各行の「紐付け」ボタン（マウス用。Tab移動の対象は増やさない）と、一覧での `M` キー（現在行）で `AssignMenu` を開く。
  1段目でプロジェクト（未完了だけ。同名は作成日時・IDで判別）を選び、2段目で「このプロジェクトに紐付け（マイルストン未設定）」か
  マイルストンを選んだ時点で1回だけ保存する。Esc・外側のクリックでは保存しない。保存中の行は操作できない。
  保存に成功すると Query キャッシュが更新され、Inboxの範囲から外れて行が消える。失敗時は行を残し、一覧の上に理由を表示する。
- （5.5で置き換え）以下のうち「見出し行とタスク行の1つの仮想リスト」「グループの『タスク追加』」「見出しの下の登録欄」は、
  フェーズ5.5のカード表示・NEW TASK・NEW MILESTONE に置き換えた（下記「UIと操作導線（フェーズ5.5）」）。
- 一覧の意味付け: listbox / option はそのまま。見出し行と「紐付け」ボタンは listbox の外側の重ね合わせ層（`task-list-overlay`）に描画し、
  option の中に操作要素を置かない（表面的な role の追加はしていない）。option の読み上げ名にマイルストン名を含める。
- プロジェクト画面: Tableで絞り込み・ソートしたタスクを `buildTaskGroups` でマイルストン別（作成順、最後に「マイルストン未設定」）に分け、
  `flattenRows` で見出し行とタスク行のフラットな行にして、1つのスクロール領域・1つの仮想リストで描画する。
  キーは見出しが `group:<マイルストンID>` / `group:unset`、タスクがタスクID（衝突しない）。キーボードの現在行の移動はタスク行だけ（見出しは飛ばす）。
  検索・状態・ソートは全グループ共通。空のグループも見出しを表示する。
- グループの「タスク追加」は、上の追加欄の追加先をそのグループに切り替えてフォーカスする（入力欄を仮想行の中に置かない）。
  マイルストン内からの追加は projectId と milestoneId、未設定からは projectId だけを明示して保存する。完了済みプロジェクトでは無効。
- マイルストンの登録欄は見出しの下。名前変更は見出しの「名前変更」で一覧の外に編集欄を開く（`MilestoneForms.tsx`）。
  編集欄は DraftGuard に `kind: 'milestone'` で登録する（画面遷移・別の編集・終了時の確認は既存の仕組みと共通。終了時のダイアログは
  「マイルストン名に未保存の変更があります」の文言になるだけで、別のダイアログは作らない）。
- 詳細パネル: `TaskAssignmentField` の1つの select（optgroup ごとにプロジェクト、「— マイルストン未設定」とマイルストン）で選び、1回で保存する。
- 更新の競合: タスクの更新は従来どおり保存キューで同じタスクごとに順番に送る。マイルストン名の変更はキー `milestone:<ID>` で同じキューを使う。
  所属の保存中の画面遷移・終了は、既存の仕組み（保存の完了を待ち、失敗していれば中断）で取りこぼさない。

### UIと操作導線（フェーズ5.5）

- 左サイドバー（`NavigationPane.tsx`・`ProjectsSidebar.tsx`）:
  - Inbox の件数は行内のバッジ（`nav-inbox-badge`）。集計条件は従来どおり「プロジェクトに属さない未完了のタスク」。0件も「0」と表示する。
    バッジはボタンの一部（別の操作対象にしない・`aria-hidden`）で、読み上げは `aria-describedby`（「未完了のタスク n 件」）で伝える。
    ボタンの名前は「Inbox」のまま。「未完了」という項目名のラベルは表示しない。
  - 表示名を「Projects」から「Project」に変えた（`screens.ts` の表示名だけ。ルート・API・テーブル名は変えていない）。
  - 作成欄と＋ボタンを廃止し、Project配下全体の最下段（区分の外。0件・取得失敗時も）に「NEW PROJECT」を置いた。
- 新規プロジェクト（ルート `/projects/new`、`NewProjectPage`）:
  - 名前の編集部品は既存プロジェクトと共通の `ProjectNameEditor`（`project = null` で新規）。表示時から編集状態で、名前欄にフォーカスする。
  - DBへの作成は、Enter（IME変換中を除く）か「作成」の時だけ（`projects.create` を1回）。開いただけ・blur・空白だけでは作らない。
    作成中の再送信は受け付けない（二重送信の防止）。失敗時は入力と理由を残す。
  - 成功したら作成したプロジェクトの画面へ移る（履歴を置き換える）。移動の前に「未保存なし」にするため、作成済みの入力について確認を出さない。
  - Esc・「キャンセル」は DB を変えずに、NEW PROJECT を押した時の画面へ戻る（`new-project.ts` が覚える。画面内の状態で保存しない）。
  - 未保存の確認: 入力済みの名前は DraftGuard に `kind: 'project'`（対象ID `new`）で登録する。何も入力していなければ確認を出さない。
    画面遷移の確認で「保存」を選ぶと作成してから移動先へ進み、終了時の「保存して終了」でも作成する。
  - 保存前は、マイルストン・タスクの追加を無効にした状態を示し、「先にプロジェクト名を保存してください」と表示する。
    `/projects/new` は lastRoute に保存しない。右の詳細パネルには完了操作を出さない。
- 右の詳細パネル（`DetailPanel.tsx`）: プロジェクト画面でタスクを選択していなければ「プロジェクトの詳細」（名前・作成日時・状態・
  完了／完了の取り消し・拒否時の件数と「未完了のタスクを表示」）。タスクを選択中はタスクの詳細と「プロジェクトの詳細」へ戻る操作
  （タスクのタイトルが未保存なら、既存の DraftGuard の確認を通してから選択を解除する）。メインパネルには状態・完了操作を置かない。
  「未完了のタスクを表示」は WorkspaceContext の要求回数でメインパネルの一覧へ伝える。詳細パネルを閉じている間は完了操作も見えない。
- プロジェクト画面のカード（`features/milestones/MilestoneBoard.tsx`）:
  - `buildTaskGroups` のグループ1つをカード1枚にする（マイルストンの作成順、最後に「マイルストン未設定」、その後に NEW MILESTONE）。
    空のマイルストン・絞り込みで0件になったカードも残す。検索・状態・ソートは全カード共通（ソートはカード列の上の「並べ替え」）。
  - カードはメイン領域の中で横に並べ、収まらない分はカード列（`milestone-board`）だけを横スクロールする。カードの高さは利用できる高さに合わせ、
    タスクはカードの中で縦スクロールする。MainPanel を `position: relative` にし、絶対配置の非表示テキストもメイン領域で切り取る
    （ウィンドウ全体を横スクロールさせない）。
  - 仮想化: カードごとに `TaskList`（`variant="card"`）の仮想リストを1つずつ持つ。5.4の「見出し行＋タスク行の単一フラット行モデル」
    （`flattenRows`）は廃止した。キーはタスクID（1つのタスクは1枚のカードにだけ入る）、option の ID も衝突しない。
  - キーボード: 一覧の中は従来どおり（↑↓・Home/End・PageUp/Down・Enter・Space）。← → で隣のカードの一覧へ。Tab で各カードの
    「名前を変更」・一覧・NEW TASK・幅のハンドル、最後に NEW MILESTONE へ。見出しと操作は listbox の外にある（option の中に操作要素を置かない）。
    aria-activedescendant は描画済みの行だけを参照する。空のカードは一覧全体の枠線でフォーカスを示す。
  - NEW TASK・NEW MILESTONE は共通の `components/InlineCreate.tsx`: その場の入力欄、Enter（IME変換中を除く）・「追加」で登録、
    Esc・「キャンセル」で閉じる、空白だけでは登録しない、登録中は再送信しない、失敗時は入力と理由を残す。登録先は各カードが固定して渡す
    （マイルストンのカードは projectId と milestoneId、未設定のカードは projectId と milestoneId = null）。完了済みプロジェクトでは無効。
  - マイルストン名の変更は、カード見出しの「名前を変更」で、その見出しの位置に `MilestoneNameEditor` を開く（DraftGuard の kind: milestone は従来どおり）。
- カードの幅（全カード共通。Workspace設定 `milestoneCardWidth`）:
  - 各カードの右端に幅のハンドル（`role="separator"`・`aria-valuenow/min/max`）。どのハンドルでも全カード（未設定を含む）が同じ幅になる。
  - ドラッグ中はボード内の一時的な幅で即時に表示し、保存しない。pointer capture でカードの外へ出ても続け、ドラッグを終えた時に1回だけ
    WorkspaceContext へ確定する（既存の latest-wins の保存キュー・IPC・Zod検証で保存）。pointercancel・Esc・capture の喪失・アンマウントでは
    元の幅に戻して保存しない。キーボードは ← → で ±16px（Shift で ±64px）、Home／End で最小／最大。
  - 範囲は 240〜640px（5.8で最小144px）、既定 320px（`WORKSPACE_LIMITS.milestoneCardWidth`。Mainの保存要求の検証・読み取り時の補正・Rendererの丸めで共通）。
    ウィンドウ幅が狭くても保存値は変えない（カード列が横スクロールする）。左右のペインの幅（sidebarWidth・detailWidth）とは独立。

### 削除と所属ルール（フェーズ5.6）

- 所属ルール: 表示中のタスクは「Inbox（projectId・milestoneId ともに null）」か「プロジェクトとそのマイルストン」のどちらか。
  プロジェクトだけの所属・「マイルストン未設定」のカード・選択肢・追加先・紐付けメニューの「このプロジェクトに紐付け」は廃止した。
  組み合わせの整合性は Main（Zod＋TaskService）で検証する。マイルストン0件のプロジェクトは存在できるが、タスクは追加・紐付けできない
  （カード列の左端に NEW MILESTONE だけを表示（5.7で案内文は削除）。紐付けメニュー・詳細パネルの選択肢では選べない項目として理由を示す）。
- 新規プロジェクト: 名前の保存時に `projects.create` 1回で、プロジェクトと「新しいマイルストン」を1つのトランザクションで作る。
  NEW PROJECT を押しただけでは作らない。二重送信は既存の仕組み（ProjectNameEditor の in-flight）で防ぎ、マイルストンは重複しない。
  最後のマイルストンを削除しても作り直さない。
- 削除由来の非表示: tasks.hidden_at（tasks）と milestones.project_id = NULL（マイルストン）。Main の一覧・件数・更新は表示中の行だけを扱うため、
  Renderer は全件Queryから導出する一覧・件数（Inbox・バッジ・カード・検索・紐付け・完了判定）で、追加の除外処理なしに非表示データを含まない。
  通常の「Inboxへ戻す」（所属の解除）は hidden_at を設定しないので、従来どおりInboxに表示する。復元の操作は今回追加していない。
- タスクの削除（`features/tasks/TaskDeletion.tsx`）:
  - 入口: Inbox・カードの行の「…」（listbox の外側の重ね合わせ層。Tab移動の対象外）・右クリック・一覧での Shift+F10 / ContextMenu キー
    （行のメニュー: Inbox は「紐付け…」「タスクを削除…」、カードは「タスクを削除…」）・Delete / Backspace キー（確認ダイアログを直接開く）。
  - 流れ: DraftGuard.settle（保存キュー・編集欄の保存の完了を待つ）→ 対象のタスク名を示す確認（対象に未保存のタイトルがあれば、失われることも示す）
    → 削除（同じタスクの保存キューに並べ、先に始めた更新の後に実行）→ 成功時は対象の編集だけを破棄し、選択中なら選択を解除する。
    キャンセルは何も変えない。失敗時はダイアログに理由を表示し、行・選択・入力を残す。確認・削除中は次の要求を受け付けない（二重実行の防止）。
- マイルストンの削除（`MilestoneBoard.tsx` の見出しのメニュー「…」→「マイルストンを削除…」）:
  - DBで数えた所属タスクの件数（`milestones.getDeletionSummary`）が0なら確認なしで削除。1件以上なら、名前・件数・「タスクは削除されず、
    画面に表示されなくなる」ことを示して確認する。表示中の件数（絞り込み後）では判定しない。
  - 削除時に確認した件数を渡し、Main で件数が変わっていたら（`deletion-scope-changed`）、確認内容を取り直して再確認する（削除範囲を無断で広げない）。
  - 成功時は対象のマイルストン名・所属タスクの未保存の編集だけを破棄し、選択中のタスクが所属していれば選択を解除し、マイルストン・タスクの一覧を取り直す。
- プロジェクトの削除（右の詳細パネルのプロジェクトの詳細、`ProjectDeleteControl.tsx`）:
  - 未完了・完了済みのどちらでも削除できる（完了操作とは別のボタン。完了の条件は適用しない）。
  - 確認: 名前・マイルストン数・タスク総数（既に表示されていないものを含む）・「配下は残るが画面に表示されなくなる」。件数の変化は再確認。
  - 成功時は、このプロジェクト・配下のマイルストン・タスクの未保存の編集だけを破棄し、タスクの選択を解除して Inbox へ移る。
    一覧から除外し、プロジェクト・マイルストン・タスクの一覧を取り直す。新規プロジェクトのキャンセル時の戻り先が削除したプロジェクトなら `/projects` に戻す。
    初期版にタブはないため、整理する対象は表示中の画面（ルート）と lastRoute（移動後の Inbox が保存される）。
- 破棄（DraftGuard.discard・各編集欄の discard）は、再描画を待たずに「未保存なし」にする（破棄の直後の画面移動で、破棄した入力について確認を出さない）。
- 既知の制約: Main は SQLite を同期的に使うため、DBの書き込みが他の接続のロックを待つ間（busy_timeout 最大5秒）は Main が止まる。
  自動テストで外部から書き込みロックをかけた時、トランザクションでない既存の更新（タイトルなど）は待たずに失敗した（INTERNAL）。

### メインパネルの簡素化（フェーズ5.7）

- 表示の整理だけで、操作・保存・所属・削除の仕様は変えていない。
- Inbox: タイトル行「Inbox」、説明行「プロジェクトに属さないタスク」を表示しない。Project（未選択・新規・個別）: 画面種別の「Project」の行を表示しない
  （個別のプロジェクト名とその編集、NEW PROJECT の名前欄へのフォーカスは従来どおり）。
  `Page` の `titleHidden` で見出し（h1）を視覚的に隠して残す（読み上げの見出し。行の高さ・余白は取らない）。設定などの他の画面は変更していない。
- 一覧の下の操作説明（「一覧の操作: 〜」）を削除し、一覧（listbox）の `aria-describedby` も外した。一覧の名前（aria-label）とキー操作
  （↑↓・Enter・Space・M・← →・Delete・Shift+F10 / ContextMenu）・右クリックのメニューはそのまま。
- マイルストン0件: 案内文を削除し、カード列の左端に NEW MILESTONE だけを置く（メインパネルの余白の内側）。0件になった時はカード列を先頭へ
  スクロールする。マイルストンがあれば従来どおりカード列の末尾。

### トップバー・ステータスバー・サイドバー（フェーズ5.8）

- 画面枠の差し込み先 `components/ShellSlots.tsx`: トップバーの `top-bar-controls`、ステータスバー中央の `status-count`。
  `TaskScopeView` が検索・状態・並べ替え（Project）と件数を React のポータルで描画する。状態は従来どおり `TaskScopeView`（検索・状態）と
  各ページ（ソート）が持ち、画面枠には複製しない。範囲を切り替えると `key` で作り直されて初期化される（従来の保持範囲）。
  画面側がアンマウントされると表示も消えるため、他画面の設定・件数は残らない。差し込み先は常に描画されるので、入力中に作り直されない。
- トップバーの高さは `TOP_BAR_HEIGHT`（40px。5.7までは32px）。AppShell の grid の行に使い、メイン領域は残り（1fr）。
  ネイティブのタイトルバーを使っており、ドラッグ領域（`-webkit-app-region`）はない。差し込み先は縮められ（入力欄は最小96px）、
  切り替えボタンは縮めない。ウィンドウ最小幅（752px）で操作が重ならないことをUIテストで確認している。検索のショートカットは既存にない。
- ステータスバー: `minmax(0, 1fr) auto minmax(0, 1fr)` の grid。左右を同じ幅の列にして中央の件数の位置を固定し、狭い時は左右を省略表示する。
  件数は Table の絞り込み結果（Project は全カードの合計）で数え、仮想化の描画行数は使わない。非表示タスクは一覧の取得（Main）で除かれる。
  読み込み中・失敗時は件数を出さない。
- サイドバー（`ProjectsSidebar`）: 未完了のプロジェクトだけを区分なしで並べる（`groupProjects(...).open`）。同名の判別は表示する一覧の中で行う。
  完了したプロジェクトは一覧から消えるが、開いている画面はルートで決まるため閉じない（状態表示・完了の取り消しは右の詳細に残る）。
  折りたたみ中の「選択中」も未完了のプロジェクトだけ。
- 最小幅: `WORKSPACE_LIMITS.sidebarWidth.min` 180→108、`milestoneCardWidth.min` 240→144（Rendererのパネル・ハンドル・丸め、Mainの保存検証・
  読み取り時の補正で共通）。既定・最大は変えない。保存済みの幅は新しい範囲内なのでそのまま読み込む。
  ウィンドウ最小幅（`MIN_WINDOW_WIDTH`）はサイドバーの最小幅から計算していたが、従来の752pxのまま固定した（ウィンドウの最小サイズは変えない）。
  狭いサイドバーでは項目名・プロジェクト名を省略表示し、バッジ・折りたたみボタンは縮めない。カードの行は高さ固定・1行の省略表示のため、
  幅を変えても仮想化の計測は変わらない。

### Inboxの一括操作・インライン編集・順序・レイアウト・終了処理（フェーズ5.9）

- 右サイドバー（Inbox）: `DetailPanel` の Inbox 用の表示を「紐付け先」（`features/tasks/AssignTargetTree.tsx`）と「タスク詳細」のタブにした
  （右パネルは従来の1つ。幅の変更・保存も従来どおり）。表示中のタブは `WorkspaceContext.inboxPanel`（保存しない）。Inboxに入ると
  `enterTaskScope('inbox')` で紐付け先に戻す。詳細から紐付け先へ切り替える時は、表示中のタスクの未保存タイトルを既存の確認に通す。
- 複数選択（`features/tasks/selection.ts`。DOMに依存しない純粋関数）: 選択集合と範囲選択の基準行は `TaskScopeView`、現在行は `TaskList` が持つ。
  データのIDで持つため仮想化で行がアンマウントされても失わない。表示中のIDの集合が変わると `pruneSelection` で外れたIDを除く。
  操作の対象は `operationTargets`（起点の行が選択に含まれれば表示中の選択、含まれなければその行だけ）。
- ドラッグ＆ドロップ（`features/tasks/TaskDragContext.tsx`）: 依存を追加せず Pointer Events で実装した（HTML5 DnD は使わない）。
  メイン（一覧）と右パネル（ツリー）をまたぐため、`AppShell` に置く。行の押下から5px動いたら開始し、`document.elementFromPoint` で
  `data-drop-milestone-id`（ドロップ先）・`data-drop-blocked`（不可と理由）を判定する。`data-drag-autoscroll` の領域の上下端で自動スクロールする。
  Esc・ウィンドウのフォーカス喪失・ポインターの取り消し・ドロップ先以外では保存しない。保存は呼び出し側（一括API）。
- 一括API: `tasks.assignFromInbox`・`tasks.deleteMany`・`tasks.reorderInMilestone`・`milestones.reorder`（docs/ipc-api.md）。
  Renderer では `taskSaveQueue.runMany`（対象すべての進行中の更新の後に1回だけ実行し、その間に届いた更新は後ろに並べる）で送る。
  `usePendingTaskIds` は一括操作の `ids`・`orderedIds` も保存中として扱い、行を薄く表示して重ねて操作できないようにする。
- 削除（`TaskDeletion.tsx`）: 確認ダイアログを廃止。進行中の保存を待ってから削除し、成功したら対象の未保存の編集だけを破棄する（`discard`）。
  失敗時は一覧の上に理由を出し、行・選択・入力を残す。マイルストン・プロジェクトの削除（確認あり）は変えていない。
- インライン編集（`features/tasks/inline-title-edit.tsx`）: 状態（対象・入力・エラー・保存中）は `TaskScopeView` の `useInlineTitleEdit` が持ち、
  DraftGuard に `kind: task` で登録する（終了・遷移の確認に乗る）。保存は既存の `useUpdateTaskTitleMutation`（同じタスクの保存キュー）。
  入力欄は listbox の外側の重ね合わせ層に、編集中の行の位置で描画する（option の中に textbox を置かない）。仮想化の `rangeExtractor` で
  編集中の行を常に描画し、スクロールで入力欄をアンマウントしない。入力欄のキーは一覧のショートカットへ伝えない。
  詳細パネルの `TaskEditor` は、保存済みのタイトルが他の経路で変わった時、未編集なら新しい値に合わせ、編集中の入力は変えない（巻き戻さない）。
- タスクの手動順: Table の非表示列 `manual`（`compareManualOrder`: position → 作成日時の古い順 → ID）。プロジェクトの既定の並べ替えは手動順
  （`DEFAULT_PROJECT_SORTING`。並べ替えの状態は従来どおり ProjectPage が持ち、保存しない）。ハンドル・Alt+↑↓ でカードの表示順を組み替え、
  そのカードの全タスクの順序を保存する。絞り込み中（検索あり・状態が「すべて」以外）は無効（一部の行だけで順位を保存しない）。
  手動順以外の並べ替えで操作した場合は、表示していた順序を保存し、保存に成功したら並べ替えを手動順へ切り替える（その旨を表示する）。
  画面は保存に成功した応答で並べ替える（先に画面だけを動かさない）。
- カードの順序: `MilestoneBoard` の見出しのハンドル（`CardMoveHandle`）。ドラッグはカードの中央を基準に挿入位置を決め、column は左右・row は上下。
  キーボードは ←↑／→↓／Home／End。順序は `sortMilestones`（position → 作成日時）で、Main の一覧と同じ規則。
- レイアウト: Workspace設定 `milestoneLayout`（`column` / `row`。既定 column。旧形式は column で補い、補正扱いにしない）。
  row ではカードを縦に並べてメイン領域の横幅を使い、カード内の一覧は最大8行分の高さで仮想化を維持する。幅のハンドルは出さず、`milestoneCardWidth` は保持する。
- 終了処理: `ExitCoordinator` の `closeQuitsApp`（×＝ウィンドウの close をアプリの終了要求として扱う）と、`window-all-closed` での `app.quit()`。
  ×・⌘Q・SIGINT/SIGHUP/SIGTERM は同じ保存確認（Rendererへの問い合わせ・ダイアログ）を通る。再入は従来の状態管理で防ぐ。
  シグナルは ready 後に `handleShutdownSignals` が `process.on` で登録し、`app.quit()` を呼ぶ（Electron（Chromium）の既定の処理は
  2回目のシグナルで確認を待たずに即時終了するため置き換えた。何回届いても確認は1回）。
  開発起動（未パッケージで `ELECTRON_RENDERER_URL` がある時）だけ、`lifecycle/parent-watch.ts` が親プロセス（electron-vite）の消失を
  `process.ppid` の変化で検知し、1回だけ `app.quit()` を呼ぶ（強制終了はしない。終了時に監視を止める）。
- 開発起動のプロセス構成（調査結果）: `npm run dev` → `electron-vite dev`（Node。Viteの開発サーバーとビルドを同じプロセス内で動かす）→ Electron（とその
  ヘルパー）。electron-vite は Electron の終了（close）で自身も `process.exit` し、SIGINT・SIGTERM・SIGHUP を Electron へ転送する。
  以前は macOS で最後のウィンドウを閉じても Electron が終了しない方針だったため、Electron が残り、それを待つ electron-vite（開発サーバー）と npm も残っていた。
  また Ctrl+C では、端末からの SIGINT と electron-vite が転送する SIGINT の2回が Electron に届き、Chromium の既定の処理が2回目で即時終了していた
  （保存確認・DBを閉じる処理を通らない）。上記の置き換えで、2回届いても保存確認を通って終了する（自動検証で確認）。
  開発サーバーのポートは `GTD_DEV_RENDERER_PORT`（自動検証用。通常は未設定）で固定できる。

### 期限と Summary Review（フェーズ6）

- 日付のみの値は `src/shared/date-only.ts`（副作用なし）: 実在する暦日の判定（うるう年・月の日数）、ローカルの暦日（`getFullYear` 等）、
  暦日の加算（年・月・日で計算し、24時間のミリ秒を足さない）、Summary の期間、次のローカルの0時までの時間。日付のみの値を日時へ変換しない。
- 期限の更新は用途限定の `tasks.setDue`（今日／明日／日付指定／解除）。今日・明日は Main が操作の時点の `now()` のローカルの暦日で決める。
  期限だけを更新し、同じ値なら更新しない（updatedAt を変えない）。表示中の行だけ（削除・非表示の後に届いた保存は NOT_FOUND）。
  Renderer では同じタスクの保存キューに並べる（タイトル・所属・削除と順番）。
- 行の期限表示・期限設定アイコン（共通のタスク行。当初は行のメニューの「期限 ›」）から `TaskDue.tsx` の期限のメニュー・日付指定のダイアログ（`type=date`）。
  閉じた後はその行の一覧（listbox）へフォーカスを戻す。期限の表示（`due-format.ts`）は文字列の年・月・日から作る。
  行ではタスク名を先に縮め、期限は最後に省略表示する（最小のカード幅でもハンドル・メニューと重ならない）。
- Summary Review: `summary.get`（`services/summary-service.ts`）。取得の時点のローカルの今日から期間を求め、
  `tasks.dueto BETWEEN 今日 AND 7日後`（未完了・表示中。索引 `tasks_dueto_idx`）をプロジェクト・マイルストンと結合して取得し、期限で振り分ける。
  画面（`routes/SummaryPage.tsx`）は見出し・行を1つの仮想リストで描画し、件数をステータスバーへ（ShellSlot）。トップバーの差し込みはしない。
- 更新: Query のキーにローカルの日付を含める（`['summary', 日付]`。前日の結果を新しい日付の画面に出さない）。`refetchOnMount: 'always'`。
  タスク・プロジェクト・マイルストンの更新の成功時に `MutationCache` で Summary を古いものとして扱う（期限・完了・削除・非表示化・名前・所属）。
  日付の確認: 次のローカルの0時のタイマー・ウィンドウの focus・表示の再開（visibilitychange。スリープ復帰を含む）・60秒ごと。いずれもアンマウントで解除する。
- 自動テストだけ、Main の現在時刻を `GTD_TEST_CLOCK_FILE`（テストモードのみ）でずらせる。タイムゾーンは起動時の `TZ` で固定する。

### 共通のタスク行（TaskRow。2026-11-11）

- `features/tasks/TaskRow.tsx`: 行の表示と行内の操作の共通部分（Inbox・カード・Summary）。2行構成（`TASK_ROW_HEIGHT` 52px。仮想化の行の高さ）。
  - 行の本体は listbox の option（チェックボックスはマウス用の見た目で aria-hidden・Tab 対象外。タスク名は文字だけ）。
  - 星・期限・紐付け・「…」・並べ替えのハンドル・インライン編集の入力欄は、同じ部品から一覧の外側の重ね合わせ層へ `createPortal` で描画する
    （option の中に操作要素を置かない。ボタンは読み上げの対象で Tab 対象外。押してもフォーカスを一覧から移さない）。
    重ね合わせ層のイベント（クリック・押下・フォーカス・キー）は行・一覧へ伝えない。
- `features/tasks/use-task-row-actions.tsx`: 行内の操作（完了・お気に入り・期限・1件の紐付け／所属変更・1件の削除・「…」・編集モーダル・インライン編集）を
  3画面で共通に作る。画面は保存後の後処理（Inbox の選択から外す・詳細の選択の解除）だけをコールバックで渡す。
  紐付けは Inbox のタスクなら `tasks.assignFromInbox`（1件）、プロジェクト所属なら `tasks.setAssignment`。
- `features/tasks/TaskList.tsx`: 一覧（listbox）・キーボード・Inbox の複数選択とドラッグ・カードの並べ替え。行は TaskRow。
  `variant`: table（Inbox。並べ替えの見出し）/ card / section（Summary。外部のスクロール領域を `scrollMargin` で共有して仮想化）。
  タスク名のクリックは `pending-click.ts` で少し待ち（ダブルクリックならインライン編集・ドラッグ／他の操作／アンマウントで取り消し）、編集モーダルを開く。
- `features/tasks/TaskEditDialog.tsx`: 編集モーダル（TaskEditor をそのまま使う）。開く前・閉じる前に DraftGuard の確認。削除されたら閉じる。
  閉じた後は開いた時に決めた一覧へフォーカスを戻す（`TaskDue.tsx` の `useFocusReturn`。描画の確定後に移す）。
- お気に入り: `tasks.setFavorite`（目的の状態）。`features/tasks/favorite-saver.ts` が同じタスクの保存キューに並べ、保存中の連打は待ちを1つにまとめて
  最後の状態を保存する（画面は押した直後から目的の状態）。失敗時は目的の状態を捨て、一覧を取り直して保存済みの値に戻す。行を「保存中」にはしない。
- 期限の表示: `lib/local-day.tsx`（アプリ全体で1組のタイマー。0時・focus・visibilitychange・60秒）。日付は `summary.today`（Main の `now()` の
  ローカルの暦日）で決め、保存の「今日」「明日」・Summary の判定と揃える。`due-format.ts` の `dueLabelOf` が暦日の差で表示を決める。
- Summary: Main の取得結果に一覧の Query の新しい方の値を重ね、`shared/summary-sections.ts`（Main と共通）で振り分け直す
  （`features/summary/summary-merge.ts`）。完了・期限の変更・削除は保存の直後から反映し、所属の変更だけでは外さない。

### Summary Review の4区画・プロジェクトのフィルター・完了管理（2026-11-12）

- `routes/SummaryPage.tsx`: CSS グリッド（2列×2行・`minmax(0, 1fr)`）。外枠はグリッドの枠線、中央の罫線は左の列の右・上の行の下だけ（二重線にしない。
  色は `theme.ts` の `vscodeColors.gridLine`）。各区画は見出しと `TaskList`（variant="section"。区画ごとに独立したスクロールと仮想化。
  区画の寸法の変化は virtualizer がスクロール領域の大きさを監視して測り直す）。
- 取得: `summary.get` が7日後までの未完了・表示中・期限ありを取得し、`shared/summary-sections.ts` で Today／Tomorrow／This Week／Overdue に振り分ける
  （Renderer の保存直後の振り分け直しも同じ関数）。
- プロジェクトのフィルター: `features/summary/summary-project-filter.ts`（OFF にしたプロジェクトの ID の集合。Renderer のモジュールの状態でセッション中だけ）、
  右サイドバー `features/summary/SummaryProjectFilter.tsx`（`DetailPanel` の `/summary` の内容。右サイドバーは画面ごとに切り替える）、
  `summary-merge.ts` の `filterSummaryByProjects`・`summaryTotal`（件数はフィルター後の対象の数）。
- TaskRow の2行目: 左寄せ。タスク名の列の左端から同じ距離（`TEXT_INSET`）にタスク名の文字と星のアイコンを置く。操作ボタン（20px）を先に確保し、
  所属（`useTaskRowActions` の `assignmentLabel`。プロジェクト・マイルストンの一覧の Query から名前を引く）は残りの幅で省略表示。
- 完了管理: タスクは `done_on`（完了状態はその有無）。プロジェクトは `done`・`done_on`（`ProjectRepository.updateDone` が同じ更新で書き換える）。
  完了済みプロジェクトの判定（サイドバー・紐付け先・追加の制限・タスクの再開の制限）は `done` に統一。マイルストンは `done`・`done_on` を持つだけ。

### タスク一覧の表示範囲と所属（フェーズ5.2）

- 表示範囲 `TaskScope`: `{ kind: 'inbox' }`（プロジェクトに属さないタスク）/ `{ kind: 'project', projectId }`
  （`features/tasks/task-scope.ts`）。Inboxは初期版の暫定定義で、「未整理」と同じ意味とは扱わない。
- 共有コンポーネント `features/tasks/TaskScopeView.tsx`: 追加欄・検索・状態の切り替え・件数・一覧を、範囲を受け取って表示する。
  InboxPage と ProjectPage はそれぞれ見出しと範囲・追加先の文言を渡すだけ（汎用の画面基盤は作っていない）。
- 追加欄（`TaskQuickAdd`）は追加先を表示し（「〈プロジェクト名〉に追加」、Inboxは「追加先: Inbox」）、作成時に `projectId` を明示的に渡す。
  完了済みプロジェクトでは無効にし、理由を表示する（Main側でも拒否する）。
- Query / Table / Virtual: 全件Query（`['tasks', 'list']`）を唯一のデータキャッシュのまま使い、範囲はTableの非表示列（`scope`）の
  列フィルターとして、状態・検索と組み合わせる。範囲ごとのQueryやDBページングは作らない。行ID・キーボード操作・読み上げは共通。
- プロジェクトの切り替え: ルートの変更なので、未保存の確認（useBlocker）が承認された後で切り替わる。
  `TaskScopeView` を `key=プロジェクトID` で作り直して検索をリセットし、状態を初期値へ戻す（未完了のプロジェクトは「未完了」、
  完了済みは「完了」。5.3で調整）。ソートは ProjectPage が持ち、維持する。
  タスクの選択は WorkspaceContext の `enterTaskScope` で、別の範囲を開いた時に解除する（同じ範囲へ戻った時は維持。
  Inbox ↔ プロジェクトの移動でも解除する）。キャンセル時はルートが変わらないので、画面状態はそのまま。
- 詳細パネル（Inbox・プロジェクトの画面で表示）に所属の選択（`TaskProjectField.tsx`）。ネイティブの select。
  - 「未所属（Inbox）」と未完了のプロジェクトを選べる。同名のプロジェクトは作成日時とIDの先頭8文字を付けて区別する（`project-options.ts`）。
  - 現在の所属が完了済みなら「〈名前〉（完了済み）」として表示する（選択不可。空欄・未所属に見せない）。一覧を取得できない時も未所属に見せない。
  - 選んだら即時保存。保存中は選んだ値と「保存中…」を表示し、同じタスクへの操作を無効にする。失敗時は保存済みの所属に戻し、理由を表示する。
  - 所属を変えて一覧から外れても、詳細とタイトルのドラフトはそのまま表示し、「現在の一覧の対象外」と表示する。
- 更新の競合: 同じタスクへの更新（タイトル・完了・所属）は `features/tasks/task-save-queue.ts` で順番に1つずつ送る。
  - 各応答は保存後のタスク全体なので、後の応答が常に新しい。タイトル保存の応答が新しい所属を、所属変更の応答が新しいタイトルを古い値で上書きしない。
  - タイトルのドラフトはTaskEditorの状態で、Queryの更新では作り直さない（`key=タスクID`）。所属の保存成功でドラフトは変わらない。
  - UIでも更新中は同じタスクの保存ボタン・完了・所属の選択を無効にする（再描画前の同時要求はキューで順番に処理される）。
- 所属の保存中に、別タスクの選択・画面遷移（DraftGuard）や、ウィンドウを閉じる・終了（終了前の問い合わせ）が要求された場合:
  保存の完了を待ってから進む。失敗していれば移動・終了を中断し、理由を画面に残す（黙って失敗・破棄させない）。
  終了時は `draft-save-failed` として応答し、Main側はダイアログを重ねずに中断する。

### 画面枠（AppShell）

`src/renderer/src/layouts/shell/`

```text
TopBar（固定）
Navigation（幅広。旧 Sidebar の Panel を使う）| MainPanel | DetailPanel   ← react-resizable-panels の Group
StatusBar（固定）
```

- フェーズ5.4で、固定48pxのアクティビティバーと独立したSidebarを削除し、1つの幅広ナビゲーション（`NavigationPane.tsx`）にした。
  中身は Inbox（未完了件数）/ Projects（登録欄・未完了と完了済みの区分つき一覧。折りたたみ可、折りたたみ中も選択中の名前を表示）/ 設定。
  フェーズ5.5で、Inbox の件数をバッジにし、表示名を Project にし、登録欄を最下段の NEW PROJECT に置き換えた（上記「UIと操作導線（フェーズ5.5）」）。
  ナビゲーション全体を縦スクロールする。幅は従来の左ペインの希望幅（Workspace設定の `sidebarWidth`、既定240px、180〜480px。5.8で最小108px）を
  そのまま使う（保存形式・キーは変えない。既存の設定を書き換えない）。境界線の名前は「ナビゲーションの幅を調整」。
  ウィンドウの最小幅の計算からアクティビティバーの48pxを除いた。
- Navigation・DetailPanelは `groupResizeBehavior="preserve-pixel-size"`、MainPanelが残りの幅を使う。
- 各ペインは縦方向だけスクロールし、ウィンドウ全体には横スクロールを出さない。
- 境界（Separator）はキーボード操作（矢印・Home/End）とARIA属性をライブラリが提供する。
- 幅は「希望幅（保存する値）」と「実寸（表示する値）」を分ける（フェーズ3.1）。
  処理は `src/renderer/src/features/workspace/use-pane-layout.ts` と `pane-layout.ts`。
  - 希望幅を更新するのは、ユーザーが境界線を直接操作した時だけ。
    Groupの `onLayoutChanged` のうち `isUserInteraction` が true のものだけを扱い、
    操作した境界線（Separatorの onPointerDown / onKeyDown で記録）に対応するペインの希望幅だけを更新する。
    記録がない場合は幅の増減から判定する（両方変わった時は広がった側）。
  - 実寸は、希望幅・表示可能な幅・最小幅から計算し、`groupRef.setLayout()` で適用する。
    幅が足りない時は、直前に操作していない側のペインから最小幅まで縮める。
    この適用はユーザー操作として通知されないため、保存されない。
  - ウィンドウサイズ変更（ResizeObserver）・詳細パネルの開閉・起動時の復元では、実寸の再計算だけを行う。
  - ドラッグ中（`onLayoutChange`）はDBに書き込まない。
- 境界線のダブルクリックは、ライブラリ既定の動作（`disableDoubleClick`）を無効にし、
  Separatorの onDoubleClick で対象ペインを既定幅（サイドバー240px・詳細300px）に戻して、その希望幅だけを保存する。
  ダブルクリック・ドラッグの判定範囲は、境界線の要素幅（6px）と `resizeTargetMinimumSize.fine` を一致させている。
- ドラッグ中のペインにMotionの補間は使わない。
- DetailPanelは既存のタスク一覧Queryのデータから選択中タスクを探して表示する（詳細取得APIは追加しない）。

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

### タスク一覧（フェーズ4のInbox一覧。5.2からInbox・プロジェクトで共有）

| 役割 | 担当 | 実装 |
|---|---|---|
| 取得・更新・キャッシュ | TanStack Query | `features/tasks/task-queries.ts`（一覧は全件。一覧・詳細・件数の唯一の正本） |
| 絞り込み・ソート・行モデル | TanStack Table v9 | `features/tasks/task-table.ts`（features・columnsはモジュールで固定） |
| 表示範囲の行だけを描画 | TanStack Virtual | `features/tasks/TaskList.tsx`（固定行高34px、`getItemKey` はタスクID） |
| 見た目・入力 | MUI | 検索欄、表示切り替え（ToggleButtonGroup）、チェックボックス、ボタン |

- 取得した全件に対して、クライアント側で絞り込み・ソートを行う（DBページング・サーバー側ソートはしない）。
  仮想化は描画量を減らすだけで、DBからの取得件数は減らない。
- 絞り込み: 表示範囲（所属。非表示列 `scope`。フェーズ5.2）、タイトルの部分一致（大文字・小文字を区別しない `includesString`）、
  未完了／完了／すべて（doneOn から導出する非表示列への列フィルター）。初期表示は未完了。
- ソート: 作成日時（初期は降順。同じ日時はIDで比較し、DBと同じ順序）とタイトル（日本語照合・数字は数値として比較）。
- 検索・表示切り替え・ソートは画面内の状態で、保存しない。条件が変わった時だけ先頭へスクロールし、
  更新後のキャッシュ反映では戻さない。

一覧の意味付けとキーボード操作:
- 1件選択のリスト（`role="listbox"` / `role="option"`、`aria-selected`）。
  列見出しは表ではなく「並べ替えボタン」として実装する（`aria-sort` を使う表の意味付けはしていない）。
- DOMフォーカスはリスト本体に置き、現在行は `aria-activedescendant` で示す（仮想化で行要素が入れ替わってもフォーカスを失わない）。
- 上下キー・Home/End・PageUp/PageDownで現在行を移動し、未描画なら `scrollToIndex` で表示する。
  Enter で現在行を選択、Space で現在行の完了／未完了を切り替える（フェーズ4.1）。
  キーボードの現在行（枠線）と選択（背景色）は区別する。
- フォーカスが入った時はスクロールしない（クリック時に表示位置が動いて別の行を押さないため）。
- 完了操作（フェーズ4.1）: listboxの意味付けは維持し、完了は一覧のキー操作（Space）として提供する。
  - 採用理由: 1行あたりの操作が完了だけで、gridにするとセル単位の2次元移動・行選択との両立が必要になり複雑になるため。
    option内に操作要素を置かず、Tab移動の対象も増やさない（大量データで長いTab移動にならない）。
  - 操作方法は一覧の下に表示し、`aria-describedby` で一覧に関連付ける。
  - 行の読み上げ名は「タイトル、完了／未完了、作成日時」。完了切り替えの結果は `aria-live="polite"` で知らせる。
  - 行のチェックボックスはマウス用（読み上げ対象外・Tab対象外）。チェック操作は行選択を起こさない。
  - 編集中のタスクへの完了操作は、既存の未保存ドラフトの確認を通る。
- フォーカス管理（仮想化との整合）:
  - `aria-activedescendant` は描画済みの行だけを参照する。未描画の行へ移動した時は、スクロール後の再描画で参照する。
  - 現在行はタスクIDで持つ。ソート・検索・表示切り替えの後は、今の一覧からIDで位置を求める（古い行番号は使わない）。
  - 完了で現在行が一覧から消えた場合は、直前と同じ位置の行（末尾なら最後の行）を現在行にする。空になってもフォーカスは一覧に残る。
  - 入力欄・確認ダイアログのキー操作は一覧へ伝わらない（一覧のキー処理は一覧自身がフォーカスを持つ時だけ。ダイアログはキーイベントの伝播を止める）。
- 完了は色だけでなく、チェックと取り消し線でも示す。
- 選択中のタスクが絞り込みで一覧から消えても、詳細パネルには表示し続け、一覧の上にその旨を表示する。

### 詳細パネルの編集と未保存の編集（フェーズ4）

- タイトルは明示的な保存方式（保存ボタン・Enter）。入力のたびには保存しない。IME変換確定のEnterでは保存しない。
- 入力中の値はドラフトとして `TaskEditor`（key=タスクID）が持つ。一覧の再取得やキャッシュ更新で上書きしない。
  保存成功後にだけ保存済みの値へ切り替え、失敗時は入力を残す。
- 未保存の編集がある時の確認（`features/tasks/DraftGuard.tsx`）:
  - 別タスクの選択、他画面への遷移（Routerの `useBlocker`）、詳細パネルを閉じる、そのタスクの完了操作の前に
    アプリ内の確認ダイアログ（保存 / 破棄 / キャンセル）を1つだけ表示する。
  - 終了・ウィンドウを閉じる時は、既存の終了フローの応答に `unsaved-draft` を返し、
    Main側の同じダイアログで「保存して終了 / 保存せずに終了 / キャンセル」（閉じる場合は「…閉じる」）を選んでもらう
    （フェーズ4.1。独立した終了ダイアログは重ねない）。

## Routerとタブ

Routerは現在の表示先を管理する。
Workspaceは開いているタブを管理する。

- タブの識別子とルートの対応を定義する。
- タブ切り替えとURLの同期方向を決める。
- 同じ対象を重複して開くかを決める。
- 動的なタブと単純な画面遷移を混同しない。
- パッケージ化後のHTML読み込みで動作を確認する。
- ルートはコードベースで定義し、routeTree.gen.tsやRouterプラグインは使わない。
- 履歴はハッシュ方式とする。開発時は開発サーバーのURL（ELECTRON_RENDERER_URL）、
  ビルド後はローカルのindex.htmlをloadFileで読み込む。

## DB・保存先

保存先、接続設定、スキーマ、マイグレーションの詳細は docs/database.md を参照する。

Main側の責務分担（フェーズ2で実装）:
- db/: 接続（client.ts）、マイグレーション適用（migrate.ts）、スキーマ（schema/）
- repositories/: SQLを使う取得・保存
- services/: ID・日時の付与、DTOへの変換などの業務処理
- ipc/: 送信元検証・入力検証・結果形式への変換（handler.tsはelectronに依存しない）
- infrastructure/app-paths.ts: 保存先・同梱ファイル・許可URLの解決（electronに依存しない）

- 実DBはアプリバンドル、out、dist、ソースツリーに保存しない。
- ユーザーデータ領域を候補とし、最終パスは明示する。
- 開発・テスト・通常利用のDBを分離する。
  - 通常利用（パッケージ化済み）: Electron既定のuserData
  - 開発（未パッケージ）: 起動直後にuserDataを`<表示名>-dev`へ切り替える
  - テスト: 一時ディレクトリを使う（方式はテストツール選定時に決める）
  - 名称と保存先の命名はsrc/shared/app-identity.tsに集約する。
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
