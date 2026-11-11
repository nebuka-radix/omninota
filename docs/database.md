# データベース

## 保存先

| 用途 | 判定 | 保存先 |
|---|---|---|
| 通常利用（パッケージ版） | `app.isPackaged === true` | `~/Library/Application Support/GTD/gtd.sqlite` |
| 開発・preview | `app.isPackaged === false` | `~/Library/Application Support/GTD-dev/gtd.sqlite` |
| 自動テスト | vitest（Electronを起動しない） | `os.tmpdir()` 配下の `gtd-test-*`（テスト後に削除） |
| 検証用（手動・スクリプト） | 未パッケージ時に環境変数 `GTD_DEV_USER_DATA_DIR`（絶対パス）を指定 | 指定したディレクトリ。パッケージ版では無視する |

- 名称は `src/shared/app-identity.ts`、パスの解決は `src/main/infrastructure/app-paths.ts` に集約する。
- 開発DBを通常利用DBへ自動コピーしない。
- ソース、out、dist、アプリバンドル内に実DBを置かない。
- `*.sqlite`、`*.sqlite-wal`、`*.sqlite-shm`、`backups/`、`logs/` は `.gitignore` で除外している。

### 検証用の保存先（GTD_DEV_USER_DATA_DIR）

大量データや終了フローの確認で、開発用・通常利用のDBを使わないための仕組み（フェーズ4）。

- 有効になる条件: 未パッケージ（`npm run dev` / `npm run preview`）で、値が**絶対パス**の場合だけ。
  パッケージ版、相対パス、未指定では無視し、通常の保存先を使う（`src/main/infrastructure/app-paths.ts`）。
- 指定したディレクトリがuserDataになり、DBはその中の `gtd.sqlite`。起動時にマイグレーションが適用される。
- 使い方:

```zsh
DIR=$(mktemp -d /tmp/gtd-verify-XXXXXX)
GTD_DEV_USER_DATA_DIR=$DIR npm run dev
# 終了後、必要なら sqlite3 "$DIR/gtd.sqlite" で中身を確認する。不要になったら自分でディレクトリを削除する
```

## 接続設定

`src/main/db/client.ts`

| PRAGMA | 値 | 理由 |
|---|---|---|
| journal_mode | WAL | 書き込み中も読み取りを妨げず、異常終了時も整合性を保ちやすい |
| synchronous | FULL | 電源断・OS異常時に確定済みデータを失わないことを速度より優先する |
| foreign_keys | ON | 後続フェーズの外部キーを有効にする（SQLiteの既定はOFF） |
| busy_timeout | 5000 | 将来のバックアップ処理などと競合した際に即時失敗させない |

WAL使用中は、稼働中のDBファイルを単純コピーしてもバックアップにならない。
バックアップはbetter-sqlite3の `db.backup()`（SQLiteのオンラインバックアップAPI）を使う予定。

## ライフサイクル

1. `app.whenReady()` 後に接続し、マイグレーションを適用する。
2. 成功した場合だけIPC（タスクAPI）を登録し、ウィンドウを開く。
3. 失敗した場合はエラーダイアログを出して終了する。DBファイルの削除・初期化・空DBへの差し替えはしない。
4. `will-quit` で接続を閉じる（WALはこのときにDB本体へ反映される）。

## スキーマ

### tasks（フェーズ2・0000_init_tasks）

`src/main/db/schema/tasks.ts`

| 列 | 型 | 内容 |
|---|---|---|
| id | TEXT PRIMARY KEY | `crypto.randomUUID()` によるUUID v4 |
| title | TEXT NOT NULL | 前後空白を除去したタイトル（最大200文字） |
| created_at | TEXT NOT NULL | UTCのISO 8601文字列（例: `2026-11-09T10:00:00.000Z`） |
| updated_at | TEXT NOT NULL | 同上。作成時は created_at と同じ値 |
| completed_at | TEXT（NULL可） | 完了日時（UTCのISO 8601）。未完了ならNULL（フェーズ4・0002_add_task_completed_at） |
| project_id | TEXT（NULL可）REFERENCES projects(id) | 所属するプロジェクト。NULLは未所属（Inbox）。0件または1件（フェーズ5.2・0004_add_task_project_id） |
| milestone_id | TEXT（NULL可）REFERENCES milestones(id) | 所属するマイルストン（フェーズ5.4・0005_add_milestones） |
| hidden_at | TEXT（NULL可） | 削除由来で画面に表示しなくなった日時（UTCのISO 8601）。NULLなら表示対象（フェーズ5.6・0006_task_deletion_and_hidden） |

- 索引: `tasks_created_at_id_idx (created_at, id)`、`tasks_project_id_idx (project_id)`（フェーズ5.2）
- 外部キー: `project_id → projects.id`、`milestone_id → milestones.id`。ON DELETE は指定しない（既定の NO ACTION）。
  接続時に `foreign_keys = ON` を設定しているため、存在しないプロジェクトID・マイルストンIDは保存できない。
  削除（フェーズ5.6）は、Serviceが先に参照を外してから親を削除する（外部キーの連鎖で残すべき行を消さない）。
- 一覧の並び順: `created_at DESC, id DESC`（同じ作成日時でも常に同じ順序）
- 日時は固定長・UTC固定のため、文字列の大小比較が時刻順と一致する。
- 完了状態は completed_at だけから導出する（isCompleted のような列は持たない）。
- 日時はすべてMain側で生成する。Rendererから任意の日時は指定できない。

| 操作 | completed_at | updated_at | created_at |
|---|---|---|---|
| 作成 | NULL | 作成日時 | 作成日時 |
| タイトル編集（前後空白を除いて保存済みと異なる場合のみ） | 変えない | 更新 | 変えない |
| 完了にする（未完了の場合のみ） | 現在日時 | 同じ現在日時 | 変えない |
| 未完了に戻す（完了の場合のみ） | NULL | 現在日時 | 変えない |
| 既に目的の状態・同じタイトル | 変えない | 変えない | 変えない |
| 所属の変更・解除（保存済みと異なる場合のみ。フェーズ5.2） | 変えない | 現在日時 | 変えない |
| 同じ所属への再要求 | 変えない | 変えない | 変えない |
| マイルストンの削除による所属解除・非表示化（フェーズ5.6） | 変えない | 操作日時（hidden_at と同じ） | 変えない |
| プロジェクトの削除による所属解除・非表示化（フェーズ5.6） | 変えない | 操作日時 | 変えない |

- 所属が変わる操作は updated_at を更新する（setAssignment と同じ規則）。削除による所属解除も同じ扱いにした。
  hidden_at は表示中のタスクだけに設定し、既に非表示のタスク（プロジェクトの削除で再び所属を外す場合）は最初の日時を保つ。

- 既存タスク（フェーズ3以前）は、マイグレーション後に未完了（NULL）として扱う。
- 既存タスク（フェーズ5.1以前）は、0004の適用後に未所属（project_id = NULL）として扱う。
- 所属の変更でID・タイトル・作成日時・完了日時は変えない。
- タスクの作成・所属の変更では、移動先プロジェクトの存在・未完了の確認と更新を1つのトランザクション（BEGIN IMMEDIATE）で行う
  （`src/main/db/transaction.ts`）。完了済みプロジェクトへの追加・移動は拒否し、完了済みからの移動（未所属・別の未完了へ）は許可する。
- タグ、期限などは後続フェーズでマイグレーションにより追加する。

### app_settings（フェーズ3・0001_add_app_settings）

`src/main/db/schema/app-settings.ts`

| 列 | 型 | 内容 |
|---|---|---|
| key | TEXT PRIMARY KEY | 設定の分類。現在は `workspace` だけ（Main側の定数で固定） |
| value | TEXT NOT NULL | バージョン付きJSON文字列 |
| updated_at | TEXT NOT NULL | UTCのISO 8601文字列 |

保存形式の選択:
- 分類ごとに1行・JSON値とした。UI状態は項目の追加が多いため、列方式だと項目追加のたびに
  マイグレーションが必要になる。JSONにはバージョンを持たせ、読み取り時にZodで検証する。
- 汎用のキー・値APIは公開しない。IPCはWorkspace設定専用の型付きAPIだけとする。

`workspace` の値（version 1）:

```json
{ "version": 1, "sidebarWidth": 240, "detailWidth": 300, "detailVisible": true, "lastRoute": "/inbox", "milestoneCardWidth": 320 }
```

| 項目 | 範囲・値 | 既定値 |
|---|---|---|
| sidebarWidth | 180〜480（整数px） | 240 |
| detailWidth | 220〜560（整数px） | 300 |
| detailVisible | true / false | true |
| lastRoute | `/inbox` / `/settings` / `/projects` / `/projects/<小文字のUUID>`（5.1で追加） | `/inbox` |
| milestoneCardWidth | 240〜640（整数px）。マイルストンカードの共通の幅（5.5で追加） | 320 |

フェーズ5.5の `milestoneCardWidth` は、既存の `app_settings`（key = `workspace`）のJSONに項目を加えただけで、
テーブル・列は変えていない（**マイグレーションは追加していない**。マイグレーションは6件のまま）。
追加前の保存値にはこの項目がないため、読み取り時に既定値で補う（形式の互換を保つため version は 1 のまま。
項目がないことを「補正」とは扱わず、他の項目を既定値に戻さない）。値の書き込みは、ユーザーがカードの幅を変えた時だけ行う。

範囲は `src/shared/contracts/workspace.ts` の `WORKSPACE_LIMITS` に集約している。

読み取り時の扱い（`normalizeWorkspaceSettings`）:
- 行なし、JSONとして読めない、バージョン違い → 既定値
- 幅が範囲外 → 範囲内に丸める
- 型が違う項目、未知の画面 → その項目だけ既定値
  （`/projects/<不正なID>`、下位パス、外部URLなども未知の画面として `/inbox` にする）
- フェーズ3〜4で保存した値（`/inbox`・`/settings`）はそのまま読める。保存形式のバージョンは1のまま
- 読み取り時にDBは書き換えない（次にユーザーが操作した時の保存で置き換わる）

保存時の扱い（`workspace.save`）:
- 範囲外・小数・余分なキー・未知の画面は INVALID_INPUT で拒否する（丸めない）。
- 全体を置き換えて保存する（部分更新はしない）。

#### 幅をpxで保存する理由

- react-resizable-panels v4 は、パネルのサイズをpxで指定でき、
  `groupResizeBehavior="preserve-pixel-size"` でウィンドウサイズが変わってもpx幅を保てる。
- サイドバー・詳細パネルはVS Codeと同様に、ウィンドウ幅によらず同じ幅で表示したい。
  比率で保存すると、ウィンドウサイズが違う次回起動時に幅が変わってしまう。
- 保存するのはユーザーが境界線を直接操作して決めた「希望幅」で、画面上の実寸ではない（フェーズ3.1）。
  希望幅がウィンドウに収まらない場合は、メインパネルの最小幅（320px）を優先して実寸だけを縮める。
  他方のペインの操作、ウィンドウサイズ変更、詳細パネルの開閉、起動時の復元では希望幅を書き換えないので、
  幅に余裕ができると希望幅へ戻る。
- 例: 詳細パネルの希望幅320pxのままサイドバーを広げると、詳細パネルの実寸は240pxに縮むが、
  保存値は320pxのまま。サイドバーを狭めると320pxで表示される。
- 境界線のダブルクリックは対象ペインを既定幅（サイドバー240px・詳細300px）に戻し、その希望幅だけを保存する。
- 保存のタイミング: 境界線の操作の確定時（ポインターを離した時・キー操作時・ダブルクリック時）、
  詳細パネルの開閉時、画面遷移時。通常の終了・ウィンドウを閉じる前には、確定済みの最新値の保存完了を待つ
  （docs/architecture.md「終了・ウィンドウを閉じる時の保存」）。

### projects（フェーズ5.1・0003_add_projects）

`src/main/db/schema/projects.ts`

| 列 | 型 | 内容 |
|---|---|---|
| id | TEXT PRIMARY KEY | `crypto.randomUUID()` によるUUID v4 |
| name | TEXT NOT NULL | 前後空白を除去した名前（最大200文字、`PROJECT_NAME_MAX_LENGTH`）。同名を許可（一意制約なし） |
| created_at / updated_at | TEXT NOT NULL | UTCのISO 8601文字列 |
| completed_at | TEXT（NULL可） | 完了日時。未完了ならNULL（完了・取り消しはフェーズ5.3の projects.setCompleted） |

- 名前変更は、前後空白を除いた名前が保存済みと同じなら更新しない（updated_atも変えない）。存在しないIDは NOT_FOUND。
- DBからの取得順は作成日時・IDの昇順。画面の表示順（未完了 → 完了、名前順）はRendererで決める。
- 完了・取り消し（フェーズ5.3。マイグレーションなし。既存の completed_at を使う）:

| 操作 | completed_at | updated_at | created_at |
|---|---|---|---|
| 完了（所属タスクがすべて完了済み、または0件の場合のみ） | 現在日時 | 同じ現在日時 | 変えない |
| 完了の取り消し | NULL | 現在日時 | 変えない |
| 既に目的の状態 | 変えない | 変えない | 変えない |

- 未完了タスクの件数は `tasks` を `project_id = ? AND completed_at IS NULL` で数える（索引 `tasks_project_id_idx`）。
  確認と更新は1つのトランザクション（BEGIN IMMEDIATE）。所属タスクの行は変更しない。
- 完了済みプロジェクトに所属するタスクは未完了に戻せない（tasks.setCompleted で確認。同じトランザクション）。
- フェーズ5.3ではマイグレーションを追加していない（DBのバージョンは0004のまま）。
- タスクとの関連は `tasks.project_id`（フェーズ5.2で追加。上記 tasks を参照）。
- 0003は新しいテーブルの追加だけで、既存の tasks・app_settings は変更しない。
  フェーズ4のスキーマ（0000〜0002）からの移行で、タスク（完了状態を含む）とWorkspace設定が保持されること、
  再実行で何も適用されないことを結合テストで確認した（`tests/main/migration-upgrade.test.ts`）。
- 2026-11-10時点の状態（ファイルのコピーを読み取って確認）:
  - 通常利用DB（GTD）: 0003は未適用（マイグレーション3件）。パッケージ版の次回起動時に適用される。適用前に下記の手順でバックアップを取る。
  - 開発DB（GTD-dev）: 0003は適用済み（マイグレーション4件、projects 0件、integrity_check ok）。
    適用されたのはフェーズ5.1の再開前（ファイルの更新は2026-11-09）で、どの起動で適用されたかは記録がない。
    0003適用前の専用バックアップはない（0002適用前の `before-phase4` が直近）。
  - フェーズ5.1再開後の検証は一時DBだけで行い、上記2つのDBは変更していない。

## マイグレーション

| 処理 | 方法 | 実行タイミング |
|---|---|---|
| 生成 | `npm run db:generate -- --name <名前>`（drizzle-kit） | 開発時のみ |
| 適用 | `drizzle-orm/better-sqlite3/migrator` の `migrate()` | アプリ起動時 |

- スキーマ定義を変更したら `db:generate` でSQLを生成し、`migrations/` をGitで管理する。
- 配布アプリはdrizzle-kitを実行しない。生成済みのSQLとメタデータだけを同梱する。
- 適用履歴は `__drizzle_migrations` テーブルに記録される。
  記録済みの最新 `created_at` より新しいものだけを、1つのトランザクションで適用する。
  失敗時はROLLBACKされる。
- drizzle-ormが作る `__drizzle_migrations.id` は `SERIAL` 型のため、SQLiteでは値がNULLになる。
  判定には `created_at` と `hash` が使われるので動作上の問題はない。

| 環境 | migrations の参照先 |
|---|---|
| 開発・preview | `<プロジェクト>/migrations`（`app.getAppPath()` 基準） |
| パッケージ版 | `GTD.app/Contents/Resources/migrations`（electron-builderの `extraResources`） |

### 0004_add_task_project_id（フェーズ5.2）

- 生成SQL: `ALTER TABLE tasks ADD project_id text REFERENCES projects(id)` と `CREATE INDEX tasks_project_id_idx`。
  テーブルの再作成はしない（既存の行はそのまま残り、新しい列はNULL）。過去のマイグレーション（0000〜0003）は変更していない。
- スキーマ定義（`src/main/db/schema/tasks.ts`）を変更して `npm run db:generate -- --name add_task_project_id` で生成した
  （SQLとスナップショット `meta/0004_snapshot.json` は一致している。SQLだけを手で書き換えていない）。
- 確認: 結合テスト（`tests/main/migration-upgrade.test.ts`）とUIテスト（`npm run test:ui` の「移行」シナリオ）で、
  一時DBに0000〜0003を適用してタスク・プロジェクト・Workspace設定を登録した後に現在のマイグレーションを適用し、
  データの保持・既存タスクの未所属・外部キーと索引・再実行で何も適用されないことを確認した。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に0004が適用される。**
  適用前に、アプリを終了した状態で下記「手動バックアップ」の手順で整合性のあるバックアップを取ること。
  フェーズ5.2の作業では、通常利用DB・開発DBへの適用・起動はしていない（2026-11-10時点: 通常利用DBは0002まで、開発DBは0003まで）。

将来のスキーマ更新前バックアップは、`src/main/db/migrate.ts` の `runMigrations()` 先頭
（未適用のマイグレーションがある場合）に追加する。

### 0006_task_deletion_and_hidden（フェーズ5.6）

**この移行は既存タスクを物理削除する。通常利用DB・開発DBで初めてフェーズ5.6のアプリを起動する前に、アプリを終了した状態で
下記「手動バックアップ」の手順（`zsh scripts/backup-user-db.zsh` / `--dev`）で必ずバックアップを取ること。**

1. 一度限りの物理削除: 移行時点の `project_id IS NOT NULL AND milestone_id IS NULL` のタスク
   （プロジェクトだけに所属し、マイルストンが未設定のタスク）を、完了・未完了を問わず削除する。
   - 削除しない: Inbox（project_id・milestone_id ともにNULL）、マイルストンに所属するタスク。
   - このマイグレーションは1回だけ適用される（`__drizzle_migrations` に記録）。起動のたびにNULL所属のタスクを削除する処理はない。
     移行後にマイルストン・プロジェクトの削除で非表示になったタスクは、再起動しても削除されない。
2. `tasks.hidden_at`（TEXT、NULL可）を追加する。既存タスクはすべてNULL（表示対象）。
3. `milestones.project_id` をNULL可にする（SQLiteでは表の作り直しが必要）。
   - マイグレーションは1つのトランザクションで実行され、その中では `PRAGMA foreign_keys` を切り替えられない
     （drizzle-kit が生成する `PRAGMA foreign_keys=OFF` は効かず、`DROP TABLE milestones` が外部キー違反で失敗する）。
   - そのため生成SQLを手で書き換え、外部キーを有効にしたまま作り直す: `tasks.milestone_id` を一時表に退避してNULLにし、
     milestones を作り直し（索引 `milestones_project_id_idx` も作り直す）、退避した値を戻して一時表を削除する。
     tasks の updated_at などは変えない（結合テストで全列の保持を確認）。
   - スキーマ定義から `npm run db:generate -- --name task_deletion_and_hidden` で生成し、スナップショット（`meta/0006_snapshot.json`）は
     生成結果のまま。SQLの手順だけを置き換えた（得られるスキーマは生成結果と同じ）。過去のマイグレーション（0000〜0005）は変更していない。
- 確認: `tests/main/deletion.test.ts`（0005 → 0006: 対象だけの削除・完了済みも対象・Inbox／所属済みの全列保持・外部キーと索引・
  foreign_key_check・一時表が残らない・再起動で非表示のタスクを削除しない）、UIテスト「移行（5.5 → 5.6）」。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に0006を含む未適用のマイグレーションが適用される。**
  フェーズ5.6の作業では、両DBを起動・更新していない。

#### 表示データと、削除由来で保持する非表示データ

| 状態 | project_id | milestone_id | hidden_at | 画面 |
|---|---|---|---|---|
| Inbox | NULL | NULL | NULL | Inbox に表示 |
| プロジェクトのタスク | あり | あり（そのプロジェクトのマイルストン） | NULL | プロジェクトのカードに表示 |
| マイルストンの削除で非表示 | あり（維持） | NULL | 削除日時 | 表示しない |
| プロジェクトの削除で非表示 | NULL | NULL | 削除日時（既にあれば維持） | 表示しない（Inbox にも出さない） |
| マイルストン（表示中） | あり（milestones.project_id） | — | — | カード・選択肢に表示 |
| プロジェクトの削除で非表示のマイルストン | NULL | — | — | 表示しない（名前変更・削除・紐付けの対象外） |

- IDのNULLだけでは通常のInboxタスクとプロジェクト削除後のタスクを区別できないため、tasks は hidden_at で区別する。
  マイルストンは project_id = NULL を非表示とする（通常の操作では NULL にならない）。
- 「マイルストンだけの所属」（milestone_id あり・project_id NULL）はどの状態にも現れない。
- 一覧（tasks.list・milestones.list）・件数（プロジェクトの完了判定の未完了件数）・更新（タイトル・完了状態・所属）は、
  表示中の行だけを対象にする。更新系のSQLは `hidden_at IS NULL`（マイルストンは `project_id IS NOT NULL`）を条件に含め、
  遅れて届いた更新でも非表示の行を再表示・再利用しない（NOT_FOUND）。
- 削除の処理で対象を数える・所属を外す内部のクエリ（`countByProject`・`detachAndHideByProject`）は、既に非表示の所属タスクも含める。
- 非表示データを画面から復元する操作は初期版にはない。

| 規則（フェーズ5.6） | 保証する場所 |
|---|---|
| 所属は Inbox（両方NULL）か、プロジェクトとそのマイルストンの両方（プロジェクトだけは不可） | 入力検証（Zod）＋ Service |
| マイルストンが0件のプロジェクトにはタスクを追加・紐付けできない | Service（マイルストンの指定が必須のため） |
| プロジェクトの作成と初期マイルストン「新しいマイルストン」の作成は両方成功するか両方失敗する | Service（1つのトランザクション） |
| 削除時の所属解除・非表示化・削除は全部成功するか何も変えない | Service（1つのトランザクション・BEGIN IMMEDIATE） |
| 確認後に配下の件数が変わったら削除しない | Service（確認時の件数と比べて CONFLICT） |

### 0009_task_favorite（共通のタスク行。2026-11-11）

- 生成SQL（`db:generate --name task_favorite` の結果に説明を追記）: `ALTER TABLE tasks ADD favorite integer DEFAULT false NOT NULL`。過去のマイグレーションは変更していない。
- `favorite`: お気に入り。論理型（Drizzle の `integer({ mode: 'boolean' })`。SQLite には真偽値の型がないため INTEGER の 0 / 1）。
  NOT NULL・既定値 false。既存の行はすべて false（0）になる。入力は Zod で真偽値だけを受け付ける。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に未適用の 0007〜0009 が適用される。** 起動前にバックアップを取ること。

### 0008_task_dueto（フェーズ6）

- 生成SQL（`db:generate --name task_dueto` の結果に説明を追記）: `ALTER TABLE tasks ADD dueto text`、索引 `tasks_dueto_idx`。過去のマイグレーションは変更していない。
- `dueto`: 期限。日付のみの "YYYY-MM-DD"（TEXT。時刻・タイムゾーンなし。UTC日時へ変換しない）。NULL は未設定。既存の行はすべて NULL。
  SQLite は型を検証しないため、Main の入力検証（Zod + `isValidDateOnly`）で実在する暦日だけを受け付ける（2月30日などは INVALID_INPUT）。
  固定長のため文字列の比較が日付の前後と一致する（Summary の範囲の取得に使う）。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に 0007・0008（開発DBは状況による）が適用される。** 起動前にバックアップを取ること。

### 0007_task_and_milestone_order（フェーズ5.9）

- 生成SQL（`db:generate --name task_and_milestone_order` の結果に説明のコメントを追記）:
  `ALTER TABLE milestones ADD position integer`、`ALTER TABLE tasks ADD position integer`。テーブルの再作成はしない。
  過去のマイグレーション（0000〜0006）は変更していない。
- 既存の行はすべて NULL（手動順なし）。表示は従来どおり作成日時の古い順・IDの昇順で、初期順はこの2つから構成する。
  既存の行のほかの列（日時・所属・非表示状態）は変えない（結合テストで 0006 → 0007 の移行を確認）。

| 列 | 型 | 内容 |
|---|---|---|
| tasks.position | INTEGER NULL | マイルストン内の手動順（小さいほど上）。NULL は手動順なし |
| milestones.position | INTEGER NULL | プロジェクト内のカードの手動順（小さいほど先）。NULL は手動順なし |

| 規則（フェーズ5.9） | 保証する場所 |
|---|---|
| 同じマイルストンの表示中のタスク（同じプロジェクトの表示中のマイルストン）は、全件に順位があるか全件 NULL | Service（並べ替えは全件を指定した時だけ保存。追加・移動は末尾） |
| 手動順のあるマイルストンへの追加・移動は末尾（最大値+1）。Inboxへ戻すと NULL | Service（create・setAssignment・assignFromInbox） |
| 並べ替えは順位だけを変える（created_at・completed_at・updated_at は変えない） | Repository（position だけを更新） |
| 一括紐付け・一括削除・並べ替えは全件成功か何も変えない | Service（1つのトランザクション） |
| 削除由来の非表示タスク・非表示のマイルストンは、並べ替え・一括操作の対象にしない | Repository（hidden_at・project_id の条件）＋ Service |

- 一覧の順序: `milestones.list` は position（NULL は後ろ）→ created_at → id。タスクの手動順は Renderer の Table が同じ規則で並べる。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に 0007 が適用される。** 起動前にバックアップを取ること。
  今回の作業では両DBを起動・更新していない。

### 0005_add_milestones（フェーズ5.4）

- 生成SQL: `CREATE TABLE milestones (...)`（project_id は projects.id への外部キー、NOT NULL）、索引 `milestones_project_id_idx`、
  `ALTER TABLE tasks ADD milestone_id text REFERENCES milestones(id)`、索引 `tasks_milestone_id_idx`。
  テーブルの再作成はしない。過去のマイグレーション（0000〜0004）は変更していない。スキーマ定義から `db:generate` で生成した。
- 既存タスクは project_id・タイトル・状態・日時をそのまま保持し、milestone_id は NULL になる（結合テスト・UIテストで確認）。

| 列（milestones） | 型 | 内容 |
|---|---|---|
| id | TEXT PRIMARY KEY | UUID v4（Main側で生成） |
| project_id | TEXT NOT NULL REFERENCES projects(id) | 所属プロジェクト（付け替えは未対応）。フェーズ5.6（0006）でNULL可に変更（NULL = プロジェクトの削除で非表示） |
| name | TEXT NOT NULL | 前後空白を除去した名前（最大200文字、`MILESTONE_NAME_MAX_LENGTH`）。同名可 |
| created_at / updated_at | TEXT NOT NULL | UTCのISO 8601。表示順は created_at・id の昇順 |

DBで保証する範囲とServiceで保証する範囲:

| 規則 | 保証する場所 |
|---|---|
| tasks.project_id は存在するプロジェクト | DB（外部キー）＋ Service（NOT_FOUND を返すため事前に確認） |
| tasks.milestone_id は存在するマイルストン | DB（外部キー）＋ Service |
| milestones.project_id は存在するプロジェクト | DB（外部キー・NOT NULL）＋ Service |
| milestone_id があれば project_id もある（マイルストンだけの所属を禁止） | 入力検証（Zod）＋ Service（DBのCHECK制約はない）。5.6からは project_id があれば milestone_id も必要（上記 0006） |
| milestone_id のマイルストンは、同じタスクの project_id のプロジェクトに属する | Service（トランザクション内で確認。DBの複合外部キーはない） |
| 完了済みプロジェクトへの追加・移動・マイルストン登録の拒否 | Service（トランザクション内で確認） |

- CHECK制約・複合外部キーを既存の tasks テーブルに後から加えるには、SQLiteではテーブルの再作成が必要になるため、今回は行わなかった。
  タスクの所属を書き換える経路は TaskService（create / setAssignment）だけで、どちらも確認と更新を1つのトランザクションで行う。
- **既存のDB（通常利用 GTD・開発 GTD-dev）は、次にアプリを通常起動した時に未適用のマイグレーション（0003〜0005 / 0004〜0005）が適用される。**
  起動前に、アプリを終了した状態で下記の手順でバックアップを取ること（docs/getting-started.md）。今回の作業では両DBを起動・更新していない。

### 手動バックアップ（バックアップ機能の実装前）

通常は `zsh scripts/backup-user-db.zsh`（通常利用DB）/ `--dev`（開発DB）を使う（docs/getting-started.md）。
SQLiteの `.backup` で書き出し、integrity_check・適用済みマイグレーション数・テーブルの件数を記録する。
元DBは読み取り専用で開き（-wal がない場合は immutable の読み取り専用URI）、元DB・WAL・SHMは削除しない。以下は手作業で行う場合の手順。

アプリを終了した状態で、SQLiteのオンラインバックアップAPI（sqlite3 CLIの `.backup`）を使う。
稼働中のWAL使用DBのファイルを単純コピーしたものはバックアップとして扱わない。

```zsh
SRC="$HOME/Library/Application Support/GTD/gtd.sqlite"
DEST="$HOME/Library/Application Support/GTD/backups/gtd-$(date +%Y%m%d-%H%M%S).sqlite"
mkdir -p "$(dirname "$DEST")"
sqlite3 "$SRC" ".backup '$DEST'"
sqlite3 "file:${DEST// /%20}?mode=ro&immutable=1" "pragma integrity_check;"
```

macOS標準の sqlite3 は終了後も `gtd.sqlite-wal`（0バイト）と `gtd.sqlite-shm` を残すことがある。
中身は空で、アプリの動作に影響しない。

フェーズ3の検証前に作成したバックアップ:
- `~/Library/Application Support/GTD/backups/gtd-20261109-192218-before-phase3.sqlite`（タスク1件・マイグレーション1件）
- `~/Library/Application Support/GTD-dev/backups/gtd-20261109-192218-before-phase3.sqlite`（タスク4件・マイグレーション1件）

フェーズ4の検証前に作成したバックアップ（0002適用前）:
- `~/Library/Application Support/GTD/backups/gtd-20261109-200420-before-phase4.sqlite`（タスク1件・マイグレーション2件）
- `~/Library/Application Support/GTD-dev/backups/gtd-20261109-200420-before-phase4.sqlite`（タスク5件・マイグレーション2件）

## better-sqlite3 のバイナリ

- v13 から Node-API 対応になり、ビルド済みバイナリ（`prebuilds/<platform>-<arch>.node`）を
  パッケージ自体に同梱している。`"gypfile": false` で、インストール時のネイティブビルドは行わない。
- 同じ `darwin-x64.node` を、ホストNode.js 24（ABI 137）、Node.js 25（ABI 141）、
  Electron 44（ABI 149）で読み込めることを確認した。
  バイナリはV8・Node・libuvのシンボルを参照せず、`napi_*` だけを使う。
- このため Electron 向けの再ビルド（@electron/rebuild）は導入せず、
  electron-builder は `npmRebuild: false` とした。ホストNode.jsとElectronを切り替えても再ビルドは不要。
- パッケージ版では `app.asar.unpacked/node_modules/better-sqlite3/` に展開され、
  `prebuilds/darwin-x64.node` が読み込まれることをプロセスの読み込みファイルで確認した。
- 配布物にはdarwinのx64・arm64バイナリだけを含め、linux・win32版とソースは除外している。
