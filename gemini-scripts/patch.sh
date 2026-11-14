#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h:h}"
[[ -f package.json && -f src/main/index.ts ]] || { print -u2 'プロジェクトルートを確認してください'; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null
node <<'NODE'
const fs = require('node:fs');
const path = 'src/main/index.ts';
const before = 'const [width, height] = win.getSize()';
const after = 'const { width, height } = win.getBounds()';
const source = fs.readFileSync(path, 'utf8');
if (source.split(before).length === 2) {
  fs.writeFileSync(path, source.replace(before, after));
  console.log(`更新: ${path}`);
} else if (source.includes(after) && !source.includes(before)) {
  console.log(`修正済み: ${path}`);
} else {
  throw new Error('対象コードが一致しません。src/main/index.ts を確認してください。');
}
NODE
npm run typecheck
npm run build
git diff --check

git add .
git commit -m 'コンパクト表示の最小幅設定と型エラーを修正'
