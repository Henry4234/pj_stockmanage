from flask import Flask
from flask_cors import CORS
from .config import Config
from .db import init_db


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    CORS(app)
    init_db(app)

    from .routes import bp as main_bp
    app.register_blueprint(main_bp, url_prefix='/api')

    @app.route('/health')
    def health():
        return {'status': 'ok'}, 200

    return app
