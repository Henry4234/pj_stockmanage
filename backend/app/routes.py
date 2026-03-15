from flask import Blueprint, jsonify, request
from .db import get_db

bp = Blueprint('main', __name__)


@bp.route('/ping')
def ping():
    return jsonify({'message': 'pong'}), 200


# ── 帳號管理 ───────────────────────────────────────────────────────
@bp.route('/users')
def get_users():
    try:
        cursor = get_db().cursor()
        cursor.execute(
            "SELECT user_id, username, display_name, department "
            "FROM id_master WHERE is_active = 1 ORDER BY display_name"
        )
        return jsonify([
            {'user_id': r[0], 'username': r[1], 'display_name': r[2], 'department': r[3] or ''}
            for r in cursor.fetchall()
        ])
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ── 產品主檔 ───────────────────────────────────────────────────────
@bp.route('/products')
def get_products():
    try:
        cursor = get_db().cursor()
        cursor.execute(
            "SELECT product_id, product_name, primary_di, unit_of_use_di, "
            "       default_uom, is_serialized, is_lot_controlled, is_expiry_controlled "
            "FROM product_master ORDER BY product_name"
        )
        return jsonify([
            {
                'product_id':           r[0],
                'product_name':         r[1],
                'primary_di':           r[2],
                'unit_of_use_di':       r[3],
                'default_uom':          r[4],
                'is_serialized':        bool(r[5]),
                'is_lot_controlled':    bool(r[6]),
                'is_expiry_controlled': bool(r[7])
            }
            for r in cursor.fetchall()
        ])
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ── 包裝層級 ───────────────────────────────────────────────────────
@bp.route('/packaging')
def get_packaging():
    """回傳指定產品的包裝層級清單（供入庫表單使用）"""
    product_id = request.args.get('product_id')
    if not product_id:
        return jsonify([])
    try:
        cursor = get_db().cursor()
        cursor.execute(
            "SELECT packaging_id, level_code, package_di, "
            "       quantity_per_package, package_type "
            "FROM packaging_level WHERE product_id = ? "
            "ORDER BY quantity_per_package DESC",
            (product_id,)
        )
        return jsonify([
            {
                'packaging_id':         r[0],
                'level_code':           r[1],
                'package_di':           r[2],
                'quantity_per_package': r[3],
                'package_type':         r[4]
            }
            for r in cursor.fetchall()
        ])
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ── 儲位查詢 ───────────────────────────────────────────────────────
@bp.route('/locations')
def get_locations():
    """回傳所有有效儲位
    注意：新 schema 中 location_master 使用 location_id (varchar) 作為主鍵兼代碼，
          area_name 取代舊的 zone 欄位。
    """
    try:
        cursor = get_db().cursor()
        cursor.execute(
            "SELECT location_id, location_name, area_name "
            "FROM location_master WHERE is_active = 1 ORDER BY location_id"
        )
        return jsonify([
            {
                'location_id':   r[0],
                'location_name': r[1],
                'area_name':     r[2] or ''
            }
            for r in cursor.fetchall()
        ])
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ── 庫存查詢 ───────────────────────────────────────────────────────
@bp.route('/inventory')
def get_inventory():
    """
    庫存容器查詢（不含已耗盡）
    Query params:
      product_id  – 篩選特定產品（varchar）
      lot_no      – 批號模糊搜尋
      status      – sealed / opened / unpacked
    注意：
      - product_id 為 varchar(30)，不可做 int() 轉型
      - location_master 以 location_id 作為代碼，無 location_code 欄位
    """
    try:
        product_id = request.args.get('product_id')
        lot_no     = request.args.get('lot_no')
        status     = request.args.get('status')

        sql = """
            SELECT
                ic.container_id,
                pm.product_id,
                pm.product_name,
                pm.primary_di,
                pm.default_uom,
                pl.level_code,
                pl.package_di,
                ic.lot_no,
                CONVERT(VARCHAR(10), ic.expiry_date, 120) AS expiry_date,
                ic.serial_no,
                ic.current_qty,
                ic.status,
                lm.location_id   AS location_code,
                lm.location_name
            FROM  inventory_container ic
            JOIN  product_master      pm ON ic.product_id   = pm.product_id
            JOIN  packaging_level     pl ON ic.packaging_id  = pl.packaging_id
            LEFT JOIN location_master lm ON ic.location_id   = lm.location_id
            WHERE ic.status != 'consumed'
        """
        params = []
        if product_id:
            sql += " AND ic.product_id = ?"
            params.append(product_id)          # varchar — 不做 int() 轉型
        if lot_no:
            sql += " AND ic.lot_no LIKE ?"
            params.append(f'%{lot_no}%')
        if status:
            sql += " AND ic.status = ?"
            params.append(status)

        sql += " ORDER BY ic.expiry_date, pm.product_name"

        cursor = get_db().cursor()
        cursor.execute(sql, params)

        return jsonify([
            {
                'container_id':  r[0],
                'product_id':    r[1],
                'product_name':  r[2],
                'primary_di':    r[3],
                'default_uom':   r[4],
                'level_code':    r[5],
                'package_di':    r[6],
                'lot_no':        r[7],
                'expiry_date':   r[8],
                'serial_no':     r[9],
                'current_qty':   int(r[10]) if r[10] is not None else 0,
                'status':        r[11],
                'location_code': r[12],
                'location_name': r[13]
            }
            for r in cursor.fetchall()
        ])
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ── 異動紀錄 ───────────────────────────────────────────────────────
@bp.route('/transactions', methods=['POST'])
def create_transaction():
    """
    建立庫存異動紀錄
    tx_type: receive / issue / transfer / unpack_out / unpack_in / adjust / return
    """
    try:
        body        = request.get_json(force=True) or {}
        tx_type     = body.get('tx_type', '').strip()
        qty         = int(body.get('qty', 1))
        remark      = body.get('remark', '')
        product_id  = body.get('product_id', '')
        location_id = body.get('location_id', '')

        if not tx_type:
            return jsonify({'error': 'tx_type 為必填'}), 400

        valid_types = ('receive', 'issue', 'transfer',
                       'unpack_out', 'unpack_in', 'adjust', 'return')
        if tx_type not in valid_types:
            return jsonify({'error': f'tx_type 必須為 {valid_types} 之一'}), 400

        # TODO：實作完整 UDI 解析 → 寫入 inventory_container / stock_transaction
        return jsonify({
            'message':  '已接收，異動寫入邏輯開發中',
            'received': {
                'tx_type':     tx_type,
                'product_id':  product_id,
                'location_id': location_id,
                'qty':         qty,
                'remark':      remark
            }
        }), 202

    except Exception as e:
        return jsonify({'error': str(e)}), 400
