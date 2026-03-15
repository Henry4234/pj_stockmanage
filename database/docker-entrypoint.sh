#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
#  MS SQL Server 自訂啟動腳本
#  1. 在背景啟動 SQL Server
#  2. 等待 SQL Server 就緒
#  3. 依序執行 /init/*.sql 初始化腳本
#  4. 切換為前台等待（保持容器存活）
# ──────────────────────────────────────────────────────────────────────
set -e

# 啟動 SQL Server（背景執行）
/opt/mssql/bin/sqlservr &
SA_PID=$!

echo "[DB-Init] SQL Server PID: $SA_PID"
echo "[DB-Init] Waiting for SQL Server to be ready..."

RETRY=40
until /opt/mssql-tools18/bin/sqlcmd \
    -S localhost \
    -U sa \
    -P "${MSSQL_SA_PASSWORD}" \
    -Q "SELECT 1" \
    -No -C > /dev/null 2>&1
do
    RETRY=$((RETRY - 1))
    if [ $RETRY -le 0 ]; then
        echo "[DB-Init] ERROR: SQL Server did not start in time."
        exit 1
    fi
    echo "[DB-Init] Not ready yet... ($RETRY retries left)"
    sleep 3
done

echo "[DB-Init] SQL Server is ready!"

# # 執行 /init/ 下所有 .sql 檔案（依名稱排序）
# for SQL_FILE in $(ls /init/*.sql 2>/dev/null | sort -V); do
#     FNAME=$(basename "$SQL_FILE")
#     echo "[DB-Init] Running: $FNAME"
#     /opt/mssql-tools18/bin/sqlcmd \
#         -S localhost \
#         -U sa \
#         -P "${MSSQL_SA_PASSWORD}" \
#         -i "$SQL_FILE" \
#         -No -C \
#         || echo "[DB-Init] Warning: $FNAME completed with errors (may be expected on re-run)"
# done

echo "[DB-Init] All init scripts completed."

# 回到前台等待 SQL Server 進程（保持容器存活）
wait $SA_PID
