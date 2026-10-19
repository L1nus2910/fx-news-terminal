#!/bin/sh
# 公開前に実行：CSS/JS のURLに新しい版番号を付けて、古いキャッシュが使われないようにする
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(assets/app\.(css|js))\?v=[0-9]+#\1?v=$V#g" index.html
echo "version $V"
