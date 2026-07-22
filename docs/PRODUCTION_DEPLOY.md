# Перенос Marine LMS на production

Этот документ описывает безопасный перенос проекта на сервер. Команды рассчитаны на Linux/VPS, но логика такая же для любого хостинга: код проекта, PostgreSQL, папка `data/uploads`, `.env`, запуск Node.js за reverse proxy.

## 1. Что переносить

Нужно перенести:

- весь код проекта;
- базу PostgreSQL;
- всю папку `data/uploads` целиком, включая `video`, `imported-wordpress`, PDF-шаблоны сертификатов, печати, фото студентов и обложки курсов;
- production `.env`.

Структура на сервере должна быть такой:

```text
LMS
├─ data
│  └─ uploads
├─ docs
├─ prisma
├─ scripts
├─ package.json
├─ package-lock.json
└─ .env
```

## 2. Подготовка сервера

Минимум:

- Node.js 20+;
- PostgreSQL 16 или совместимый;
- доступ по SSH/SFTP/файловому менеджеру;
- домен и HTTPS через Nginx/Apache/IIS/панель хостинга.

Установка зависимостей:

```bash
cd /path/to/LMS
npm ci
```

Если на сервере нужно ставить только runtime-зависимости, можно использовать:

```bash
npm ci --omit=dev
```

Но для проверки `npm run build` нужны dev-зависимости, поэтому перед первым запуском удобнее выполнить обычный `npm ci`.

## 3. Настройка `.env`

Скопируй пример:

```bash
cp .env.production.example .env
```

Заполни реальные значения:

```env
NODE_ENV="production"
LMS_STORAGE="prisma"
DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/marine_lms?schema=public"
HOST="127.0.0.1"
PORT="3000"
PUBLIC_BASE_URL="https://your-domain.com"
APP_URL="https://your-domain.com"
TRUST_PROXY="true"
LMS_ALLOW_DEMO_DATA="false"
SESSION_TTL_HOURS="12"
PASSWORD_RESET_TTL_MINUTES="30"
ACCOUNT_ACTIVATION_TTL_HOURS="168"
```

Важно: `PUBLIC_BASE_URL` должен быть настоящим HTTPS-доменом. Он попадает в QR-коды сертификатов.

Для почты `info@maritimelearning.store` использовать SMTP SSL:

```env
SMTP_HOST="mail.maritimelearning.store"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_STARTTLS="false"
SMTP_USER="info@maritimelearning.store"
SMTP_PASS="пароль_от_почты"
SMTP_FROM="info@maritimelearning.store"
SMTP_TLS_REJECT_UNAUTHORIZED="true"
```

Если локальный тест показывает `certificate has expired`, значит у SMTP-сервера просрочен SSL-сертификат. Для локальной диагностики можно временно поставить `SMTP_TLS_REJECT_UNAUTHORIZED="false"` в `.env.local`, но на production лучше обновить SSL почтового сервера или запросить у хостера корректный SMTP host с валидным сертификатом.

## 4. База данных

На сервере создать базу и пользователя PostgreSQL, затем применить миграции:

```bash
npm run prod:migrate
```

Если переносится уже готовая локальная база, сначала нужно сделать dump локальной базы и восстановить его на сервере.

Пример dump с локального компьютера:

```bash
pg_dump "postgresql://postgres:postgres@localhost:5432/marine_lms?schema=public" > marine_lms.sql
```

Пример restore на сервере:

```bash
psql "postgresql://USER:PASSWORD@127.0.0.1:5432/marine_lms?schema=public" < marine_lms.sql
```

После restore:

```bash
npm run prod:migrate
npm run db:verify
```

## 5. Файлы и видео

Перенести локальную папку:

```text
C:\Users\телеграм 8\Documents\LMS\data\uploads
```

На сервер:

```text
/path/to/LMS/data/uploads
```

Нельзя переносить только часть. Нужна вся папка `uploads` целиком, включая все подпапки.

После переноса проверить права:

```bash
chmod -R u+rwX data/uploads
```

Если приложение запускается отдельным пользователем, владельцем папки должен быть этот пользователь.

## 6. Проверка перед запуском

Выполнить:

```bash
npm run prod:check
npm run build
```

Строгая проверка, где warnings тоже считаются проблемой:

```bash
npm run prod:check:strict
```

`prod:check` проверяет:

- production env;
- подключение к PostgreSQL;
- целостность данных;
- существование `data/uploads`;
- битые ссылки на `/uploads/...` в базе.

## 7. Запуск через PM2

Установить PM2:

```bash
npm install -g pm2
```

Запустить приложение:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Проверить:

```bash
pm2 status
pm2 logs marine-lms
```

## 8. Reverse proxy

Пример Nginx:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    client_max_body_size 600m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

SSL-сертификат можно выпустить через панель хостинга или Let's Encrypt.

## 9. Финальный smoke-test

После запуска:

```bash
BASE_URL="https://your-domain.com" npm run smoke
```

И вручную проверить:

- вход администратора;
- открытие курса;
- открытие видео/файла;
- создание или редактирование студента;
- выдачу сертификата;
- скачивание PDF;
- QR-проверку сертификата.

## 10. Бэкапы

Нужно регулярно сохранять:

- PostgreSQL dump;
- `data/uploads`.

Пример:

```bash
pg_dump "$DATABASE_URL" > backups/marine_lms_$(date +%F_%H-%M).sql
tar -czf backups/uploads_$(date +%F_%H-%M).tar.gz data/uploads
```

Перед любым обновлением production сначала сделать оба бэкапа.

В проекте также есть готовая команда:

```bash
npm run prod:backup
```

Она запускает `pg_dump` для PostgreSQL и копирует `data/uploads` в папку `backups/production-...`.

Если `pg_dump` не найден автоматически, укажи путь:

```bash
PG_DUMP_BIN="/usr/bin/pg_dump" npm run prod:backup
```
