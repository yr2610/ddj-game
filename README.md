# 大道塾 - DDJ GAME

空道の掛け声をモチーフにした非公式・一人用・無料のブラウザ向け落ち物パズル。

## 遊び方
- 同じ文字の丸い玉を合体させる。通常プレイには時間制限なし
- 危険ラインを一定時間越えると試合終了
- RUSH 50%で「打撃」：制限時間内に玉をタップして破壊
- RUSH 100%で「投げ」：好きな玉を1個掴み、ドラッグして移動
- スコアに応じて架空のゲーム内段位認定

## 実行
index.htmlをブラウザで開く。物理演算ライブラリ Matter.js v0.20.0 は vendor/ にMITライセンス文書とともに同梱しているためCDNやビルドは不要。音声はWeb Audioと端末の読み上げ音声による試作版で、肉声の録音素材は未収録。

## 公開
リポジトリをPublicに変更し、Settings → Pages → Build and deploymentで Source=Deploy from a branch、branch=main、folder=/(root) を指定して保存。公開後の想定URLは https://yr2610.github.io/ddj-game/ です。

※非公式のパロディ作品。実在する競技団体や公的な段位認定とは無関係です。