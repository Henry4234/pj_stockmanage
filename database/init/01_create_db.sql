-- 初始化腳本：建立資料庫（下一步詳細設計資料表）
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'StockManage')
BEGIN
    CREATE DATABASE StockManage;
END
GO
