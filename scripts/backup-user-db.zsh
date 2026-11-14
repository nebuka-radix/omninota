#!/bin/zsh
# GTD のDBのバックアップ（SQLiteのオンラインバックアップ機能 .backup を使う。WAL使用DBの単純コピーはしない）。
#
# 使い方:
#   zsh scripts/backup-user-db.zsh          # 通常利用DB（~/Library/Application Support/GTD/gtd.sqlite）
#   zsh scripts/backup-user-db.zsh --user   # 同上（明示）
#   zsh scripts/backup-user-db.zsh --dev    # 開発DB（~/Library/Application Support/GTD-dev/gtd.sqlite）
#   zsh scripts/backup-user-db.zsh --userdata-dir <ディレクトリ>   # 検証用: 指定した userData の gtd.sqlite
#
# 出力: <userData>/backups/gtd-<日時>-<種別>.sqlite と、同名の .txt（記録）
# 終了コード: 0 = 成功（integrity_check が ok）/ 1 = 失敗 / 2 = 使い方・前提の誤り（DBがない、アプリが起動中など）
#
# アプリが起動中かどうかの判定と限界:
#   - DBファイル（gtd.sqlite / -wal / -shm）を開いているプロセスを lsof で調べ、1つでもあれば停止する。
#   - 加えて、通常利用は GTD.app のプロセス、開発は このリポジトリの Electron（npm run dev / preview）のプロセスを pgrep で調べる。
#   - 限界: 判定した後にアプリが起動されると検出できない（ただし .backup はSQLiteのロックを使うため、
#     その場合もバックアップ自体は一貫した状態になる）。他のユーザーのプロセスは権限によって見えないことがある。
#     開発DBの判定では、検証用の一時DBで動かしている同じリポジトリの Electron も「起動中」とみなす（安全側）。
#
# このスクリプトは元のDB・WAL・SHMを削除・変更しない（元DBは読み取り専用で開く）。既存のバックアップを上書き・削除しない。

set -euo pipefail

fail() { print -u2 -- "エラー: $1"; exit "${2:-1}"; }

target="user"
userdata_dir=""
while (( $# > 0 )); do
  case "$1" in
    --user) target="user" ;;
    --dev) target="dev" ;;
    --userdata-dir)
      (( $# >= 2 )) || fail "--userdata-dir にはディレクトリを指定してください" 2
      target="custom"
      userdata_dir="$2"
      shift
      ;;
    -h|--help)
      print -- "使い方: zsh scripts/backup-user-db.zsh [--user | --dev | --userdata-dir <ディレクトリ>]"
      exit 0
      ;;
    *) fail "不明な引数です: $1" 2 ;;
  esac
  shift
done

app_support="$HOME/Library/Application Support"
case "$target" in
  user) userdata_dir="$app_support/GTD" ;;
  dev) userdata_dir="$app_support/GTD-dev" ;;
esac

command -v sqlite3 >/dev/null || fail "sqlite3 が見つかりません" 2

db="$userdata_dir/gtd.sqlite"
# DBがなければ停止する（sqlite3 に存在しないパスを渡すと空のDBが作られるため、先に確認する）
[[ -f "$db" ]] || fail "DBが見つかりません: $db（何も作成していません）" 2
[[ -r "$db" ]] || fail "DBを読み取れません: $db" 2

# .backup の引数は引用符で囲むため、引用符を含むパスは扱わない（空白は扱える）
[[ "$userdata_dir" != *"'"* && "$userdata_dir" != *'"'* ]] || fail "パスに引用符を含むため扱えません: $userdata_dir" 2

# 起動中の判定 1: DBファイルを開いているプロセス
open_files=()
for f in "$db" "$db-wal" "$db-shm"; do
  [[ -e "$f" ]] && open_files+=("$f")
done
if holders=$(lsof -t -- "${open_files[@]}" 2>/dev/null) && [[ -n "$holders" ]]; then
  print -u2 -- "DBを開いているプロセスがあります（PID: ${(f)holders}）。アプリを終了（⌘Q）してから実行してください。"
  exit 2
fi

# 起動中の判定 2: アプリのプロセス
case "$target" in
  user) app_pattern="GTD.app/Contents/MacOS/GTD" ;;
  dev) app_pattern="${0:A:h:h}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ;;
  *) app_pattern="" ;;
esac
if [[ -n "$app_pattern" ]] && pgrep -f -- "$app_pattern" >/dev/null 2>&1; then
  print -u2 -- "アプリが起動しています（$app_pattern）。終了（⌘Q）してから実行してください。"
  exit 2
fi

backup_dir="$userdata_dir/backups"
mkdir -p -- "$backup_dir"

# 重複しない名前（既存ファイルは上書きしない）
stamp=$(date +%Y%m%d-%H%M%S)
dest="$backup_dir/gtd-$stamp-$target.sqlite"
n=1
while [[ -e "$dest" || -e "${dest%.sqlite}.txt" ]]; do
  dest="$backup_dir/gtd-$stamp-$target-$n.sqlite"
  (( n++ ))
done
report="${dest%.sqlite}.txt"

# 元DBを読み取り専用で開く方法
# - -wal がある: 通常の読み取り専用（WALの内容も含めて読む。読み取り専用の接続は -shm を作れないため、-shm も必要）
#   このとき SQLite が -shm（WALの索引。共有メモリ）を更新することがある。本体と -wal は変更しない。
# - -wal がない: すべてのデータが本体にあるため、変更されない前提（immutable）の読み取り専用URIで開く
#   （正常に閉じたWALモードのDBは、-shm がないと通常の読み取り専用では開けないため）
uri_encode() {
  local s="$1"
  s="${s//\%/%25}"; s="${s// /%20}"; s="${s//\?/%3f}"; s="${s//\#/%23}"
  print -r -- "$s"
}
if [[ -e "$db-wal" ]]; then
  [[ -e "$db-shm" ]] || fail "WALファイル（-wal）があり、-shm がないため読み取り専用で開けません。アプリを一度起動して正常に終了してから実行してください。" 2
  source_args=(-readonly "$db")
else
  source_args=("file:$(uri_encode "$db")?mode=ro&immutable=1")
fi

# バックアップ（SQLiteのオンラインバックアップ。WALの内容も含めて一貫した状態を書き出す）
sqlite3 -bail "${source_args[@]}" ".backup '$dest'" || fail "バックアップに失敗しました（$dest。作成途中のファイルは残しています）"
[[ -s "$dest" ]] || fail "バックアップのファイルが作られていません（$dest）"

# バックアップを単体のファイルとして扱えるよう、ジャーナルモードを DELETE にする（元DBには触れない。
# アプリはDBを開く時に WAL に戻すため、復元に使っても問題ない）
sqlite3 -bail "$dest" "PRAGMA journal_mode = DELETE;" >/dev/null || fail "バックアップのジャーナルモードを変更できませんでした（$dest）"
# この実行で新しく作ったバックアップの補助ファイル（macOS の sqlite3 が残すことがある）だけを片付ける。
# 名前は重複しないように決めているため、実行前には存在しなかったファイル。元DBの -wal / -shm には触れない
for aux in "$dest-wal" "$dest-shm"; do
  [[ -e "$aux" ]] && rm -f -- "$aux"
done

# 整合性の確認（バックアップを読み取り専用で開く）
integrity=$(sqlite3 -readonly -bail "$dest" "PRAGMA integrity_check;" 2>&1) || integrity="（確認に失敗）$integrity"

# 記録: 適用済みマイグレーション数と、存在するテーブルの件数（古いDBに projects・milestones がなくても失敗にしない）
has_table() {
  [[ "$(sqlite3 -readonly "$dest" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '$1';")" == "1" ]]
}
{
  print -- "バックアップ: $dest"
  print -- "元DB: $db"
  print -- "日時: $(date '+%Y-%m-%d %H:%M:%S %z')"
  print -- "integrity_check: $integrity"
  if has_table __drizzle_migrations; then
    print -- "適用済みマイグレーション数: $(sqlite3 -readonly "$dest" 'SELECT count(*) FROM __drizzle_migrations;')"
  else
    print -- "適用済みマイグレーション数: （記録テーブルなし）"
  fi
  for table in tasks projects milestones app_settings; do
    if has_table "$table"; then
      print -- "$table: $(sqlite3 -readonly "$dest" "SELECT count(*) FROM \"$table\";") 件"
    else
      print -- "$table: （テーブルなし）"
    fi
  done
} > "$report"

cat -- "$report"

if [[ "$integrity" != "ok" ]]; then
  # バックアップは削除しない（調査用に残す）。成功とは扱わない
  print -u2 -- "エラー: バックアップの整合性が ok ではありません。このバックアップを復元に使わないでください（$dest）"
  exit 1
fi
print -- "成功: バックアップを作成し、整合性を確認しました。"
