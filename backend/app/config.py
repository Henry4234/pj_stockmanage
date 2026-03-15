import os


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret')
    DB_HOST = os.environ.get('DB_HOST', 'localhost')
    DB_PORT = os.environ.get('DB_PORT', '1433')
    DB_NAME = os.environ.get('DB_NAME', 'StockManage')
    DB_USER = os.environ.get('DB_USER', 'sa')
    DB_PASSWORD = os.environ.get('DB_PASSWORD', '')

    @staticmethod
    def get_connection_string():
        return (
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={Config.DB_HOST},{Config.DB_PORT};"
            f"DATABASE={Config.DB_NAME};"
            f"UID={Config.DB_USER};"
            f"PWD={Config.DB_PASSWORD};"
            f"TrustServerCertificate=yes;"
        )
