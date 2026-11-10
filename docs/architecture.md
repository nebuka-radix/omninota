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
- macOSではウィンドウを閉じてもアプリは終了しない（既存方針）。閉じる前にも同じ確認を行う。
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
- 左サイドバー: 作成欄とプロジェクト一覧（`features/projects/ProjectsSidebar.tsx`）。一覧の順序は `project-order.ts`。
- メイン: 見出しでの名前編集（`ProjectNameEditor.tsx`）と、そのプロジェクトのタスク一覧・追加欄（5.2。下記「タスク一覧の表示範囲」）。
- 表示の区別: 取得中 / 取得失敗（IPC・DBエラー）/ 存在しないID / 形式が不正なID。取得失敗を「見つかりません」と表示しない。
  判定は `features/projects/project-route.ts` の `getProjectPageState`（DOMに依存しない純粋関数。単体テストあり）。
- Query: `['projects', 'list']`（全件）だけ。詳細用のQueryは作らない。作成後は一覧を取り直し、名前変更は返却DTOで該当行を置き換える。
- 起動時の復元: 保存済みのルートが `/projects/<UUID>` の場合、プロジェクト一覧を取得して存在を確かめる。
  存在しなければ `/projects` へ移動する。取得に失敗した場合は判定せず、そのルートを開いて取得失敗として表示する
  （`resolveStartupTarget`）。明示的なルート（`#/settings` など）で開いた場合は保存値より優先する。
- 完了・取り消し（5.3）: 見出しの下の `ProjectCompletionControl.tsx`。下記「プロジェクトの完了（フェーズ5.3）」。
- 作成欄の未送信の入力は、タスクの追加欄と同じく未保存確認の対象にしない（制約）。

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
- Sidebar: `groupProjects` で「未完了」「完了済み」の区分（見出しと件数）に分けて表示する。区分内の順序は従来の名前順・タイブレーカー。
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
ActivityBar（固定48px）| Sidebar | MainPanel | DetailPanel   ← react-resizable-panels の Group
StatusBar（固定）
```

- Sidebar・DetailPanelは `groupResizeBehavior="preserve-pixel-size"`、MainPanelが残りの幅を使う。
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
  未完了／完了／すべて（completedAtから導出する非表示列への列フィルター）。初期表示は未完了。
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
