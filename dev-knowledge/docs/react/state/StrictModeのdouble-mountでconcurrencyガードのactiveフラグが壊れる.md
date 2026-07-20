---
title: StrictMode の dev double-mount で concurrency ガードの active フラグが壊れる
tags: [react, strict-mode, concurrency, cleanup, double-mount]
---

## TL;DR

- 「React ツリーが生きているか」を表す `active: boolean` フラグで async 結果を破棄する concurrency ガードは、StrictMode の dev double-mount（mount → cleanup → remount）で壊れる。
- cleanup で `active = false` にすると、同じ ref を共有する値が**死んだまま remount** され、以降の command が全部破棄される。
- `active` フラグを廃止して **世代番号**（`current` / `openRequest`）に一本化する。unmount cleanup は世代を進めるだけにすれば、double-mount でも壊れない。

---

## 1. 問題

`ProjectVersion` に `active: boolean` フラグがあり、Provider の unmount 時に `active = false` にして進行中の async 結果を破棄する仕組みだった。

React StrictMode は dev で **mount → cleanup → remount** をシミュレートする。この cleanup で `deactivateProject`（`active = false`）が走ると、同じ ref の version が**死んだまま remount**され、その後の全 command が「もう active じゃない」と判定されて破棄されてしまう。

```
mount    → version.active = true
cleanup  → version.active = false   // StrictMode の擬似アンマウント
remount  → 同じ ref を使い回すが active は false のまま
         → 以降の command がすべて破棄される
```

## 2. 原因

`active` フラグは「React ツリーが生きているか」を表す concurrency ガードだが、本番ではほとんど出番のない防御機構だった。

- boolean は「今生きているか死んでいるか」の 1 ビットしか持たず、**mount の世代**を区別できない。
- StrictMode の cleanup → remount は「別インスタンスの開始」ではなく「同じ ref の再利用」なので、false に落とした 1 ビットがそのまま持ち越されて復帰できない。

つまり StrictMode との相性問題が、この防御機構の設計の弱さを露見させた。

## 3. 解決

`active` フラグを廃止し、**世代番号**（`current` / `openRequest`）への一本化に置き換える。

- 各 async command は「自分が発行された世代」を掴んでおき、完了時に `current` と一致するかで採否を判定する。
- unmount / cleanup は `active = false` にするのではなく、**世代を 1 つ進めるだけ**。
- StrictMode の double-mount で cleanup → remount しても、remount 側が新しい世代で動き出すので、「死んだまま復帰できない」状態が発生しない。

```
mount    → 世代 = 1
cleanup  → 世代 = 2（進めるだけ、無効化フラグは持たない）
remount  → 世代 = 3 で通常どおり動作
```

## 4. 判断のポイント

- 「生きている / 死んでいる」の boolean フラグは、**同じインスタンスが cleanup→remount で復活する**ケース（StrictMode / 高速な再マウント）を表現できない。
- concurrency ガードは boolean ではなく**単調増加する世代番号**で持つと、「どの mount のリクエストか」を区別でき、cleanup が破壊的にならない。
- StrictMode の double-mount は「本番で稀にしか出ない防御機構」のバグを開発中に炙り出す装置として機能する。dev で壊れたら本番の稀ケースでも壊れると考える。
