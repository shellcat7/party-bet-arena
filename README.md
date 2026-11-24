# ランクパーティ

[![Validate](https://github.com/shellcat7/party-bet-arena/actions/workflows/validate.yml/badge.svg)](https://github.com/shellcat7/party-bet-arena/actions/workflows/validate.yml)

ゲーム大会の勝負にオッズとベットを付けて、参加者全員の順位をリアルタイムに集計するWebアプリです。幹事がルームを作成してQRコードで招待し、参加者は各自のスマートフォンからベットします。着順を入力すると払戻が自動で計算され、全員の画面に反映されます。

https://shellcat7.github.io/party-bet-arena/

Firebaseに接続しなくても、「デモを見る」から幹事と参加者の両方の画面を確認できます。

ポイントは遊び用です。現金や景品のやり取りには使用できません。

| 進行（幹事） | ベット | 着順入力 | レース結果 |
| --- | --- | --- | --- |
| <img src="docs/screenshots/host-home.png" width="190" alt="幹事の進行画面" /> | <img src="docs/screenshots/bet.png" width="190" alt="ベット画面" /> | <img src="docs/screenshots/results-entry.png" width="190" alt="着順入力と精算プレビュー" /> | <img src="docs/screenshots/race-result.png" width="190" alt="参加者のレース結果" /> |
| **順位** | **履歴** | **最終結果** | **ダーク表示** |
| <img src="docs/screenshots/ranking.png" width="190" alt="順位" /> | <img src="docs/screenshots/history.png" width="190" alt="レース履歴と残高推移" /> | <img src="docs/screenshots/final.png" width="190" alt="最終結果" /> | <img src="docs/screenshots/bet-dark.png" width="190" alt="ダーク表示のベット画面" /> |

## 機能

- ルームの作成と招待（12文字のルームIDと16文字の参加コード、QRコード、招待リンク）
- 単勝・複勝・2連単・3連単のベット。幹事による代行入力と取り消し
- 対戦者の強さからのオッズ自動計算と、ベットの集まり具合でオッズが変わるモード
- ベット受付 → 締切 → 着順入力 → 精算 の進行管理。確定前の精算プレビュー
- 順位と変動、レース履歴、残高推移グラフ、最終結果
- 日本語と英語、ライトとダーク表示

## 構成

| 領域 | 使用技術 |
| --- | --- |
| フロントエンド | React 19、TypeScript（strict）、Vite |
| データ同期 | Firebase Realtime Database、Firebase Authentication（匿名ログイン） |
| 権限 | Realtime Database Security Rules（`firebase.rules.json`） |
| ホスティング | GitHub Pages（GitHub Actions でデプロイ） |
| テスト | Vitest、Firebase Emulator、Playwright、axe-core |

サーバー側のコードはありません。データの読み書きの可否はすべて Security Rules で判定しています。

```
src/
├── lib/         ドメインロジック（オッズ、ベット、精算、ルーム操作、同期用の差分生成）
├── state/       ルームの状態管理と画面遷移
├── screens/     画面
├── components/  共通UI
├── i18n/        日本語・英語の文言
└── styles/      CSS（トークン、共通部品、画面別）
```

`lib/` は React と Firebase に依存しない関数のみで構成しており、ユニットテストの対象です。設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) にまとめています。

## 実装上の判断

**同時書き込み時のデータ保護**
幹事の変更はルーム全体を上書きせず、変更されたパスだけを書き込みます（`src/lib/patch.ts`）。締切・精算・次のレースへの移行は Realtime Database のトランザクションで実行し、サーバー上の最新状態を前提に処理します。複数のタブや古い表示から操作しても、精算済みのレースを再度精算したり、締切直前に受け付けたベットを取りこぼしたりしません。

**サーバーを持たない権限管理**
Security Rules で次の制約を課しています。参加コードが一致した端末だけがメンバーとして登録でき、メンバー以外はルームを読めません。参加者が作成できるのは、初期残高の自分のレコードと、受付中の自分のベット1件だけです。倍率はクライアントから受け取らず、精算時に毎回計算します。ルールのテストはエミュレータ上で実行しています（`tests/firebase-rules.test.ts`）。

**オッズの計算**
対戦者の強さから勝率を推定し、配当が極端にならないよう補正しています。2連単・3連単は着順の起こりやすさ（Plackett–Luce モデル）を考慮します。ベット状況に応じて変動させる設定では、仮想プールを加えたパリミュチュエル方式で計算します。

## 開発

Node.js 22 以上が必要です。

```bash
npm install
npm run dev
```

Firebase の設定がない場合は、端末内だけで動作するモードで起動します。

| コマンド | 内容 |
| --- | --- |
| `npm run check` | 型チェック、Lint、ユニットテスト、ビルド |
| `npm test` | ユニットテスト（`npm run test:coverage` でカバレッジ） |
| `npm run test:rules:emulator` | Security Rules のテスト（Java 21 が必要） |
| `npm run test:e2e` | 本番ビルドに対する E2E テストとアクセシビリティ検査 |
| `npm run test:e2e:online` | Firebase Emulator を使った2端末の E2E テスト |

プルリクエストでは、これらすべてを GitHub Actions で実行します。

### Firebase Emulator で複数端末を試す

`npm run dev:emulators` を起動したうえで、`.env.local` に次の値を設定して `npm run dev` を実行します。本番の Firebase には接続しません。

```dotenv
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_APP_ID=1:123:web:123
VITE_FIREBASE_AUTH_DOMAIN=demo-party-bet-security.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-party-bet-security-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=demo-party-bet-security
VITE_USE_FIREBASE_EMULATORS=true
```

## デプロイ

1. Firebase Console で Web アプリを登録し、Realtime Database と匿名ログインを有効にします。
2. GitHub の Repository variables に `VITE_FIREBASE_*` を設定します。これらはブラウザに配布される値です。
3. Settings → Pages で Source を GitHub Actions に設定します。`main` への push でデプロイされます。
4. `firebase.rules.json` を Firebase に反映します。クライアントとの公開順序は [docs/SECURITY.md](docs/SECURITY.md) を参照してください。

## ドキュメント

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：データモデル、同期、レースの状態遷移、オッズ
- [docs/SECURITY.md](docs/SECURITY.md)：権限モデル、既知の制約、リリース手順
