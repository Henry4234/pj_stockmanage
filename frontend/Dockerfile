FROM nginx:1.27-alpine

# 複製 Nginx 設定
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 複製靜態前端檔案
COPY html/ /usr/share/nginx/html/

EXPOSE 80
