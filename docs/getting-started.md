# 使い始める手順（フェーズ5.4時点）

アプリを通常利用（パッケージ版）で起動する前の手順。起動とDBの更新は、ユーザー自身が行う。
**受け入れ確認はユーザー判断により省略しているが、バックアップは省略しない。**

現在のマイグレーションは6件（`0000_init_tasks` 〜 `0005_add_milestones`）。
2026-11-10時点で、通常利用DBは3件（0000〜0002）まで適用済みのため、初回起動時に 0003〜0005 が適用される
（開発DBは4件まで適用済みのため、0004〜0005）。

以下のコマンドは、1行ずつそのままコピーして実行できる。

## 1. アプリを終了する

アプリを開いている場合は、メニューの「終了」（⌘Q）で終了する。次のコマンドで何も表示されなければ終了している。

```zsh
pgrep -fl "GTD.app/Contents/MacOS/GTD"
```

## 2. バックアップスクリプトを実行する

```zsh
cd ~/git/gtd
```

```zsh
zsh scripts/backup-user-db.zsh
```

- 引数なしは通常利用DB（`~/Library/Application Support/GTD/gtd.sqlite`）。開発DBは `zsh scripts/backup-user-db.zsh --dev`。
- バックアップは `~/Library/Application Support/GTD/backups/gtd-<日時>-user.sqlite`、記録は同名の `.txt`。
- アプリがDBを開いている、またはアプリのプロセスがある場合は、何もせずに停止する（終了コード2）。
  判定方法と限界はスクリプト冒頭のコメントを参照（判定の後でアプリを起動した場合は検出できない。バックアップ中はアプリを起動しない）。
- 元のDB・WAL・SHMは削除・変更しない（元DBは読み取り専用で開く。WALがある場合、SQLiteがSHM（WALの索引）を更新することはある）。

## 3. バックアップの成功を確認する

直後に次を実行し、`0` が表示されることを確認する。

```zsh
echo $?
```

画面の最後に「成功: バックアップを作成し、整合性を確認しました。」、記録に `integrity_check: ok` があること。
記録の「適用済みマイグレーション数」と各テーブルの件数（例: `tasks: 12 件`）を控えておく
（現在の通常利用DBは0002までのため、`projects`・`milestones` は「（テーブルなし）」と表示される。これは失敗ではない）。

`integrity_check` が ok でない場合は終了コード1になる。そのバックアップは使わず、起動もせずに原因を確認する。

## 4. 型チェック・テスト・パッケージ生成

```zsh
cd ~/git/gtd
```

```zsh
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
```

```zsh
npm run typecheck && npm test && npm run package:dir
```

生成物は `dist/mac/GTD.app`（x64・署名なし）。

## 5. アプリを起動する（ユーザー自身が行う）

```zsh
open ~/git/gtd/dist/mac/GTD.app
```

- 署名していないため、macOS の確認が出る場合がある（Finder で `GTD.app` を右クリック →「開く」）。
- 起動時に未適用のマイグレーションが自動で適用される。失敗した場合はDBを変更せずにダイアログを出して終了する。

## 6. マイグレーション後の確認（初回起動直後、追加・編集をする前）

初回起動後、タスクなどを追加・編集する前に一度終了（⌘Q）し、バックアップスクリプトをもう一度実行する（読み取り専用の確認を兼ねる）。

```zsh
cd ~/git/gtd && zsh scripts/backup-user-db.zsh
```

- 「適用済みマイグレーション数: 6」、`integrity_check: ok`、`milestones: 0 件`。
- `tasks`・`projects` の件数が、手順3で控えた件数と同じこと（手順3で「（テーブルなし）」だった `projects` は 0 件）。
  この比較は初回起動直後・追加や編集の前に限る。起動後にタスクを追加すれば件数は増える。
- 画面では、Inbox に既存のタスク（プロジェクトに属さないもの）が表示されること。

## 戻す場合（バックアップから復元）

アプリを終了した状態で行う。現在のDBは削除せず、退避してから、手順2のバックアップを元の場所へコピーする。

```zsh
cd "$HOME/Library/Application Support/GTD" && mkdir -p backups/replaced-$(date +%Y%m%d-%H%M%S)
```

上で作った `backups/replaced-<日時>` へ、`gtd.sqlite` と（あれば）`gtd.sqlite-wal`・`gtd.sqlite-shm` を Finder か `mv` で移し、
`cp "backups/<手順2のバックアップ>.sqlite" gtd.sqlite` で戻す。古いDBを新しいアプリで開くと、再びマイグレーションが適用される。
