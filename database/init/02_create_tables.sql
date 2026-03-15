USE StockManage;
GO

/* =========================================================
   第一段：CREATE TABLE
   ========================================================= */

/* 1. 帳號管理主檔 */
IF OBJECT_ID(N'dbo.id_master', N'U') IS NOT NULL DROP TABLE dbo.id_master;
GO
CREATE TABLE dbo.id_master (
    user_id int IDENTITY(1,1) NOT NULL,
    username nvarchar(50) COLLATE Chinese_Taiwan_Stroke_CI_AS NOT NULL,
    display_name nvarchar(100) COLLATE Chinese_Taiwan_Stroke_CI_AS NOT NULL,
    department nvarchar(100) COLLATE Chinese_Taiwan_Stroke_CI_AS NULL,
    is_active bit NOT NULL CONSTRAINT DF_id_master_is_active DEFAULT 1,
    created_at datetime2 NOT NULL CONSTRAINT DF_id_master_created_at DEFAULT GETDATE(),
    CONSTRAINT PK_id_master PRIMARY KEY (user_id),
    CONSTRAINT UQ_id_master_username UNIQUE (username)
);
GO


/* 2. 產品主檔 */
IF OBJECT_ID(N'dbo.product_master', N'U') IS NOT NULL DROP TABLE dbo.product_master;
GO
CREATE TABLE dbo.product_master (
    product_id varchar(30) NOT NULL,
    product_name nvarchar(200) NOT NULL,
    manufacturer nvarchar(200) NULL,
    issuing_agency nvarchar(50) NULL,
    primary_di varchar(50) NOT NULL,
    unit_of_use_di varchar(50) NULL,
    default_uom nvarchar(20) NOT NULL CONSTRAINT DF_product_master_default_uom DEFAULT N'each',
    is_serialized bit NOT NULL CONSTRAINT DF_product_master_is_serialized DEFAULT 0,
    is_lot_controlled bit NOT NULL CONSTRAINT DF_product_master_is_lot_controlled DEFAULT 1,
    is_expiry_controlled bit NOT NULL CONSTRAINT DF_product_master_is_expiry_controlled DEFAULT 1,
    created_at datetime2 NOT NULL CONSTRAINT DF_product_master_created_at DEFAULT GETDATE(),
    CONSTRAINT PK_product_master PRIMARY KEY (product_id),
    CONSTRAINT UQ_product_master_primary_di UNIQUE (primary_di)
);
GO


/* 3. 儲位主檔 */
IF OBJECT_ID(N'dbo.location_master', N'U') IS NOT NULL DROP TABLE dbo.location_master;
GO
CREATE TABLE dbo.location_master (
    location_id varchar(30) NOT NULL,
    location_name nvarchar(100) NOT NULL,
    area_name nvarchar(100) NULL,
    is_active bit NOT NULL CONSTRAINT DF_location_master_is_active DEFAULT 1,
    created_at datetime2 NOT NULL CONSTRAINT DF_location_master_created_at DEFAULT GETDATE(),
    CONSTRAINT PK_location_master PRIMARY KEY (location_id)
);
GO


/* 4. 包裝層級主檔
   注意：
   - each 單品若實務上沒有 UDI，package_di 可為 NULL
   - box / case 則通常會有 package_di
*/
IF OBJECT_ID(N'dbo.packaging_level', N'U') IS NOT NULL DROP TABLE dbo.packaging_level;
GO
CREATE TABLE dbo.packaging_level (
    packaging_id varchar(30) NOT NULL,
    product_id varchar(30) NOT NULL,
    level_code varchar(20) NOT NULL,              -- each / box / case
    package_di varchar(50) NULL,                  -- each 無 UDI 時可為 NULL
    contains_packaging_id varchar(30) NULL,       -- 包含的下一層包裝
    quantity_per_package int NOT NULL,            -- 每一層包含的下一層數量
    package_type nvarchar(50) NOT NULL,           -- 單品 / 小盒 / 大箱
    created_at datetime2 NOT NULL CONSTRAINT DF_packaging_level_created_at DEFAULT GETDATE(),
    CONSTRAINT PK_packaging_level PRIMARY KEY (packaging_id),
    CONSTRAINT FK_packaging_level_product
        FOREIGN KEY (product_id) REFERENCES dbo.product_master(product_id),
    CONSTRAINT FK_packaging_level_contains
        FOREIGN KEY (contains_packaging_id) REFERENCES dbo.packaging_level(packaging_id),
    CONSTRAINT CK_packaging_level_level_code
        CHECK (level_code IN ('each', 'box', 'case')),
    CONSTRAINT CK_packaging_level_qty
        CHECK (quantity_per_package > 0)
);
GO

/* package_di 唯一索引：僅限制非 NULL 值 */
IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_packaging_level_package_di'
      AND object_id = OBJECT_ID(N'dbo.packaging_level')
)
DROP INDEX UX_packaging_level_package_di ON dbo.packaging_level;
GO
CREATE UNIQUE INDEX UX_packaging_level_package_di
ON dbo.packaging_level(package_di)
WHERE package_di IS NOT NULL;
GO


/* 5. 庫內實體容器主檔
   - 可代表一個大箱(case)、一個小盒(box)、或一個已開封單品容器(each)
*/
IF OBJECT_ID(N'dbo.inventory_container', N'U') IS NOT NULL DROP TABLE dbo.inventory_container;
GO
CREATE TABLE dbo.inventory_container (
    container_id varchar(30) NOT NULL,
    product_id varchar(30) NOT NULL,
    packaging_id varchar(30) NOT NULL,
    lot_no nvarchar(50) NULL,
    expiry_date date NULL,
    serial_no nvarchar(100) NULL,
    current_qty int NOT NULL,                     -- 一律換算成最小單位 each
    location_id varchar(30) NOT NULL,
    parent_container_id varchar(30) NULL,
    status nvarchar(20) NOT NULL,                 -- sealed / opened / unpacked / consumed
    created_at datetime2 NOT NULL CONSTRAINT DF_inventory_container_created_at DEFAULT GETDATE(),
    CONSTRAINT PK_inventory_container PRIMARY KEY (container_id),
    CONSTRAINT FK_inventory_container_product
        FOREIGN KEY (product_id) REFERENCES dbo.product_master(product_id),
    CONSTRAINT FK_inventory_container_packaging
        FOREIGN KEY (packaging_id) REFERENCES dbo.packaging_level(packaging_id),
    CONSTRAINT FK_inventory_container_location
        FOREIGN KEY (location_id) REFERENCES dbo.location_master(location_id),
    CONSTRAINT FK_inventory_container_parent
        FOREIGN KEY (parent_container_id) REFERENCES dbo.inventory_container(container_id),
    CONSTRAINT CK_inventory_container_qty
        CHECK (current_qty >= 0),
    CONSTRAINT CK_inventory_container_status
        CHECK (status IN (N'sealed', N'opened', N'unpacked', N'consumed'))
);
GO


/* 6. 庫存異動紀錄 */
IF OBJECT_ID(N'dbo.stock_transaction', N'U') IS NOT NULL DROP TABLE dbo.stock_transaction;
GO
CREATE TABLE dbo.stock_transaction (
    tx_id varchar(30) NOT NULL,
    tx_type nvarchar(30) NOT NULL,                -- receive / issue / transfer / unpack_out / unpack_in / adjust / return
    container_id varchar(30) NOT NULL,
    qty int NOT NULL,
    from_location varchar(30) NULL,
    to_location varchar(30) NULL,
    operator_user_id int NULL,
    tx_time datetime2 NOT NULL CONSTRAINT DF_stock_transaction_tx_time DEFAULT GETDATE(),
    remark nvarchar(500) NULL,
    CONSTRAINT PK_stock_transaction PRIMARY KEY (tx_id),
    CONSTRAINT FK_stock_transaction_container
        FOREIGN KEY (container_id) REFERENCES dbo.inventory_container(container_id),
    CONSTRAINT FK_stock_transaction_from_location
        FOREIGN KEY (from_location) REFERENCES dbo.location_master(location_id),
    CONSTRAINT FK_stock_transaction_to_location
        FOREIGN KEY (to_location) REFERENCES dbo.location_master(location_id),
    CONSTRAINT FK_stock_transaction_operator
        FOREIGN KEY (operator_user_id) REFERENCES dbo.id_master(user_id),
    CONSTRAINT CK_stock_transaction_qty
        CHECK (qty > 0),
    CONSTRAINT CK_stock_transaction_type
        CHECK (tx_type IN (N'receive', N'issue', N'transfer', N'unpack_out', N'unpack_in', N'adjust', N'return'))
);
GO


/* 常用查詢索引 */
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_inventory_container_lookup'
      AND object_id = OBJECT_ID(N'dbo.inventory_container')
)
DROP INDEX IX_inventory_container_lookup ON dbo.inventory_container;
GO
CREATE INDEX IX_inventory_container_lookup
ON dbo.inventory_container(product_id, lot_no, expiry_date, status, location_id);
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_stock_transaction_tx_time'
      AND object_id = OBJECT_ID(N'dbo.stock_transaction')
)
DROP INDEX IX_stock_transaction_tx_time ON dbo.stock_transaction;
GO
CREATE INDEX IX_stock_transaction_tx_time
ON dbo.stock_transaction(tx_time);
GO