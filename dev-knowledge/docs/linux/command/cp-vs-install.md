---
title: Linux の cp と install の使い分け（パーミッション・所有者の扱い）
tags: [linux, command, cp, install, coreutils, permission, mode, owner, umask, makefile, shell]
---

## TL;DR

- **素の `cp`** は「コピー元のモードに **umask を適用** して新規作成」する。さらに **所有者・グループ・タイムスタンプは保持されず**、実行ユーザー・現在グループ・現在時刻になる。＝「権限そのまま」ではない。
- **`cp -p`（= `--preserve=mode,ownership,timestamps`）** で初めて「モード・所有者・グループ・時刻をそのまま保持」になる。`cp -a` はさらに ACL/SELinux/拡張属性まで含めて保持。
- **`install`** は **コピー元の権限を無視**し、`-m` 未指定なら常に **`rwxr-xr-x`（≒0755）** を、`-m` 指定ならその値を「決め打ちで」設定する。`-o`/`-g` で所有者・グループも一発指定でき、`cp + chmod + chown + mkdir` を 1 コマンドに統合できる。
- だから Makefile の `install:` ターゲットで多用される。実行ファイルをそのまま実行可能な 0755 で、設定ファイルを `-m 0644` で配置、といった用途。
- ユーザの理解「cp は権限そのまま／install は変更できる」は**おおむね正しいが不正確**。正確には「素の cp は環境(umask・実行ユーザ)依存／install は結果のモードを自分で決め打ち」。

## このドキュメントの射程

「ファイルをコピーするとき `cp` と `install` のどちらを使うべきか」。特にパーミッション・所有者・グループ・タイムスタンプがコピー後にどうなるかを GNU coreutils の公式マニュアルベースで整理する。環境は GNU coreutils（man7.org の install(1) は coreutils 9.11 / 2026-04 版を参照）。

## 結論（早見表）

| | モード | 所有者 | グループ | タイムスタンプ |
|---|---|---|---|---|
| `cp`（素） | 元モード − setuid/setgid/sticky に **umask 適用** | 実行ユーザー | プロセスの現在グループ | 現在時刻 |
| `cp -p` | 元のまま保持 | 元のまま保持（所有者変更は root のみ） | 元のまま保持 | 元のまま保持 |
| `install`（`-m` なし） | **強制 0755**（`u=rwx,go=rx,a-s`、umask 無関係） | 実行ユーザー（`-o` で指定可・root のみ） | 現在グループ（`-g` で指定可） | 現在時刻（`-p` で保持） |
| `install -m MODE` | 指定した MODE を決め打ち | 同上 | 同上 | 同上 |

## 原因（なぜ「cp は権限そのまま」が不正確か）

GNU coreutils マニュアルの `cp` のデフォルト挙動の記述（要約）：

> 新規ファイルは「コピー元のモードから setuid/setgid/sticky を除いた値」を作成モードとして要求し、OS がそこに **umask（または既定 ACL）を適用**する。結果として元より制限の強いモードになりうる。

つまり素の `cp` は「元のモードをそのまま」ではなく「元のモードに umask を被せた値」になる。加えて所有者・グループ・タイムスタンプは引き継がれない。これらまで含めて本当に「そのまま」にしたいなら `-p` が必要。

一方 `install` は OS の作成モード＋umask に任せず、**自分で chmod 相当のモード設定を行う**ため、コピー元の権限も umask も結果に影響しない（常に決め打ち）。

## 解決（具体例）

### cp: デフォルトと -p の違い

```bash
$ umask                       # 0022
$ ls -l src.sh
-rwxr-xr-x 1 alice alice 10 Jun 22 10:00 src.sh    # 元は 755・実行ビットあり

# デフォルト cp: 所有者は実行ユーザ、時刻は現在に変わる
$ cp src.sh dst.sh
$ ls -l dst.sh
-rwxr-xr-x 1 bob bob 10 Jun 22 12:34 dst.sh

# -p で保持（所有者まで保持できるのは root 実行時のみ）
$ cp -p src.sh dst2.sh
$ ls -l dst2.sh
-rwxr-xr-x 1 alice alice 10 Jun 22 10:00 dst2.sh
```

umask の影響が見えるのは、元のモードに「他者書き込み」など umask で落ちるビットが含まれるケース。例えば元が 666 でも `umask 022` 環境では `cp` 後は 644 になる。

### install: コピー元の権限を無視する

```bash
$ ls -l src.sh
-rw------- 1 alice alice 10 Jun 22 10:00 src.sh    # 元は 600

# -m 指定なし → 元の 600 を無視して 0755 になる
$ install src.sh /opt/bin/app
$ ls -l /opt/bin/app
-rwxr-xr-x 1 bob bob 10 Jun 22 12:34 app           # 0755・所有者は実行ユーザ・時刻は現在

# モード・所有者・グループを一発指定（-o は root のみ）
$ sudo install -D -m 0644 -o root -g staff config.conf /etc/myapp/config.conf
$ ls -l /etc/myapp/config.conf
-rw-r--r-- 1 root staff 20 Jun 22 12:35 config.conf
```

### install の主要オプション

| オプション | 内容 |
|---|---|
| `-m, --mode` | chmod と同じ書式でモード指定。省略時は `rwxr-xr-x` |
| `-o, --owner` | 所有者を設定（root のみ） |
| `-g, --group` | グループを設定。省略時はプロセスの現在グループ |
| `-d, --directory` | 引数をすべてディレクトリ名として `mkdir -p` 相当で作成 |
| `-D` | DEST の手前までの中間ディレクトリを作ってから SOURCE をコピー |
| `-s, --strip` | シンボルテーブルを除去（実行ファイルを軽量化） |
| `-b, --backup` | 既存の宛先があればバックアップを作成 |
| `-t, --target-directory` | 複数 SOURCE を指定ディレクトリへコピー |
| `-p, --preserve-timestamps` | SOURCE のアクセス/更新時刻を保持（**デフォルトは保持しない**） |

> 注: `-m` 未指定時のデフォルトは厳密には `u=rwx,go=rx,a-s`。見た目 0755 だが、`a-s`（setuid/setgid を無効化）なので数値 `0755` 指定とは微妙に異なる（ディレクトリの setuid/setgid を保存せず落とす）。

### Makefile でよく使われる理由

実行ビット付きの 0755 を確実に、データファイルは `-m 0644` で、中間ディレクトリ作成（`-D`）や所有者設定（`-o`/`-g`）まで 1 コマンドで完結できるため。

```makefile
install:
	install -d $(DESTDIR)/usr/bin
	install -m 0755 myprog $(DESTDIR)/usr/bin/myprog
	install -m 0644 myprog.conf $(DESTDIR)/etc/myprog.conf
```

`cp` だと「コピー → `chmod` → `chown` → `mkdir -p`」を別々に並べる必要があり、umask 依存で実行ビットが落ちる事故も起きうる。`install` はそれを避けて結果のモードを決め打ちできる。

## まとめ

- 「コピー元の属性を引き継ぎたい」なら `cp -p`（素の `cp` は umask 適用＋所有者/時刻が変わる点に注意）。
- 「配置先のパーミッション・所有者を決め打ちしたい／実行ファイルやデータを適切なモードで設置したい」なら `install`。
- ユーザの当初理解は方向性は正しい。正確には **「素の cp は環境依存でコピー、install は結果のモードを自分で確定させる」**。

## 参考

- install invocation (GNU Coreutils): https://www.gnu.org/software/coreutils/manual/html_node/install-invocation.html
- cp invocation (GNU Coreutils): https://www.gnu.org/software/coreutils/manual/html_node/cp-invocation.html
- install(1) — Linux manual page (man7.org, coreutils 9.11): https://man7.org/linux/man-pages/man1/install.1.html
- cp(1) — Linux manual page (man7.org): https://man7.org/linux/man-pages/man1/cp.1.html
