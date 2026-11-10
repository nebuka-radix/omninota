# テストの実行方式

ユーザーがプライマリディスプレイで作業している間も、自動テストが作業を妨げない
（ウィンドウを前面に出さない、フォーカスを奪わない、ネイティブダイアログを出さない、OS全体へ入力を送らない）ための方式。

## 3つの区分

| 区分 | 対象 | 実行方法 | 状態 |
|---|---|---|---|
| A. ウィンドウ不要 | 業務ルール、入力検証、Repository・マイグレーション、IPCハンドラー、終了フローの調整、Rendererの純粋関数 | `npm test`（vitest） | 実行可能 |
| B. Electronの非表示ウィンドウ | DOM、IPC、Query、一覧操作、画面遷移、未保存確認、終了時の保存（ダイアログは回答指定）、再起動後の復元 | `npm run test:ui` | 実行可能（7シナリオ） |
| C. 表示が必要 | Bと同じシナリオを、セカンダリディスプレイに非アクティブで表示して実行（見た目の確認・スクリーンショット用） | `npm run test:ui:secondary` | 実行可能（明示的に実行した時だけ） |
| 手動 | 実IME、VoiceOver、OSの実フォーカス、ネイティブダイアログの外観・実ボタン、メニュー・⌘Q・⌘W | docs/manual-checks.md | 人が操作 |

B・C は新しいE2Eフレームワークを使わず、Node.js 標準の fetch / WebSocket で Chrome DevTools Protocol（CDP）に接続する
小さなスクリプト（`scripts/ui-test/`）で実行する。B は「Electronの非表示ウィンドウ」での検証で、完全なヘッドレス環境での検証ではない
（macOSのウィンドウサーバー上でウィンドウを作り、表示しないだけ）。

## 実行方法

```zsh
cd ~/git/gtd
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"   # Node 24（nvm）

npm test                       # A
npm run test:ui                # B: ビルド（electron-vite build）してから非表示で実行
npm run test:ui:secondary      # C: プライマリ以外のディスプレイが1台だけなら自動で選ぶ
npm run test:ui:secondary -- --display 724063890   # 表示先を指定（GTD_TEST_DISPLAY_ID でも可）
node scripts/ui-test/run.mjs hidden --keep         # 成功しても一時ディレクトリを残す（スクリーンショットの確認用）
```

- ディスプレイのIDは、表示先を決められなかった時の停止メッセージに一覧が出る（IDは接続し直すと変わることがある）。
- 終了コード: 0 = 全シナリオ成功、1 = 失敗あり、3 = 表示先を決められず停止（プライマリには表示しない）。
- C は表示先のディスプレイに数十秒ウィンドウが出る。フォーカスは取らないが、表示先で作業していない時に実行する。

## アプリ側のテストモード（GTD_TEST_UI）

`src/main/infrastructure/test-mode.ts`、`src/main/window.ts`、`src/main/index.ts`

| 環境変数 | 内容 |
|---|---|
| `GTD_TEST_UI` | `hidden` / `secondary`。未パッケージ時だけ有効（パッケージ版では無視して通常起動） |
| `GTD_DEV_USER_DATA_DIR` | テストモードでは必須。一時ディレクトリ（`os.tmpdir()`、`/tmp`、`/private/tmp`）の中だけを受け付ける |
| `GTD_TEST_DISPLAY_ID` | secondary の表示先（任意） |
| `GTD_TEST_DIALOG_ANSWERS` | ネイティブダイアログへの回答（JSON。`[{ "button": "保存して終了", "message": "…" }]`）。表示1回につき1件を順に使う |

- 設定が誤っている場合（モード名、userDataが一時ディレクトリ外・未指定、回答の形式など）は、userDataを決める前に終了コード2で終了する。
  ウィンドウ・ダイアログは出さず、開発用・通常利用のディレクトリにも触れない。
- 共通: Dockに表示せず起動時に前面化しない（`app.setActivationPolicy('accessory')`）。
  2つ目の起動（second-instance）・activate でも既存ウィンドウを表示・フォーカスしない。
  `backgroundThrottling: false`（非表示・非アクティブでも描画とタイマーを止めない）。DevToolsは開かない。
  `app.focus`・`win.focus`・`moveTop`・`alwaysOnTop` は使わない。
- hidden: `show: false` のまま表示しない。
- secondary: `screen.getAllDisplays()` と `screen.getPrimaryDisplay().id` を比べてプライマリ以外を選ぶ（配列の順番や座標では判定しない）。
  候補が0台・2台以上（指定なし）・指定IDがない・指定IDがプライマリ・作業領域が最小サイズより小さい、の場合は表示せず、
  DBを開く前に終了コード3で終了する。表示する場合は作業領域の中央に収め、`showInactive()` で表示する。
- テストモードでは `[test] window-show bounds=…` / `[test] window-focus` をログに出し、実行スクリプトが
  「非表示のままか」「フォーカスを取っていないか」「作業領域に収まっているか」を確認する。

### ネイティブダイアログ

`src/main/lifecycle/message-box.ts` のアダプター経由で呼ぶ。

- 通常起動・パッケージ版: 従来どおり Electron の `dialog.showMessageBox` / `showErrorBox`。
- テストモード: 画面に出さず、`GTD_TEST_DIALOG_ANSWERS` の回答をボタン名で選ぶ。
  回答が未指定・ボタン名や見出しが一致しない場合は、保存も破棄も選ばずにキャンセル扱いにし、
  `[test-dialog] FAIL` として記録する（実行スクリプトがテスト失敗にする）。「保存せずに終了」などを既定の回答にはしない。
- 回答はアプリの起動時に環境変数で渡すだけで、Rendererから回答を注入するIPCは公開していない。

## 実行スクリプト（scripts/ui-test/）

- 自分が起動した子プロセスだけを操作・終了する（`killall` などの一括終了はしない）。異常時は自分の子プロセスだけを強制終了する。
- 終了は子プロセスへの SIGTERM（Electronが `app.quit()` として扱い、`before-quit` の保存確認を通る）。
- デバッグポートは起動ごとに空いているポートを選び、`127.0.0.1` だけで待ち受けていること、終了後に閉じていることを確認する。
- 操作は対象ページへのCDPだけ（DOM、`Input.dispatchKeyEvent`、`Input.insertText`、ページ内へのマウスイベント）。
  OS全体へのキー入力・マウス操作、AppleScriptなどによる他アプリの前面化は使わない。
- `Emulation.setFocusEmulationEnabled` で、ページ内だけフォーカスがある状態として扱う（OSのフォーカスは変えない）。
  そのため、OSの実際のフォーカス移動・フォーカスリングの見た目はこのテストでは確認できない（手動確認）。
- 実行中は最前面アプリを `lsappinfo`（読み取りのみ）で監視し、テスト対象のプロセスが最前面になったら失敗にする。
- DBの中身は、アプリの終了後に一時DBを better-sqlite3 の読み取り専用で開いて確認する。

### 一時DBの扱い

- 実行ごとに `os.tmpdir()` 配下へ `gtd-ui-test-XXXXXX/` を作り、その中の `userData/`（と多重起動の確認用の `userData-other/`）だけを使う。
- 全シナリオ成功時はこのディレクトリを削除する。失敗時・停止時・`--keep` 指定時は残し、場所を表示する（スクリーンショットも同じ場所）。
- 開発DB（GTD-dev）・通常利用DB（GTD）は使わない。テストモードは一時ディレクトリ外のuserDataを拒否する。

### シナリオ（B・C 共通）

1. 起動: 表示されない（C: 作業領域内に表示）、フォーカスを取らない、描画フレームが進む、スクリーンショットを取れる、一時userDataを使う、SIGTERMで正常終了
2. Inbox: 追加・編集（Enter）・完了／未完了（Space）
3. Projects: 作成・名前変更、名前の編集中にInboxへ → アプリ内の確認（キャンセルで移動しない・破棄で移動）
4. 再起動: 最後に開いたプロジェクトを復元
5. 終了: プロジェクト名の編集中に終了 → 回答「保存して終了」→ DBに保存される
6. 終了: 回答が未指定 → 終了せず（キャンセル扱い）失敗として記録、ドラフトは画面に残り、DBは変わらない
7. 多重起動: 同じuserDataの2つ目は終了し、既存ウィンドウを表示・前面化しない。別のuserDataのインスタンスとは同時に動く

## 通常起動への影響

- `GTD_TEST_UI` が未指定なら、ウィンドウの表示（`ready-to-show` で `show()`）、2つ目の起動での前面化、
  `backgroundThrottling`（既定のまま）、ダイアログ（実ダイアログ）は従来どおり。
- 多重起動の防止（`requestSingleInstanceLock`）は無効化していない。ロックは userData ごとに働くため、
  一時userDataのテスト用インスタンスは、開発用・通常利用のアプリとロックを共有しない（シナリオ7で別userDataの同時起動を確認）。
- パッケージ版は `GTD_TEST_UI` を無視する（単体テストで確認）。

## まだ実行基盤がないもの

- 実IME（変換確定のEnter）、VoiceOver、OSの実フォーカス・フォーカスリング、ネイティブダイアログの外観と実ボタン、
  メニュー・⌘Q・⌘W・閉じるボタンからの終了 → docs/manual-checks.md の手動確認。
- パッケージ版（.app）でのUIテスト（テストモードはパッケージ版で無効。通常利用DBを使わずに起動する方法がない）。
- 保存失敗・取得失敗を起こすシナリオ（障害を注入する仕組みは用意していない。入力検証による拒否で代替できる範囲だけ）。
