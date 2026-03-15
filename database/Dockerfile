FROM mcr.microsoft.com/mssql/server:2022-latest

USER root

# 複製初始化 SQL 腳本與啟動腳本
COPY init/          /init/
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER mssql

ENTRYPOINT ["/docker-entrypoint.sh"]
