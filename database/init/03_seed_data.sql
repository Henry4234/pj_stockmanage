USE StockManage;
GO

-- ── 初始帳號（僅在表格空白時插入）──────────────
IF NOT EXISTS (SELECT 1 FROM id_master)
BEGIN
    INSERT INTO id_master (username, display_name, department) VALUES
        (N'admin',   N'系統管理員',   N'資訊室'),
        (N'nurse01', N'護理師 王小明', N'外科病房'),
        (N'nurse02', N'護理師 李小華', N'外科病房'),
        (N'stock01', N'庫管員 張大明', N'倉儲組');
    PRINT 'Seeded: id_master';
END
GO

-- ── 初始儲位 ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM location_master)
BEGIN
    INSERT INTO location_master (location_code, location_name, zone) VALUES
        (N'WH-A-01', N'主倉庫 A 區 01 號', N'主倉庫'),
        (N'WH-A-02', N'主倉庫 A 區 02 號', N'主倉庫'),
        (N'WH-B-01', N'主倉庫 B 區 01 號', N'主倉庫'),
        (N'WH-B-02', N'主倉庫 B 區 02 號', N'主倉庫'),
        (N'NS-1F',   N'護理站 一樓',         N'護理站'),
        (N'NS-2F',   N'護理站 二樓',         N'護理站'),
        (N'OR-1',    N'手術室 備品區',       N'手術室');
    PRINT 'Seeded: location_master';
END
GO
