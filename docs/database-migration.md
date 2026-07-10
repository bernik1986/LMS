# Переход LMS на PostgreSQL

## Точка восстановления

Перед большой разработкой и переносом данных создана точка восстановления:

`C:\Users\телеграм 8\Documents\LMS\restore-points\pre-db-migration-2026-07-02_14-15-31`

Внутри лежат код, Prisma, скрипты, документация и `data/db.json` на момент старта миграции. Папка `data/uploads` туда не копировалась специально, потому что медиафайлы тяжелые и остаются на месте.

## Что уже подготовлено

- Prisma-схема под PostgreSQL: `prisma/schema.prisma`.
- Конфиг Prisma 7: `prisma.config.ts`.
- Локальный PostgreSQL через Docker: `docker-compose.yml`.
- Мигратор JSON -> PostgreSQL: `scripts/migrate-json-to-prisma.mjs`.
- Команды в `package.json`:
  - `npm.cmd run prisma:migrate:deploy`
  - `npm.cmd run prisma:push`
  - `npm.cmd run db:migrate:schema`
  - `npm.cmd run db:migrate:json:dry-run`
  - `npm.cmd run db:migrate:json:apply`
  - `npm.cmd run db:migrate:json:force-replace`
  - `npm.cmd run db:verify`
  - `npm.cmd run db:setup`
  - `npm.cmd run db:first-import`
  - `npm.cmd run prod:migrate`
  - `npm.cmd run db:doctor`
  - `npm.cmd run prisma:studio`

## Локальная миграция

1. Поднять PostgreSQL:

```powershell
docker compose up -d postgres
```

Если Docker или PostgreSQL не отвечают, проверьте окружение:

```powershell
npm.cmd run db:doctor
```

2. Создать таблицы через Prisma migrations:

```powershell
npm.cmd run prisma:migrate:deploy
```

3. Проверить, что JSON читается и данные распознаны:

```powershell
npm.cmd run db:migrate:json:dry-run
```

4. Перенести данные при первом запуске пустой базы:

```powershell
npm.cmd run db:migrate:json:apply
```

Эта команда защищена: если в PostgreSQL уже есть LMS-данные, импорт остановится и не будет ничего удалять.

5. Проверить, что данные читаются из PostgreSQL:

```powershell
npm.cmd run db:verify
```

Шаги 2, 4 и 5 для первого импорта можно выполнить одной командой:

```powershell
npm.cmd run db:first-import
```

Обычный безопасный деплой/обновление без импорта JSON:

```powershell
npm.cmd run prod:migrate
```

`npm.cmd run db:setup` сейчас является безопасным alias на `prod:migrate`. Он не импортирует JSON и не очищает таблицы.

Принудительная перезапись базы из `data/db.json` оставлена только для локальной разработки:

```powershell
npm.cmd run db:migrate:json:force-replace
```

На продакшене эту команду не запускать.

Локальный `db:setup` использует `npm.cmd run db:migrate:schema`, потому что на этой машине Prisma schema engine может ловить `EPERM`. Скрипт применяет SQL-файлы из `prisma/migrations` через Node/pg и записывает примененные миграции в `_prisma_migrations`.

Для продакшена можно использовать `npm.cmd run prisma:migrate:deploy`, а не `prisma:push`: в проекте есть начальная SQL-миграция `prisma/migrations/20260702160000_init/migration.sql`.

6. Включить Prisma/PostgreSQL runtime. В `.env` должны быть эти строки:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/marine_lms?schema=public"
LMS_STORAGE="prisma"
```

Если `LMS_STORAGE` не указан и `DATABASE_URL` не задан, сервер останется в резервном JSON-режиме.

7. Посмотреть данные в Prisma Studio:

```powershell
npm.cmd run prisma:studio
```

## Медиафайлы

Видео, картинки, фото студентов и файлы материалов физически остаются в `data/uploads`. В базе хранятся пути вида `/uploads/...`. При переносе на прод нужно перенести папку `data/uploads` вместе с дампом PostgreSQL или загрузить эти файлы в постоянное файловое хранилище и сохранить те же публичные пути.

## Откат

Если нужно вернуться к состоянию до миграции:

1. Остановить сервер LMS.
2. Скопировать файлы из restore-point обратно в корень проекта.
3. Оставить текущую папку `data/uploads`, если медиафайлы не повреждены.
4. Запустить проверку:

```powershell
npm.cmd run build
```

После включения `LMS_STORAGE="prisma"` сервер читает данные из PostgreSQL и сохраняет изменения обратно в PostgreSQL. `data/db.json` можно оставить как резервный исходник миграции, пока продовая база не проверена полностью.
