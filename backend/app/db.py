import pyodbc
from flask import g, current_app
from .config import Config


def get_db():
    if 'db' not in g:
        g.db = pyodbc.connect(Config.get_connection_string())
    return g.db


def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db(app):
    app.teardown_appcontext(close_db)
