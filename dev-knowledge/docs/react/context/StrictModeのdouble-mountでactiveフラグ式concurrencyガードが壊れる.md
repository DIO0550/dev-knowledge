---
title: StrictMode の dev double-mount で active フラグ式の concurrency ガードが壊れる
tags: [react, strict-mode, concurrency, cleanup, double-mount, provider]
---

## TL;DR

- Provider の unmount 時に `active = false` にして async 結果を破棄する「active フラグ方式」の concurrency ガードは、React StrictMode の dev double-mount で壊れる。
- StrictMode は dev で **mount → cleanup → remount** をシミュレートする。cleanup で `active = false` にすると、同じ ref を持つオブジェクトが**死んだまま**remount され、以降の全 command が破棄される。
- 対策は active フラグを廃止し、**世代番号（generation）**への一本化。unmount cleanup は世代を進めるだけにする。

---

## 問題

`ProjectVersion` に `active: boolean` フラグがあり、Provider の unmount 時に `active = false` にして async 結果（await 後の反映）を破棄する仕組みを持っていた。

```tsx
// unmount 時のクリーンアップ
useEffect(() => {
  return () => {
    deactivateProject(); // version.active = false にする
  };
}, []);
```

React StrictMode は dev で `mount → cleanup → remount` をシミュレートする。この際、cleanup で `deactivateProject` が走ると、**同じ ref の version が `active = false` のまま remount** され、その version に紐づく全 command が「もう active でない」と判断されて破棄されてしまう。

## 原因

`active` フラグは本来「React ツリーが生きているか」を表す concurrency ガードで、**本番ではほぼ出番がない防御機構**だった。

問題は、フラグが「同一オブジェクトの生死」に張り付いていたこと。StrictMode の double-mount では同じ ref が cleanup → remount を通るため、cleanup が立てた「死」フラグが remount 後もそのまま残り、生きているツリーを死んでいると誤認する。

## 解決

`active` フラグを廃止し、**世代番号への一本化**に切り替える。

- `current` / `openRequest` のような世代（generation）を持つ。
- async 結果を反映する側は「自分が開始した世代 == 現在の世代」かどうかで有効性を判定する。
- unmount cleanup は**世代を進めるだけ**にする（boolean を落とすのではなく、番号をインクリメントする）。

```tsx
// 世代方式: cleanup は世代を進めるだけ
let current = 0;

function startCommand() {
  const gen = ++current; // 開始時の世代を控える
  return async () => {
    const result = await invoke();
    if (gen !== current) return; // 世代がずれていたら破棄
    applyResult(result);
  };
}

useEffect(() => {
  return () => {
    current++; // 世代を進めるだけ。remount で startCommand が新世代を取り直す
  };
}, []);
```

remount 時には新しい world（新しい世代）で command が世代を取り直すため、StrictMode の double-mount でも「生きているのに死んでいると誤認する」問題が起きない。

## 教訓

- boolean の「生死フラグ」を**同一オブジェクトの寿命**に張り付けると、StrictMode の double-mount（同一 ref の cleanup→remount）で誤作動する。
- concurrency ガードは「生きている/死んでいる」の 2 値ではなく、**単調増加する世代番号**で表すと double-mount に強い。
- 「本番でほぼ出番がない防御機構」ほど、StrictMode との相性問題が露見しやすい。
