#!/bin/bash
# 自动重连的 SSH 隧道，保持公网地址可用
# 被 supervisord 调用，前台运行
while true; do
  echo "[$(date)] 启动 SSH 隧道..."
  ssh -o StrictHostKeyChecking=no \
      -o ConnectTimeout=15 \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:8000 \
      nokey@localhost.run 2>&1
  echo "[$(date)] SSH 退出（$?），5 秒后重连..."
  sleep 5
done
