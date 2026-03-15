# 檢驗醫學科 — UDI 庫存管理系統

醫療耗材庫存管理系統，以 UDI（Unique Device Identification）條碼為核心，支援商品入庫、出庫掃碼、庫存總覽、以及批號 / 效期管控。

---

## 1. 專案架構

### 1.1 系統架構圖

```
瀏覽器 (Intranet)
    │  HTTP :80
    ▼
┌──────────────────────────────┐
│  Frontend Container          │  Nginx
│  - 靜態 HTML / CSS / JS      │  反向代理 /api/* → backend:5000
│  - SPA（Single Page App）    │
└──────────────────┬───────────┘
                   │ /api/*  HTTP
                   ▼
┌──────────────────────────────┐
│  Backend Container           │  Python 3.12 + Flask
│  - RESTful API               │  pyodbc (ODBC Driver 18)
│  - UDI 解析（開發中）        │
└──────────────────┬───────────┘
                   │ ODBC  :1433
                   ▼
┌──────────────────────────────┐
│  SQL Server（宿主機本機）    │  MS SQL Server 2022 Express
│  DB: StockManage             │  User: stockadmin
└──────────────────────────────┘
```

> **注意**：資料庫不走 Docker 容器，直接使用宿主機已安裝的 SQL Server（localhost:1433）。
> Docker 容器透過 `host.docker.internal` 這個特殊 hostname 連回宿主機。

### 1.2 目錄結構

```
pj_stockmanage/
├── docker-compose.yml          ← 2 個 Docker 服務：backend / frontend
├── .env                        ← 環境變數（不入版本控制）
├── .env.example                ← 環境變數範本
├── .gitignore
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── run.py
│   └── app/
│       ├── __init__.py         ← Flask App Factory
│       ├── config.py           ← DB 連線字串
│       ├── db.py               ← pyodbc 連線管理
│       └── routes.py           ← API endpoints
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── html/
│       ├── index.html          ← 主頁（登入 + SPA）
│       ├── style.css           ← 全域樣式
│       └── app.js              ← 前端邏輯
│
└── database/
    └── init/
        ├── 01_create_db.sql    ← 建立 StockManage 資料庫
        ├── 02_create_tables.sql← 建立 6 張資料表
        └── 03_seed_data.sql    ← 初始帳號 / 儲位資料
```

### 1.3 API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/ping` | 健康檢查 |
| GET | `/api/users` | 取得帳號清單（登入用） |
| GET | `/api/products` | 取得產品主檔 |
| GET | `/api/packaging?product_id=` | 取得指定產品的包裝層級 |
| GET | `/api/locations` | 取得儲位清單 |
| GET | `/api/inventory` | 庫存查詢（支援 product_id / lot_no / status 篩選） |
| POST | `/api/transactions` | 建立庫存異動（開發中） |

---

## 2. Docker 建置環境

### 2.1 前置需求

| 工具 | 版本需求 |
|------|---------|
| Docker Desktop | 4.x 以上 |
| SQL Server 2022 Express | 已安裝於宿主機 port 1433 |

> SQL Server 需建立資料庫與帳號，並以 `database/init/` 下的 SQL 腳本初始化 schema。

### 2.2 環境變數設定

複製 `.env.example` 為 `.env` 並填入實際值：

```bash
cp .env.example .env
```

`.env` 內容：

```env
DB_SA_PASSWORD=your_password       # SQL Server 登入密碼
DB_NAME=StockManage                # 資料庫名稱
DB_USER=stockadmin                 # SQL Server 登入帳號
SECRET_KEY=your_random_secret_key  # Flask Session 加密 Key
FLASK_ENV=development              # development / production
```

### 2.3 建置與啟動

```bash
# 第一次建置（含下載 base image）
docker compose up --build -d

# 後續啟動
docker compose up -d

# 停止
docker compose down
```

啟動後：
- 前端：`http://localhost`（port 80）
- 後端 API：`http://localhost:5000/api/ping`

### 2.4 Backend Dockerfile 關鍵說明

後端使用 **python:3.12-slim（Debian 12 Bookworm）**。

```dockerfile
# 用 gpg --dearmor 取代已棄用的 apt-key add
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
  && echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/microsoft.gpg] \
     https://packages.microsoft.com/debian/12/prod bookworm main" \
     | tee /etc/apt/sources.list.d/mssql-release.list \
  && ACCEPT_EULA=Y apt-get install -y msodbcsql18
```

### 2.5 連接宿主機 SQL Server

Docker 容器不能直接用 `localhost` 連到宿主機，需使用 `host.docker.internal`：

```yaml
# docker-compose.yml
backend:
  environment:
    DB_HOST: host.docker.internal   # 對應宿主機 localhost
  extra_hosts:
    - "host.docker.internal:host-gateway"  # Linux 需要此行；Windows 已內建
```

---

## 3. 資料庫 Table 設計原理

### 3.1 整體設計概念

本系統以「**實體容器（Container）**」為庫存基本單位。一個容器代表一個物理上可獨立識別的包裝，例如一箱、一盒或一個已開封的耗材袋。所有庫存數量皆換算為最小單位（each）儲存，以利跨層級統計。

### 3.2 六張資料表說明

#### `id_master` — 帳號主檔

```
user_id (INT IDENTITY PK) | username | display_name | department | is_active
```

- 院內人員帳號，供操作紀錄追蹤使用
- 採院內 Intranet 無密碼登入，登入後以 `user_id` 記錄每筆異動的操作者

#### `product_master` — 產品主檔

```
product_id (varchar PK) | product_name | primary_di (UNIQUE) | unit_of_use_di
is_serialized | is_lot_controlled | is_expiry_controlled
```

- `product_id`：自定義商品代碼（varchar，非流水號）
- `primary_di`：GS1 Device Identifier，對應 UDI 條碼主段，全系統唯一
- `unit_of_use_di`：最小使用單位 DI（通常為單品掃碼用）
- 三個 `is_*_controlled` 欄位控制入庫時是否必填批號、序號、效期

#### `location_master` — 儲位主檔

```
location_id (varchar PK) | location_name | area_name | is_active
```

- `location_id` 直接作為儲位代碼（如 `WH-A-01`、`NS-2F`），無需額外的 `location_code` 欄位
- `area_name` 為區域分類（主倉庫 / 護理站 / 手術室）

#### `packaging_level` — 包裝層級主檔

```
packaging_id (varchar PK) | product_id (FK) | level_code (each/box/case)
package_di | contains_packaging_id (self FK) | quantity_per_package | package_type
```

- 描述同一商品的多層包裝關係，例如：1 箱（case）= 10 盒（box）= 100 個（each）
- `contains_packaging_id` 自參考 FK，形成包裝樹狀結構
- 入庫時記錄「這批貨是以哪一層包裝入庫的」，供後續拆箱計算

```
[case: 1箱]  contains_packaging_id → [box: 10盒]  contains_packaging_id → [each: 100個]
```

#### `inventory_container` — 庫內實體容器

```
container_id (varchar PK) | product_id | packaging_id | lot_no | expiry_date
serial_no | current_qty | location_id | parent_container_id (self FK) | status
```

- **一筆 = 一個實體包裝**（一箱、一盒、或一開封容器）
- `current_qty`：換算為最小單位 each 的剩餘數量
- `parent_container_id`：大箱拆成小盒時，小盒記錄其所屬大箱
- `status` 四種狀態：

  | 狀態 | 說明 |
  |------|------|
  | `sealed` | 未開封，完整包裝 |
  | `opened` | 已開封（針對可分次使用的容器） |
  | `unpacked` | 已拆箱（大包裝已展開成子容器） |
  | `consumed` | 已耗盡，不計入庫存 |

#### `stock_transaction` — 庫存異動紀錄

```
tx_id (varchar PK) | tx_type | container_id (FK) | qty
from_location | to_location | operator_user_id (FK) | tx_time | remark
```

- 每一筆異動對應一筆容器操作，構成完整 Audit Trail
- `tx_type` 七種類型：

  | 類型 | 說明 |
  |------|------|
  | `receive` | 商品入庫 |
  | `issue` | 商品出庫（耗用） |
  | `transfer` | 儲位移動 |
  | `unpack_out` | 拆箱（上層容器數量減少） |
  | `unpack_in` | 拆箱（下層子容器新增） |
  | `adjust` | 盤點調整 |
  | `return` | 退回（耗材未使用退庫） |

### 3.3 ER 關聯圖

```
product_master ──< packaging_level (self FK)
    │
    └──< inventory_container (self FK: parent_container_id)
             │
             ├── location_master
             │
             └──< stock_transaction
                      │
                      └── id_master (operator)
```

---

## 4. 扣庫存流程與資料記錄方式

### 4.1 商品入庫（receive）

**觸發情境**：倉管員掃描來貨箱上的 UDI 條碼，登錄批號、效期，指定存放儲位。

**資料寫入流程**：

```
1. 解析 UDI 條碼 → 取得 primary_di → 查 product_master 取得 product_id
2. 在 inventory_container 建立新紀錄：
   - status = 'sealed'
   - current_qty = quantity_per_package（依包裝層級換算 each 數）
   - location_id = 指定儲位
3. 在 stock_transaction 建立紀錄：
   - tx_type = 'receive'
   - qty = 入庫數量（each）
   - to_location = 存放儲位
   - operator_user_id = 當前登入者
```

### 4.2 商品出庫 / 耗用（issue）

**觸發情境**：護理師掃描要使用的耗材 UDI，系統扣減庫存。

**資料寫入流程**：

```
1. 解析 UDI → 找到對應 inventory_container（比對 lot_no / serial_no）
2. 扣減 current_qty（current_qty - 使用數量）
3. 若 current_qty = 0 → status 改為 'consumed'
4. 建立 stock_transaction：
   - tx_type = 'issue'
   - qty = 使用數量
   - from_location = 容器目前的 location_id
   - operator_user_id = 操作者
```

### 4.3 拆箱流程（unpack_out / unpack_in）

**觸發情境**：一箱（case）到貨後，需拆成多盒（box）分送至各護理站。

**資料寫入流程**：

```
1. 找到 status='sealed' 的 case 容器（parent）
2. 將 parent 的 status 改為 'unpacked'，current_qty 歸零
3. 為每個子盒建立新的 inventory_container：
   - packaging_id = box 層級
   - parent_container_id = parent 的 container_id
   - status = 'sealed'
   - current_qty = quantity_per_package（box → each）
4. 建立兩筆 stock_transaction：
   - unpack_out：紀錄原容器數量出去
   - unpack_in：紀錄每個子容器的新增
```

### 4.4 儲位移動（transfer）

```
1. 更新 inventory_container.location_id = 目標儲位
2. 建立 stock_transaction：
   - tx_type = 'transfer'
   - from_location = 原儲位
   - to_location = 目標儲位
```

### 4.5 庫存計算邏輯

任何時間點的庫存查詢，以 `inventory_container` 為主，篩選 `status != 'consumed'`：

```sql
-- 某商品在各儲位的庫存數量
SELECT
    lm.location_name,
    SUM(ic.current_qty) AS total_each
FROM inventory_container ic
JOIN location_master lm ON ic.location_id = lm.location_id
WHERE ic.product_id = ?
  AND ic.status != 'consumed'
GROUP BY lm.location_id, lm.location_name;
```

`stock_transaction` 則提供完整異動歷史，供稽核、報表、以及問題追蹤使用。

---

## 5. 開發進度

| 功能 | 狀態 |
|------|------|
| Docker 2容器框架（backend + frontend） | ✅ 完成 |
| 資料庫 Schema（6張表 + 索引 + seed data） | ✅ 完成 |
| 前端 SPA（登入 / 側邊欄 / 庫存總覽 / 商品入庫） | ✅ 完成 |
| 後端 API（users / products / packaging / locations / inventory） | ✅ 完成 |
| UDI 解析模組（GS1-128 / HIBC Application Identifier） | 🔲 開發中 |
| inventory_container 實際寫入邏輯（transactions POST） | 🔲 開發中 |
| 相機條碼識別 | 🔲 待規劃 |
